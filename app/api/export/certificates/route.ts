import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "@/lib/session";
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
 * Authorisation is RLS, not a check written here: the query runs on the
 * caller's own session client, so a standard user's file holds their own
 * certificates and an admin's or department account's holds everybody's —
 * exactly the rows the dashboard would show them. There is deliberately no
 * second permission model to keep in sync with the first.
 *
 * `?q=` applies the dashboard's vendor search, using the same matcher the list
 * uses, so the button next to that search box downloads what is on screen.
 *
 * Note that /api is excluded from the proxy's matcher, so an unauthenticated
 * request arrives here rather than being redirected — hence the 401 below.
 */
export async function GET(request: NextRequest) {
  const { supabase, user } = await getSession();
  if (!user)
    return NextResponse.json(
      { error: "You must be signed in." },
      { status: 401 },
    );

  const { data, error } = await supabase
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
