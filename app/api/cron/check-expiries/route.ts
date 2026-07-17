import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEscalationEmail, sendExpiryEmail } from "@/lib/email";
import type { CertDocument } from "@/lib/types";

// Always run at request time; never cache.
export const dynamic = "force-dynamic";

/**
 * Daily job that drives the two-level reminder workflow:
 *
 *   Level 1  expiry_date <= today && status = 'active'
 *            -> email marketing contact, set status = 'notified'
 *
 *   Level 2  today >= expiry_date + escalation_days && status = 'notified'
 *            (i.e. the renewed cert still hasn't replaced this one)
 *            -> email senior management, set status = 'escalated'
 *
 * Status transitions make this idempotent: an already-notified or
 * already-escalated document is never emailed twice.
 *
 * Protected by CRON_SECRET, supplied either as a Bearer token
 * (`Authorization: Bearer <secret>`) or `?secret=<secret>`.
 */
function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  return request.nextUrl.searchParams.get("secret") === secret;
}

async function run() {
  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10); // yyyy-mm-dd

  const result = { notified: 0, escalated: 0, errors: [] as string[] };

  // ---- Level 1: newly expired, not yet notified ----
  const { data: toNotify, error: notifyErr } = await supabase
    .from("documents")
    .select("*")
    .eq("status", "active")
    .lte("expiry_date", today);

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

  // ---- Level 2: notified, grace period elapsed, still present ----
  // Compare in SQL: expiry_date + escalation_days <= today.
  const { data: notified, error: escErr } = await supabase
    .from("documents")
    .select("*")
    .eq("status", "notified");

  if (escErr) result.errors.push(`query notified: ${escErr.message}`);

  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  for (const doc of (notified ?? []) as CertDocument[]) {
    const dueMs =
      new Date(`${doc.expiry_date}T00:00:00Z`).getTime() +
      doc.escalation_days * 86_400_000;
    if (todayMs < dueMs) continue;

    try {
      const { error } = await sendEscalationEmail(doc);
      if (error) throw new Error(error.message);
      await supabase
        .from("documents")
        .update({
          status: "escalated",
          escalated_at: new Date().toISOString(),
        })
        .eq("id", doc.id);
      result.escalated++;
    } catch (e) {
      result.errors.push(`escalate ${doc.id}: ${(e as Error).message}`);
    }
  }

  return result;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await run();
  return NextResponse.json({ ok: true, ...result });
}

// Allow POST too (Supabase pg_net / some schedulers prefer POST).
export async function POST(request: NextRequest) {
  return GET(request);
}
