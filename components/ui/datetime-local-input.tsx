"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * A datetime-local picker that submits a real UTC ISO timestamp instead of
 * the raw local-time string. `datetime-local` values carry no timezone info,
 * so parsing them with `new Date()` on the server would use the *server's*
 * timezone, not the visitor's. Converting here, in the browser, means the
 * conversion always uses the visitor's actual local timezone.
 */
export function DateTimeLocalInput({
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
    const raw = e.target.value;
    setIso(raw ? new Date(raw).toISOString() : "");
  }

  return (
    <>
      <Input id={id} type="datetime-local" required={required} onChange={onChange} />
      <input type="hidden" name={name} value={iso} />
    </>
  );
}
