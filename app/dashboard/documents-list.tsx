"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  BellRing,
  Download,
  FileText,
  Folder as FolderIcon,
  History,
  Loader2,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { deleteDocument, deleteVersion, getSignedUrl } from "./actions";
import type { CertDocument, DocumentVersion } from "@/lib/types";
import { daysUntil, formatBytes, formatDate, formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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

function VersionHistory({
  doc,
  canWrite,
}: {
  doc: CertDocument;
  canWrite: boolean;
}) {
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
                · uploaded {formatDateTime(v.created_at)}
                {v.uploaded_by_name ? ` by ${v.uploaded_by_name}` : ""}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <ViewButton path={v.file_path} label="Open" />
              {canWrite && !v.is_current && <DeleteVersionButton version={v} />}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function CertRow({ doc, canWrite }: { doc: CertDocument; canWrite: boolean }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium">{doc.cert_type}</p>
            <ExpiryBadge doc={doc} />
          </div>
          <p className="text-sm text-muted-foreground">
            PIC {doc.pic_name} · Expires {formatDate(doc.expiry_date)} ·{" "}
            {doc.reminder_days_before > 0
              ? `Reminder ${doc.reminder_days_before}d before`
              : "No advance reminder"}{" "}
            · Escalates {doc.escalation_days}d after
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>📣 {doc.marketing_email}</span>
            <span>🛡️ {doc.management_email}</span>
            {doc.reminded_at && (
              <span className="inline-flex items-center gap-1 text-primary">
                <BellRing className="size-3" /> advance reminder sent
              </span>
            )}
            {doc.notified_at && (
              <span className="inline-flex items-center gap-1 text-warning">
                <AlertTriangle className="size-3" /> expiry notice sent
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ViewButton path={doc.file_path} />
          {canWrite && <DeleteDocumentButton doc={doc} />}
        </div>
      </div>
      <VersionHistory doc={doc} canWrite={canWrite} />
    </div>
  );
}

/** Which end of the expiry range the list leads with. */
type SortOrder = "soonest" | "furthest";

const expiryOf = (doc: CertDocument) => new Date(doc.expiry_date).getTime();

/**
 * Group certificates under their vendor / customer folder, ordered by expiry.
 *
 * The folders follow their own most pressing certificate rather than staying
 * A→Z: sorting only *inside* each folder would reorder rows buried down the
 * page while the thing the user is hunting for — what expires next — stayed
 * wherever its vendor code happened to fall. Folders whose leading certificate
 * expires on the same day keep the old A→Z order between them.
 */
function groupByFolder(documents: CertDocument[], order: SortOrder) {
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

  const direction = order === "soonest" ? 1 : -1;
  const grouped = [...groups.values()];

  for (const group of grouped) {
    group.docs.sort((a, b) => (expiryOf(a) - expiryOf(b)) * direction);
  }

  // After that sort every group leads with the certificate it should be
  // ranked by, whichever direction was chosen.
  return grouped.sort(
    (a, b) =>
      (expiryOf(a.docs[0]) - expiryOf(b.docs[0])) * direction ||
      a.code.localeCompare(b.code),
  );
}

export function DocumentsList({
  documents,
  viewAll,
  canWrite,
}: {
  documents: CertDocument[];
  /** Whether this account sees everyone's certificates, not just its own. */
  viewAll: boolean;
  /** Department accounts are view-only, so their delete controls are dropped. */
  canWrite: boolean;
}) {
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<SortOrder>("soonest");

  // Vendor code and name only, as asked. Tokenised so "fresh life" matches
  // "Fresh Life Pte Ltd" and "FL001 fresh" matches too.
  const matches = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return documents;
    return documents.filter((doc) => {
      const haystack =
        `${doc.folder?.code ?? ""} ${doc.folder?.name ?? ""}`.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }, [documents, query]);

  if (documents.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <FileText className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {canWrite
              ? "No certificates yet. Add your first one above."
              : "No certificates have been filed yet."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const groups = groupByFolder(matches, order);
  const filtering = query.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tracked certificates</CardTitle>
        <CardDescription>
          {filtering
            ? `${matches.length} of ${documents.length} certificate${documents.length === 1 ? "" : "s"} match.`
            : `${documents.length} certificate${documents.length === 1 ? "" : "s"} across ${groups.length} vendor${groups.length === 1 ? "" : "s"}${viewAll ? " — showing every user's." : "."}`}
          {!canWrite && " Downloads only; nothing here can be changed."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by vendor code or name…"
              aria-label="Search certificates by vendor code or name"
              className="pl-9 pr-9"
            />
            {filtering && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <Select
            value={order}
            onChange={(e) => setOrder(e.target.value as SortOrder)}
            aria-label="Sort certificates by expiry date"
            className="sm:w-56"
          >
            <option value="soonest">Closest to expiry first</option>
            <option value="furthest">Furthest from expiry first</option>
          </Select>
        </div>

        {groups.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No vendor matches &ldquo;{query.trim()}&rdquo;.
          </p>
        )}

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
                <CertRow key={doc.id} doc={doc} canWrite={canWrite} />
              ))}
            </div>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
