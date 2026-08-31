"use client";

import { useActionState, useEffect, useMemo, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Upload } from "lucide-react";

import { createDocument, type ActionState } from "./actions";
import { uploadCertificateFile } from "./upload-file";
import type { Suggestions } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ComboboxInput } from "@/components/ui/combobox-input";
import { DateInput } from "@/components/ui/date-input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { COMPRESSION_HINT } from "@/lib/compress";
import {
  ACCEPTED_FILE_EXTENSIONS,
  DEFAULT_ESCALATION_DAYS,
  DEFAULT_REMINDER_DAYS_BEFORE,
  DEFAULT_SECOND_REMINDER_DAYS_BEFORE,
  MAX_UPLOAD_INPUT_SIZE,
  MAX_UPLOAD_INPUT_SIZE_LABEL,
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
  // The file goes straight from the browser to Supabase Storage; only its path
  // travels on to the Server Action. Wrapping the action this way keeps
  // `useFormStatus().pending` true across the upload as well as the save.
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const uploaded = await uploadCertificateFile(formData.get("file"));
      if ("error" in uploaded) return { error: uploaded.error };
      formData.delete("file");
      formData.set("file_path", uploaded.path);
      const result = await createDocument(prev, formData);
      // Tell the user what compression actually saved them.
      return result?.success && uploaded.note
        ? { success: `${result.success} ${uploaded.note}` }
        : result;
    },
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
    // Only the outer ceiling is checked here: an oversized photo is fine
    // because it gets downscaled before upload.
    if (file && file.size > MAX_UPLOAD_INPUT_SIZE) {
      alert(`That file is over ${MAX_UPLOAD_INPUT_SIZE_LABEL}. Please pick a smaller one.`);
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
          something new. The reminder schedule below is prefilled with the
          standard{" "}
          {`${DEFAULT_REMINDER_DAYS_BEFORE}/${DEFAULT_SECOND_REMINDER_DAYS_BEFORE}`}-day
          warnings and a {DEFAULT_ESCALATION_DAYS}-day escalation; change any of
          them if this certificate needs a different run-up. {COMPRESSION_HINT}
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
              <Label htmlFor="expiry_date">Expiry date</Label>
              <DateInput id="expiry_date" name="expiry_date" required />
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

            <div className="space-y-2">
              <Label htmlFor="reminder_days_before">
                First reminder (days before expiry)
              </Label>
              <Input
                id="reminder_days_before"
                name="reminder_days_before"
                type="number"
                min={0}
                defaultValue={DEFAULT_REMINDER_DAYS_BEFORE}
                aria-describedby="reminder-hint"
                required
              />
              <p id="reminder-hint" className="text-xs text-muted-foreground">
                Early heads-up to the marketing contact, while there is still
                time to start the renewal. Set 0 to skip it.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="second_reminder_days_before">
                Second reminder (days before expiry)
              </Label>
              <Input
                id="second_reminder_days_before"
                name="second_reminder_days_before"
                type="number"
                min={0}
                defaultValue={DEFAULT_SECOND_REMINDER_DAYS_BEFORE}
                aria-describedby="second-reminder-hint"
                required
              />
              <p
                id="second-reminder-hint"
                className="text-xs text-muted-foreground"
              >
                The follow-up, closer to expiry — so fewer days than the first.
                Set 0 to skip it.
              </p>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="escalation_days">
                Escalate after (days past expiry)
              </Label>
              <Input
                id="escalation_days"
                name="escalation_days"
                type="number"
                min={0}
                defaultValue={DEFAULT_ESCALATION_DAYS}
                aria-describedby="escalation-hint"
                className="sm:max-w-[calc(50%-0.5rem)]"
                required
              />
              <p id="escalation-hint" className="text-xs text-muted-foreground">
                How long after expiry senior management is told.
              </p>
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
