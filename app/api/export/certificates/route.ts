import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { toCsv } from "@/lib/csv";
import type { CertDocument } from "@/lib/types";
import {
  daysUntil,
  formatDateISO,
  matchesVendorQuery,
  vendorQueryTokens,
} from "@/lib/utils";

// Never cached: the answer depends on who is asking.
export const dynamic = "force-dynamic";

/**
 * Download the certificate register as a CSV.
 *
 * **Every signed-in account gets every certificate**, PICs included — the whole
 * point of the report is one register covering the portal, so a PIC chasing
 * renewals can see what is outstanding rather than only their own share of it.
 *
 * That makes this deliberately wider than the dashboard, which still shows a
 * standard user only their own rows under RLS. The query therefore runs on the
 * service-role client: RLS would otherwise filter it back down, and there is no
 * policy that says "everyone reads everything" without also opening up the
 * dashboard, the API and every other read. Sign-in is the gate, and it is
 * checked here, on the caller's session, before the service-role client is
 * touched.
 *
 * `?q=` applies the dashboard's vendor search, using the same matcher the list
 * uses, so searching first narrows the download too.
 *
 * Note that /api is excluded from the proxy's matcher, so an unauthenticated
 * request arrives here rather than being redirected — hence the 401 below.
 */
export async function GET(request: NextRequest) {
  const { user } = await getSession();
  if (!user)
    return NextResponse.json(
      { error: "You must be signed in." },
      { status: 401 },
    );

  const { data, error } = await createAdminClient()
    .from("documents")
    .select("*, folder:folders(id, code, name)")
    .order("expiry_date", { ascending: true });

  if (error)
    return NextResponse.json(
      { error: `Could not build the report: ${error.message}` },
      { status: 500 },
    );

  const tokens = vendorQueryTokens(request.nextUrl.searchParams.get("q") ?? "");
  const documents = ((data ?? []) as CertDocument[]).filter((doc) =>
    matchesVendorQuery(doc, tokens),
  );

  // Expiry first, then the two columns a chase list is actually sorted on.
  // Contacts and the reminder schedule ride along because the report is what
  // someone works from when following a certificate up.
  //
  // The link column is an app URL, never a signed storage one: it has to
  // survive being emailed around and opened weeks later, and it must be
  // useless to anyone without a session. Absolute, because a relative path
  // means nothing inside a spreadsheet.
  //
  // Built from the request rather than APP_URL — unlike the reminder emails,
  // which have no request to read and must fall back to the configured URL.
  // Whoever downloaded this reached the app on some host; that is the host
  // their links should point at, and it cannot drift out of step with an env
  // var the way a hardcoded one can.
  const origin = request.nextUrl.origin;
  const rows: (string | number)[][] = [
    [
      "Vendor / customer code",
      "Vendor / customer name",
      "PIC",
      "Certificate type",
      "Expiry date",
      "Days to expiry",
      "Status",
      "Marketing contact",
      "Senior management",
      "First reminder (days before)",
      "Second reminder (days before)",
      "Escalation (days after)",
      "Uploaded",
      "Certificate link",
    ],
    ...documents.map((doc) => [
      doc.folder?.code ?? "",
      doc.folder?.name ?? "",
      doc.pic_name,
      doc.cert_type,
      formatDateISO(doc.expiry_date),
      daysUntil(doc.expiry_date),
      doc.status,
      doc.marketing_email,
      doc.management_email,
      doc.reminder_days_before,
      doc.second_reminder_days_before,
      doc.escalation_days,
      formatDateISO(doc.created_at),
      `${origin}/api/certificates/${doc.id}/file`,
    ]),
  ];

  // Dated in company time, so a file downloaded at 08:00 in Singapore isn't
  // named for the previous day.
  const filename = `ben-foods-certificates-${formatDateISO(new Date().toISOString())}.csv`;

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
