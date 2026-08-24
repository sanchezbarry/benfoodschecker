"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { APP_UTC_OFFSET } from "@/lib/constants";

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
 */
export function DateInput({
  id,
  name,
  required,
}: {
  id: string;
  name: string;
  required?: boolean;
}) {
  const [iso, setIso] = useState("");

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value; // "YYYY-MM-DD", or "" when cleared
    // The explicit offset is what makes this Singapore midnight rather
    // than the visitor's midnight.
    setIso(raw ? new Date(`${raw}T00:00:00${APP_UTC_OFFSET}`).toISOString() : "");
  }

  return (
    <>
      <Input id={id} type="date" required={required} onChange={onChange} />
      <input type="hidden" name={name} value={iso} />
    </>
  );
}
