"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Loader2, Play, Send, Siren } from "lucide-react";

import {
  runRemindersNow,
  sendEscalationTest,
  sendExpiryTest,
  type AdminState,
} from "./actions";
import type { CertDocument } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function Pending({
  idle,
  busy,
  variant,
}: {
  idle: React.ReactNode;
  busy: string;
  variant?: "default" | "outline";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? busy : idle}
    </Button>
  );
}

function Feedback({ state }: { state: AdminState }) {
  if (state?.error)
    return (
      <p className="text-sm text-destructive" role="alert">
        {state.error}
      </p>
    );
  if (state?.success)
    return (
      <p className="text-sm text-primary" role="status">
        {state.success}
      </p>
    );
  return null;
}

/** Pick a real certificate to render in the test email, or use the built-in sample. */
function CertPicker({
  id,
  certificates,
}: {
  id: string;
  certificates: CertDocument[];
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Certificate to use in the email</Label>
      <Select id={id} name="cert_id" defaultValue="">
        <option value="">Built-in sample certificate</option>
        {certificates.map((doc) => (
          <option key={doc.id} value={doc.id}>
            {doc.folder ? `${doc.folder.code} · ` : ""}
            {doc.cert_type} — expires {formatDate(doc.expiry_date)}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function TestsPanel({
  certificates,
  defaultEmail,
}: {
  certificates: CertDocument[];
  defaultEmail: string;
}) {
  const [expiryState, expiryAction] = useActionState<AdminState, FormData>(
    sendExpiryTest,
    null,
  );
  const [escalationState, escalationAction] = useActionState<
    AdminState,
    FormData
  >(sendEscalationTest, null);
  const [jobState, jobAction] = useActionState<AdminState, FormData>(
    runRemindersNow,
    null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification tests</CardTitle>
        <CardDescription>
          Fire either level of the reminder workflow on demand. Test emails are
          clearly marked as tests and change nothing in the database — no
          certificate is marked as notified or escalated.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ---- Level 1 ---- */}
        <form action={expiryAction} className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <Send className="size-4 text-warning" />
            <h3 className="text-sm font-semibold">
              Level 1 — expiry notification
            </h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="expiry_test_to">Send to</Label>
              <Input
                id="expiry_test_to"
                name="to"
                type="email"
                defaultValue={defaultEmail}
                placeholder="you@benfoods.com"
                required
              />
            </div>
            <CertPicker id="expiry_test_cert" certificates={certificates} />
          </div>
          <Feedback state={expiryState} />
          <Pending idle={<><Send />Send expiry test</>} busy="Sending…" />
        </form>

        {/* ---- Level 2 ---- */}
        <form
          action={escalationAction}
          className="space-y-4 rounded-lg border p-4"
        >
          <div className="flex items-center gap-2">
            <Siren className="size-4 text-destructive" />
            <h3 className="text-sm font-semibold">Level 2 — escalation</h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="escalate_to">Escalate to</Label>
              <Input
                id="escalate_to"
                name="escalate_to"
                type="email"
                defaultValue={defaultEmail}
                placeholder="director@benfoods.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="escalate_cc">Cc (optional)</Label>
              <Input
                id="escalate_cc"
                name="cc"
                type="email"
                placeholder="marketing@benfoods.com"
              />
            </div>
            <div className="sm:col-span-2">
              <CertPicker
                id="escalation_test_cert"
                certificates={certificates}
              />
            </div>
          </div>
          <Feedback state={escalationState} />
          <Pending idle={<><Siren />Send escalation test</>} busy="Sending…" />
        </form>

        {/* ---- The real thing ---- */}
        <form
          action={jobAction}
          onSubmit={(e) => {
            if (
              !confirm(
                "This runs the real daily job now: it emails the actual contacts on any expired certificate and advances their status. Continue?",
              )
            )
              e.preventDefault();
          }}
          className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-4"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" />
            <h3 className="text-sm font-semibold">Run the real job now</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Same code the daily cron runs. This one emails the certificates&apos;
            real contacts and advances their status, so use it when you want the
            workflow to actually fire early — not as a test.
          </p>
          <Feedback state={jobState} />
          <Pending
            idle={<><Play />Run reminder job</>}
            busy="Running…"
            variant="outline"
          />
        </form>
      </CardContent>
    </Card>
  );
}
