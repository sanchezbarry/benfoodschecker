"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  Download,
  FileText,
  Loader2,
  Trash2,
} from "lucide-react";

import { deleteDocument, getSignedUrl } from "./actions";
import type { CertDocument } from "@/lib/types";
import { daysUntil, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function ExpiryBadge({ doc }: { doc: CertDocument }) {
  const days = daysUntil(doc.expiry_date);

  if (doc.status === "escalated")
    return <Badge variant="destructive">Escalated</Badge>;
  if (days < 0)
    return (
      <Badge variant="destructive">Expired {Math.abs(days)}d ago</Badge>
    );
  if (days === 0) return <Badge variant="warning">Expires today</Badge>;
  if (days <= 14) return <Badge variant="warning">In {days}d</Badge>;
  return <Badge variant="secondary">In {days}d</Badge>;
}

function ViewButton({ path }: { path: string }) {
  const [loading, setLoading] = useState(false);
  async function open() {
    setLoading(true);
    const url = await getSignedUrl(path);
    setLoading(false);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }
  return (
    <Button variant="outline" size="sm" onClick={open} disabled={loading}>
      {loading ? <Loader2 className="animate-spin" /> : <Download />}
      View
    </Button>
  );
}

function DeleteButton({ doc }: { doc: CertDocument }) {
  const [pending, startTransition] = useTransition();
  function onDelete() {
    if (!confirm(`Delete "${doc.name}"? This cannot be undone.`)) return;
    const fd = new FormData();
    fd.set("id", doc.id);
    fd.set("file_path", doc.file_path);
    startTransition(() => deleteDocument(fd));
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onDelete}
      disabled={pending}
      className="text-muted-foreground hover:text-destructive"
    >
      {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
    </Button>
  );
}

export function DocumentsList({ documents }: { documents: CertDocument[] }) {
  if (documents.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <FileText className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No documents yet. Add your first certificate above.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tracked documents</CardTitle>
        <CardDescription>
          {documents.length} document{documents.length === 1 ? "" : "s"} being
          monitored.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium">{doc.name}</p>
                <ExpiryBadge doc={doc} />
              </div>
              <p className="text-sm text-muted-foreground">
                Expires {formatDate(doc.expiry_date)} · Escalates{" "}
                {doc.escalation_days}d after
              </p>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>📣 {doc.marketing_email}</span>
                <span>🛡️ {doc.management_email}</span>
                {doc.notified_at && (
                  <span className="inline-flex items-center gap-1 text-warning">
                    <AlertTriangle className="size-3" /> reminded
                  </span>
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ViewButton path={doc.file_path} />
              <DeleteButton doc={doc} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
