"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * A date picker that submits a real ISO timestamp pinned to 00:00 on the
 * chosen day, in the visitor's timezone.
 *
 * Two conversions have to happen in the browser, not on the server:
 *
 *   - `new Date("2026-08-19")` is parsed as UTC midnight, which in Singapore
 *     is 08:00 on the 19th and in New York is 20:00 on the *18th*. Appending
 *     the time (`"2026-08-19T00:00:00"`) makes it parse as LOCAL midnight,
 *     which is what "expires on the 19th" means to the person typing it.
 *   - Doing it here rather than in the Server Action means the conversion uses
 *     the visitor's timezone rather than the server's.
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
    setIso(raw ? new Date(`${raw}T00:00:00`).toISOString() : "");
  }

  return (
    <>
      <Input id={id} type="date" required={required} onChange={onChange} />
      <input type="hidden" name={name} value={iso} />
    </>
  );
}
