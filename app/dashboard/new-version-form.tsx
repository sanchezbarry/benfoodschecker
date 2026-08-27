"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, FilePlus2 } from "lucide-react";

import { uploadNewVersion, type ActionState } from "./actions";
import { uploadCertificateFile } from "./upload-file";
import type { CertDocument } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
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
  MAX_UPLOAD_INPUT_SIZE,
  MAX_UPLOAD_INPUT_SIZE_LABEL,
} from "@/lib/constants";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <FilePlus2 />}
      {pending ? "Uploading…" : "Upload new version"}
    </Button>
  );
}

export function NewVersionForm({ documents }: { documents: CertDocument[] }) {
  // The file goes straight from the browser to Supabase Storage; only its path
  // travels on to the Server Action. Wrapping the action this way keeps
  // `useFormStatus().pending` true across the upload as well as the save.
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const uploaded = await uploadCertificateFile(formData.get("file"));
      if ("error" in uploaded) return { error: uploaded.error };
      formData.delete("file");
      formData.set("file_path", uploaded.path);
      const result = await uploadNewVersion(prev, formData);
      // Tell the user what compression actually saved them.
      return result?.success && uploaded.note
        ? { success: `${result.success} ${uploaded.note}` }
        : result;
    },
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // The reminder settings belong to the certificate rather than to any one
  // version, so picking a certificate fills them in with what it uses today —
  // submit them unchanged to keep that schedule, or edit them to retune it.
  // Written through refs rather than state so `form.reset()` still clears them.
  const reminderRef = useRef<HTMLInputElement>(null);
  const escalationRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  function onCertificateChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const doc = documents.find((d) => d.id === e.target.value);
    if (!doc) return;
    if (reminderRef.current)
      reminderRef.current.value = String(doc.reminder_days_before);
    if (escalationRef.current)
      escalationRef.current.value = String(doc.escalation_days);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Only the outer ceiling is checked here: an oversized photo is fine
    // because it gets downscaled before upload.
    if (file && file.size > MAX_UPLOAD_INPUT_SIZE) {
      alert(`That file is over ${MAX_UPLOAD_INPUT_SIZE_LABEL}. Please pick a smaller one.`);
      e.target.value = "";
    }
  }

  if (documents.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a new version</CardTitle>
        <CardDescription>
          Renew a certificate by uploading its latest file. The new version
          becomes the tracked one — <strong>only its expiry date is
          monitored</strong>, even if you keep the older versions on file.
          Reminders reset so they fire again against the new date, and the
          reminder schedule below — prefilled from the certificate — can be
          adjusted at the same time. {COMPRESSION_HINT}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="version_id">Certificate</Label>
              <Select
                id="version_id"
                name="id"
                required
                defaultValue=""
                onChange={onCertificateChange}
              >
                <option value="" disabled>
                  Select a certificate…
                </option>
                {documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.folder ? `${doc.folder.code} · ` : ""}
                    {doc.cert_type} — expires {formatDate(doc.expiry_date)}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="version_file">New file (PDF / image)</Label>
              <Input
                id="version_file"
                name="file"
                type="file"
                accept={ACCEPTED_FILE_EXTENSIONS}
                onChange={onFileChange}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="version_expiry_date">New expiry date</Label>
              <DateInput
                id="version_expiry_date"
                name="expiry_date"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="version_reminder_days_before">
                Remind me (days before expiry)
              </Label>
              <Input
                id="version_reminder_days_before"
                name="reminder_days_before"
                type="number"
                min={0}
                ref={reminderRef}
                aria-describedby="version-reminder-hint"
                required
              />
              <p
                id="version-reminder-hint"
                className="text-xs text-muted-foreground"
              >
                Heads-up to the marketing contact while it&apos;s still valid.
                Set 0 to skip it.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="version_escalation_days">
                Escalate after (days past expiry)
              </Label>
              <Input
                id="version_escalation_days"
                name="escalation_days"
                type="number"
                min={0}
                ref={escalationRef}
                aria-describedby="version-escalation-hint"
                required
              />
              <p
                id="version-escalation-hint"
                className="text-xs text-muted-foreground"
              >
                How long after expiry senior management is told.
              </p>
            </div>

            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-sm font-medium">
                What should happen to the previous version?
              </legend>
              <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                <input
                  type="radio"
                  name="old_versions"
                  value="retain"
                  defaultChecked
                  className="mt-0.5 accent-primary"
                />
                <span>
                  <span className="font-medium">Retain it</span>
                  <span className="block text-muted-foreground">
                    Keep the old file in the certificate&apos;s history. Its
                    expiry date is kept for reference only and is never
                    reminded on.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                <input
                  type="radio"
                  name="old_versions"
                  value="delete"
                  className="mt-0.5 accent-primary"
                />
                <span>
                  <span className="font-medium">Delete it</span>
                  <span className="block text-muted-foreground">
                    Permanently remove every earlier version and its stored
                    file. This cannot be undone.
                  </span>
                </span>
              </label>
            </fieldset>
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
