"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, FilePlus2 } from "lucide-react";

import { uploadNewVersion, type ActionState } from "./actions";
import type { CertDocument } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
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
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_LABEL,
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
  const [state, formAction] = useActionState<ActionState, FormData>(
    uploadNewVersion,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && file.size > MAX_FILE_SIZE) {
      alert(`File is too large. Max size is ${MAX_FILE_SIZE_LABEL}.`);
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
          Reminders reset so they fire again against the new date.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="version_id">Certificate</Label>
              <Select id="version_id" name="id" required defaultValue="">
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
              <Label htmlFor="version_expiry_date">
                New expiry date &amp; time
              </Label>
              <DateTimeLocalInput
                id="version_expiry_date"
                name="expiry_date"
                required
              />
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
