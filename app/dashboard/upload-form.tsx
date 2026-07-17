"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Upload } from "lucide-react";

import { createDocument, type ActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      {pending ? "Uploading…" : "Add document"}
    </Button>
  );
}

export function UploadForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(
    createDocument,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Reset the form after a successful upload.
  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  // Client-side size guard for immediate feedback (server re-validates).
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
        <CardTitle>Add a document</CardTitle>
        <CardDescription>
          Upload a certificate (PDF or image, max {MAX_FILE_SIZE_LABEL}) and set
          when it expires. Reminders are sent automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">Document name</Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g. Halal Certificate — Plant A"
                required
              />
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
              <Label htmlFor="expiry_date">Expiry date</Label>
              <Input
                id="expiry_date"
                name="expiry_date"
                type="date"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="marketing_email">Marketing contact email</Label>
              <Input
                id="marketing_email"
                name="marketing_email"
                type="email"
                placeholder="marketing@benfoods.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="management_email">Senior management email</Label>
              <Input
                id="management_email"
                name="management_email"
                type="email"
                placeholder="director@benfoods.com"
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
