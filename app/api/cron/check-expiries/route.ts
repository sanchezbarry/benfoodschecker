import { NextResponse, type NextRequest } from "next/server";
import { runReminderJob } from "@/lib/reminders";

// Always run at request time; never cache.
export const dynamic = "force-dynamic";

/**
 * Scheduled entry point for the reminder workflow. The logic itself lives in
 * `lib/reminders.ts` so the admin console can trigger the very same job.
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

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runReminderJob();
  return NextResponse.json({ ok: true, ...result });
}

// Allow POST too (Supabase pg_net / some schedulers prefer POST).
export async function POST(request: NextRequest) {
  return GET(request);
}
