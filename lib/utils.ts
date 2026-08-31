import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import { APP_TIME_ZONE } from "@/lib/constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format an expiry for display.
 *
 * Pinned to the company timezone rather than the ambient one. Without that the
 * same stored instant prints as one date in a Singapore browser and the day
 * before on a UTC server — which is exactly how a certificate came to show
 * "Aug 23" on the dashboard and "Aug 22" in its own reminder email.
 */
export function formatDate(date: string | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString(undefined, {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format a real moment in time (an upload, a sign-in), where the clock matters.
 * Also Singapore time, so timestamps read the same for everyone.
 */
export function formatDateTime(date: string | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleString(undefined, {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The calendar date as `YYYY-MM-DD`, in the company timezone.
 *
 * The shape a spreadsheet sorts and filters on, so it is what the CSV export
 * writes — `formatDate`'s "24 Aug 2026" reads better but sorts as text.
 */
export function formatDateISO(date: string | null | undefined) {
  if (!date) return "";
  // en-CA renders as YYYY-MM-DD, which also reparses cleanly as a UTC day.
  return new Date(date).toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}

/**
 * Whole calendar days from today until `date` (negative = overdue).
 *
 * Counted in the company timezone to match `formatDate`. Mixing the two would let a row read
 * "Expires Aug 23 · Expired 1d ago" around midnight, because the label and the
 * countdown would be working from different calendars.
 */
export function daysUntil(date: string) {
  const startOfDay = (d: Date) =>
    Date.parse(`${formatDateISO(d.toISOString())}T00:00:00Z`);
  return Math.round(
    (startOfDay(new Date(date)) - startOfDay(new Date())) / 86_400_000,
  );
}

/**
 * Split a vendor search box into tokens, so "fresh life" matches "Fresh Life
 * Pte Ltd" and "FL001 fresh" matches too.
 */
export function vendorQueryTokens(query: string) {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Does a certificate's vendor code or name match every token?
 *
 * Shared by the dashboard list and the CSV export, so the file that downloads
 * is exactly the list on screen rather than something that drifted from it.
 */
export function matchesVendorQuery(
  doc: { folder?: { code: string; name: string } | null },
  tokens: string[],
) {
  if (tokens.length === 0) return true;
  const haystack =
    `${doc.folder?.code ?? ""} ${doc.folder?.name ?? ""}`.toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

/**
 * Human label for a certificate: cert type plus the vendor/customer folder it
 * is filed in. Structurally typed so both DB rows and the synthetic sample used
 * by the admin test triggers can be passed in.
 */
export function certLabel(cert: {
  cert_type: string;
  folder?: { code: string; name: string } | null;
}) {
  if (!cert.folder) return cert.cert_type;
  return `${cert.cert_type} — ${cert.folder.code} ${cert.folder.name}`;
}

/** "1.4 MB" etc., for the version history list. */
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
