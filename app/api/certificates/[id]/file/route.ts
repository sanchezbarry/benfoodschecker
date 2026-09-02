import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { DOCUMENTS_BUCKET } from "@/lib/constants";

// Never cached: every hit mints a fresh, short-lived storage URL.
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Open a certificate's current file — the link the CSV export puts in every
 * row.
 *
 * A permanent URL that redirects to a 60-second signed one, rather than a
 * signed URL written straight into the spreadsheet. A report gets emailed,
 * saved to a shared drive and opened weeks later: links inside it must not
 * expire, and must not be usable by whoever the file gets forwarded to. This
 * way the spreadsheet holds no credential at all — the link is worthless
 * without a session, and it still works in six months.
 *
 * Sign-in is the only gate, matching the export it serves: every signed-in
 * account can open every certificate, whether or not the dashboard would list
 * it for them. Signed out, the browser goes to /login rather than getting JSON,
 * because this URL is always followed by a person clicking it.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user } = await getSession();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const { id } = await params;
  if (!UUID.test(id))
    return NextResponse.json({ error: "Not a certificate." }, { status: 400 });

  // Service-role, so the link resolves for any signed-in colleague — RLS would
  // otherwise hide certificates belonging to someone else.
  const admin = createAdminClient();

  const { data: doc } = await admin
    .from("documents")
    .select("file_path")
    .eq("id", id)
    .single();

  if (!doc?.file_path)
    return NextResponse.json(
      { error: "That certificate is no longer on file." },
      { status: 404 },
    );

  const { data, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.file_path, 60);

  if (error || !data)
    return NextResponse.json(
      { error: "Could not open that certificate." },
      { status: 500 },
    );

  // no-store matters: a cached redirect would keep pointing at a signed URL
  // that has since expired, and the link would appear to break at random.
  return NextResponse.redirect(data.signedUrl, {
    status: 307,
    headers: { "Cache-Control": "no-store" },
  });
}
