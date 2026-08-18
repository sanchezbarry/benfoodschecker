import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format an ISO timestamp (date, or date+time) for display, including the time. */
export function formatDate(date: string | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Whole calendar days from today until `date` (negative = overdue). Ignores time-of-day. */
export function daysUntil(date: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
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
