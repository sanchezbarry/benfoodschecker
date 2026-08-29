"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { APP_TIME_ZONE, APP_UTC_OFFSET } from "@/lib/constants";

/** The calendar date a stored expiry falls on in the company timezone. */
function appCalendarDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // en-CA renders as YYYY-MM-DD, which is what <input type="date"> wants.
  return date.toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}

/** A picked "YYYY-MM-DD" as the instant Singapore midnight falls on that day. */
function appMidnight(day: string) {
  return day ? new Date(`${day}T00:00:00${APP_UTC_OFFSET}`).toISOString() : "";
}

/**
 * A date picker that submits the chosen calendar date as midnight **Singapore
 * time**.
 *
 * An expiry is a calendar date, not a moment, so it has to read the same to
 * everybody. Using the visitor's midnight does not achieve that: picked in
 * Singapore, "23 Aug" is stored as 2026-08-22T16:00Z, which a browser in
 * Singapore prints as 23 Aug and a server in UTC prints as 22 Aug — the same
 * row showing two different dates on the dashboard and in the reminder email.
 *
 * Pinning to APP_UTC_OFFSET removes the ambient timezone from the round trip:
 * the date is stored against one fixed zone and `formatDate` reads it back in
 * that same zone, so every viewer and the server agree — including anyone
 * filing a certificate while travelling.
 *
 * `defaultValue` takes a stored expiry (an ISO timestamp) for the edit form,
 * and is put back through the same conversion rather than resubmitted as-is, so
 * a row written before that pinning existed is corrected by being re-saved.
 */
export function DateInput({
  id,
  name,
  required,
  defaultValue,
}: {
  id: string;
  name: string;
  required?: boolean;
  /** A stored ISO timestamp to prefill, in the company timezone. */
  defaultValue?: string | null;
}) {
  const initial = appCalendarDate(defaultValue);
  const [iso, setIso] = useState(() => appMidnight(initial));

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    // "YYYY-MM-DD", or "" when cleared. The explicit offset is what makes this
    // Singapore midnight rather than the visitor's midnight.
    setIso(appMidnight(e.target.value));
  }

  return (
    <>
      <Input
        id={id}
        type="date"
        required={required}
        defaultValue={initial}
        onChange={onChange}
      />
      <input type="hidden" name={name} value={iso} />
    </>
  );
}
