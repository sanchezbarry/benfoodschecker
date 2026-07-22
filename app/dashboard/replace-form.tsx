"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, RefreshCw } from "lucide-react";

import { replaceDocument, type ActionState } from "./actions";
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
import { ACCEPTED_FILE_EXTENSIONS, MAX_FILE_SIZE, MAX_FILE_SIZE_LABEL } from "@/lib/constants";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      {pending ? "Replacing…" : "Replace document"}
    </Button>
  );
}

export function ReplaceForm({ documents }: { documents: CertDocument[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    replaceDocument,
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
        <CardTitle>Replace an expired document</CardTitle>
        <CardDescription>
          Renew a tracked certificate: pick the existing document, upload the
          new file, and set its new expiry. Contacts and escalation settings
          are kept as-is, and reminders reset so they fire again next cycle.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="replace_id">Document to replace</Label>
              <Select id="replace_id" name="id" required defaultValue="">
                <option value="" disabled>
                  Select a document…
                </option>
                {documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.name} — expired {formatDate(doc.expiry_date)}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="replace_file">New file (PDF / image)</Label>
              <Input
                id="replace_file"
                name="file"
                type="file"
                accept={ACCEPTED_FILE_EXTENSIONS}
                onChange={onFileChange}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="replace_expiry_date">New expiry date &amp; time</Label>
              <DateTimeLocalInput
                id="replace_expiry_date"
                name="expiry_date"
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
