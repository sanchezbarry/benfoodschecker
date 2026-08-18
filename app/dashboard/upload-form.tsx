"use client";

import { useActionState, useEffect, useMemo, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Upload } from "lucide-react";

import { createDocument, type ActionState } from "./actions";
import type { Suggestions } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ComboboxInput } from "@/components/ui/combobox-input";
import { DateTimeLocalInput } from "@/components/ui/datetime-local-input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ACCEPTED_FILE_EXTENSIONS,
  DEFAULT_ESCALATION_DAYS,
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_LABEL,
} from "@/lib/constants";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Upload />}
      {pending ? "Uploading…" : "Add certificate"}
    </Button>
  );
}

export function UploadForm({
  suggestions,
  picName,
}: {
  suggestions: Suggestions;
  picName: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    createDocument,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Vendor code and name are two views of the same folder, so choosing either
  // from its dropdown fills in the other. Done by writing to the sibling input
  // rather than through React state, so `form.reset()` still clears both.
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const codes = useMemo(
    () => suggestions.vendors.map((v) => v.code),
    [suggestions.vendors],
  );
  const names = useMemo(
    () => suggestions.vendors.map((v) => v.name),
    [suggestions.vendors],
  );

  function findVendor(key: "code" | "name", value: string) {
    const needle = value.trim().toLowerCase();
    if (!needle) return undefined;
    return suggestions.vendors.find((v) => v[key].toLowerCase() === needle);
  }

  function onCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const match = findVendor("code", e.target.value);
    if (match && nameRef.current) nameRef.current.value = match.name;
  }

  function onNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const match = findVendor("name", e.target.value);
    if (match && codeRef.current) codeRef.current.value = match.code;
  }

  // Reset the form after a successful upload.
  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  // Client-side size guard for immediate feedback (the server re-validates).
  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && file.size > MAX_FILE_SIZE) {
      alert(`File is too large. Max size is ${MAX_FILE_SIZE_LABEL}.`);
      e.target.value = "";
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a certificate</CardTitle>
        <CardDescription>
          Certificates are filed under a vendor / customer folder. Type a new
          code to create the folder, or pick one already in use. Free-text
          fields offer what has been entered before — you can always type
          something new. PDF or image, max {MAX_FILE_SIZE_LABEL}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="vendor_code">Vendor / customer code</Label>
              <ComboboxInput
                id="vendor_code"
                name="vendor_code"
                options={codes}
                ref={codeRef}
                onChange={onCodeChange}
                placeholder="e.g. FL001"
                autoComplete="off"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vendor_name">Vendor / customer name</Label>
              <ComboboxInput
                id="vendor_name"
                name="vendor_name"
                options={names}
                ref={nameRef}
                onChange={onNameChange}
                placeholder="e.g. Fresh Life Pte Ltd"
                autoComplete="off"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pic">PIC</Label>
              <Input
                id="pic"
                value={picName}
                readOnly
                aria-describedby="pic-hint"
                className="cursor-not-allowed text-muted-foreground"
              />
              <p id="pic-hint" className="text-xs text-muted-foreground">
                Set automatically from your account.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cert_type">Certificate type</Label>
              <ComboboxInput
                id="cert_type"
                name="cert_type"
                options={suggestions.certTypes}
                placeholder="e.g. SUPPLIER FORM, ISO 22000"
                autoComplete="off"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="expiry_date">Expiry date &amp; time</Label>
              <DateTimeLocalInput id="expiry_date" name="expiry_date" required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="file">File (PDF / image)</Label>
              <Input
                id="file"
                name="file"
                type="file"
                accept={ACCEPTED_FILE_EXTENSIONS}
                onChange={onFileChange}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="marketing_email">Marketing contact email</Label>
              <ComboboxInput
                id="marketing_email"
                name="marketing_email"
                type="email"
                options={suggestions.marketingEmails}
                placeholder="marketing@benfoods.com"
                autoComplete="off"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="management_email">Senior management email</Label>
              <ComboboxInput
                id="management_email"
                name="management_email"
                type="email"
                options={suggestions.managementEmails}
                placeholder="director@benfoods.com"
                autoComplete="off"
                required
              />
            </div>

            <div className="space-y-2 sm:col-span-2 sm:max-w-[220px]">
              <Label htmlFor="escalation_days">
                Escalate after (days past expiry)
              </Label>
              <Input
                id="escalation_days"
                name="escalation_days"
                type="number"
                min={0}
                defaultValue={DEFAULT_ESCALATION_DAYS}
                required
              />
            </div>
          </div>

          {state?.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}
          {state?.success && (
            <p className="text-sm text-primary" role="status">
              {state.success}
            </p>
          )}

          <SubmitButton />
        </form>
      </CardContent>
    </Card>
  );
}
