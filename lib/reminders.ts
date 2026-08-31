import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendEscalationEmail,
  sendExpiryEmail,
  sendUpcomingExpiryEmail,
} from "@/lib/email";
import type { CertDocument } from "@/lib/types";

export type ReminderResult = {
  /** Level 1 — the early advance reminder. */
  remindedFirst: number;
  /** Level 2 — the nearer advance reminder. */
  remindedSecond: number;
  notified: number;
  escalated: number;
  errors: string[];
};

/**
 * The four-level reminder workflow:
 *
 *   Level 1  now >= expiry_date - reminder_days_before && still valid
 *            && reminded_at is null
 *            -> email the marketing contact, stamp reminded_at
 *
 *   Level 2  now >= expiry_date - second_reminder_days_before && still valid
 *            && second_reminded_at is null
 *            -> email the marketing contact, stamp second_reminded_at
 *
 *   Level 3  expiry_date <= now && status = 'active'
 *            -> email the marketing contact, set status = 'notified'
 *
 *   Level 4  now >= expiry_date + escalation_days && status = 'notified'
 *            -> email senior management (cc marketing), set status = 'escalated'
 *
 * Neither advance reminder advances `status`, because both are orthogonal to
 * the expire/escalate handover: a certificate stays 'active' after being
 * reminded so Level 3 still fires on the day. The two timestamps keep them from
 * repeating.
 *
 * `documents.expiry_date` always mirrors the CURRENT version's expiry, so an
 * older version left on file from before versions were auto-deleted is never
 * reminded on. Uploading a new version resets the status to 'active' and clears
 * all four markers, which re-arms the workflow against the new date.
 *
 * Status transitions make this idempotent: an already-notified or
 * already-escalated certificate is never emailed twice, so the job is safe to
 * run repeatedly — on a schedule, or by hand from the admin console.
 *
 * Uses the service-role client, so it sees every user's certificates.
 */
export async function runReminderJob(): Promise<ReminderResult> {
  const supabase = createAdminClient();
  const now = new Date().toISOString(); // full timestamp — expiry_date is timestamptz

  const result: ReminderResult = {
    remindedFirst: 0,
    remindedSecond: 0,
    notified: 0,
    escalated: 0,
    errors: [],
  };

  // ---- Levels 1 and 2: approaching expiry, still valid, not yet reminded ----
  // Each cutoff is per-row (expiry_date - its own lead time), which PostgREST
  // can't express as a filter, so narrow to "still valid" here and compare in
  // JS — the same shape as the escalation pass below.
  const { data: upcoming, error: uErr } = await supabase
    .from("documents")
    .select("*, folder:folders(code, name)")
    .eq("status", "active")
    .gt("expiry_date", now);

  if (uErr) result.errors.push(`query upcoming: ${uErr.message}`);

  for (const doc of (upcoming ?? []) as CertDocument[]) {
    const expiryMs = new Date(doc.expiry_date).getTime();
    const due = (days: number, sentAt: string | null) =>
      days > 0 && !sentAt && Date.now() >= expiryMs - days * 86_400_000;

    const firstDue = due(doc.reminder_days_before, doc.reminded_at);
    const secondDue = due(doc.second_reminder_days_before, doc.second_reminded_at);
    if (!firstDue && !secondDue) continue;

    // At most one advance reminder per certificate per run, and it is the
    // nearest one that is due. Both windows are open at once whenever a
    // certificate is filed late — inside its own lead times — or when the job
    // misses a day, and two near-identical emails in one morning read as a bug.
    // The earlier level is stamped as sent along with it: its moment has
    // passed, and sending it tomorrow would say less than what just went out.
    const stage = secondDue ? "second" : "first";
    const stamp = new Date().toISOString();
    const stamps = secondDue
      ? { second_reminded_at: stamp, ...(firstDue ? { reminded_at: stamp } : {}) }
      : { reminded_at: stamp };

    try {
      const { error } = await sendUpcomingExpiryEmail(doc, { stage });
      if (error) throw new Error(error.message);
      await supabase.from("documents").update(stamps).eq("id", doc.id);
      if (secondDue) result.remindedSecond++;
      else result.remindedFirst++;
    } catch (e) {
      result.errors.push(`remind ${doc.id}: ${(e as Error).message}`);
    }
  }

  // ---- Level 3: newly expired, not yet notified ----
  const { data: toNotify, error: notifyErr } = await supabase
    .from("documents")
    .select("*, folder:folders(code, name)")
    .eq("status", "active")
    .lte("expiry_date", now);

  if (notifyErr) result.errors.push(`query active: ${notifyErr.message}`);

  for (const doc of (toNotify ?? []) as CertDocument[]) {
    try {
      const { error } = await sendExpiryEmail(doc);
      if (error) throw new Error(error.message);
      await supabase
        .from("documents")
        .update({ status: "notified", notified_at: new Date().toISOString() })
        .eq("id", doc.id);
      result.notified++;
    } catch (e) {
      result.errors.push(`notify ${doc.id}: ${(e as Error).message}`);
    }
  }

  // ---- Level 4: notified, grace period elapsed, still not renewed ----
  const { data: notified, error: escErr } = await supabase
    .from("documents")
    .select("*, folder:folders(code, name)")
    .eq("status", "notified");

  if (escErr) result.errors.push(`query notified: ${escErr.message}`);

  const nowMs = Date.now();
  for (const doc of (notified ?? []) as CertDocument[]) {
    const dueMs =
      new Date(doc.expiry_date).getTime() + doc.escalation_days * 86_400_000;
    if (nowMs < dueMs) continue;

    try {
      const { error } = await sendEscalationEmail(doc);
      if (error) throw new Error(error.message);
      await supabase
        .from("documents")
        .update({ status: "escalated", escalated_at: new Date().toISOString() })
        .eq("id", doc.id);
      result.escalated++;
    } catch (e) {
      result.errors.push(`escalate ${doc.id}: ${(e as Error).message}`);
    }
  }

  return result;
}
