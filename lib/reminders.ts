import { createAdminClient } from "@/lib/supabase/admin";
import { sendEscalationEmail, sendExpiryEmail } from "@/lib/email";
import type { CertDocument } from "@/lib/types";

export type ReminderResult = {
  notified: number;
  escalated: number;
  errors: string[];
};

/**
 * The two-level reminder workflow:
 *
 *   Level 1  expiry_date <= now && status = 'active'
 *            -> email the marketing contact, set status = 'notified'
 *
 *   Level 2  now >= expiry_date + escalation_days && status = 'notified'
 *            -> email senior management (cc marketing), set status = 'escalated'
 *
 * `documents.expiry_date` always mirrors the CURRENT version's expiry, so a
 * retained older version is never reminded on. Uploading a new version resets
 * the status to 'active', which re-arms the workflow against the new date.
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

  const result: ReminderResult = { notified: 0, escalated: 0, errors: [] };

  // ---- Level 1: newly expired, not yet notified ----
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

  // ---- Level 2: notified, grace period elapsed, still not renewed ----
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
