"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  Download,
  FileText,
  Folder as FolderIcon,
  History,
  Loader2,
  Trash2,
} from "lucide-react";

import { deleteDocument, deleteVersion, getSignedUrl } from "./actions";
import type { CertDocument, DocumentVersion } from "@/lib/types";
import { daysUntil, formatBytes, formatDate } from "@/lib/utils";
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
    return <Badge variant="destructive">Expired {Math.abs(days)}d ago</Badge>;
  if (days === 0) return <Badge variant="warning">Expires today</Badge>;
  if (days <= 14) return <Badge variant="warning">In {days}d</Badge>;
  return <Badge variant="secondary">In {days}d</Badge>;
}

function ViewButton({
  path,
  label = "View",
}: {
  path: string;
  label?: string;
}) {
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
      {label}
    </Button>
  );
}

function DeleteDocumentButton({ doc }: { doc: CertDocument }) {
  const [pending, startTransition] = useTransition();
  function onDelete() {
    const versions = doc.versions?.length ?? 0;
    const extra =
      versions > 1 ? ` and all ${versions} of its versions` : "";
    if (
      !confirm(`Delete "${doc.cert_type}"${extra}? This cannot be undone.`)
    )
      return;
    const fd = new FormData();
    fd.set("id", doc.id);
    startTransition(() => deleteDocument(fd));
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onDelete}
      disabled={pending}
      aria-label={`Delete ${doc.cert_type}`}
      className="text-muted-foreground hover:text-destructive"
    >
      {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
    </Button>
  );
}

function DeleteVersionButton({ version }: { version: DocumentVersion }) {
  const [pending, startTransition] = useTransition();
  function onDelete() {
    if (!confirm(`Delete version ${version.version}? This cannot be undone.`))
      return;
    const fd = new FormData();
    fd.set("version_id", version.id);
    startTransition(() => deleteVersion(fd));
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onDelete}
      disabled={pending}
      aria-label={`Delete version ${version.version}`}
      className="text-muted-foreground hover:text-destructive"
    >
      {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
    </Button>
  );
}

function VersionHistory({ doc }: { doc: CertDocument }) {
  const versions = [...(doc.versions ?? [])].sort(
    (a, b) => b.version - a.version,
  );
  if (versions.length <= 1) return null;

  return (
    <details className="mt-3 rounded-lg border bg-muted/30 px-3 py-2">
      <summary className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <History className="size-3.5" />
        {versions.length} versions on file
      </summary>
      <ul className="mt-2 space-y-2">
        {versions.map((v) => (
          <li
            key={v.id}
            className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground first:border-t-0 first:pt-0"
          >
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium text-foreground">v{v.version}</span>
              {v.is_current ? (
                <Badge variant="default">tracked</Badge>
              ) : (
                <Badge variant="outline">retained</Badge>
              )}
              <span>expiry {formatDate(v.expiry_date)}</span>
              <span>· {formatBytes(v.file_size)}</span>
              <span>
                · uploaded {formatDate(v.created_at)}
                {v.uploaded_by_name ? ` by ${v.uploaded_by_name}` : ""}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <ViewButton path={v.file_path} label="Open" />
              {!v.is_current && <DeleteVersionButton version={v} />}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function CertRow({ doc }: { doc: CertDocument }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium">{doc.cert_type}</p>
            <ExpiryBadge doc={doc} />
          </div>
          <p className="text-sm text-muted-foreground">
            PIC {doc.pic_name} · Expires {formatDate(doc.expiry_date)} ·
            Escalates {doc.escalation_days}d after
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
          <DeleteDocumentButton doc={doc} />
        </div>
      </div>
      <VersionHistory doc={doc} />
    </div>
  );
}

/** Group certificates under their vendor / customer folder, folders A→Z. */
function groupByFolder(documents: CertDocument[]) {
  const groups = new Map<
    string,
    { code: string; name: string; docs: CertDocument[] }
  >();

  for (const doc of documents) {
    const key = doc.folder?.id ?? "unfiled";
    const group = groups.get(key) ?? {
      code: doc.folder?.code ?? "—",
      name: doc.folder?.name ?? "Unfiled",
      docs: [],
    };
    group.docs.push(doc);
    groups.set(key, group);
  }

  return [...groups.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function DocumentsList({
  documents,
  isAdmin,
}: {
  documents: CertDocument[];
  isAdmin: boolean;
}) {
  if (documents.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <FileText className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No certificates yet. Add your first one above.
          </p>
        </CardContent>
      </Card>
    );
  }

  const groups = groupByFolder(documents);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tracked certificates</CardTitle>
        <CardDescription>
          {documents.length} certificate{documents.length === 1 ? "" : "s"}{" "}
          across {groups.length} vendor
          {groups.length === 1 ? "" : "s"}
          {isAdmin ? " — showing every user's, because you're an admin." : "."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {groups.map((group) => (
          <section key={group.code} className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <FolderIcon className="size-4 text-muted-foreground" />
              <span className="font-mono">{group.code}</span>
              <span className="text-muted-foreground">— {group.name}</span>
              <Badge variant="secondary">{group.docs.length}</Badge>
            </h3>
            <div className="space-y-3">
              {group.docs.map((doc) => (
                <CertRow key={doc.id} doc={doc} />
              ))}
            </div>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
