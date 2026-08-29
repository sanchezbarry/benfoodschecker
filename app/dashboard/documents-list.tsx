"use client";

import {
  useActionState,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useFormStatus } from "react-dom";
import {
  AlertTriangle,
  BellRing,
  Download,
  FileText,
  Folder as FolderIcon,
  History,
  Loader2,
  Pencil,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";

import {
  deleteDocument,
  deleteVersion,
  getSignedUrl,
  updateDocument,
  type ActionState,
} from "./actions";
import type { CertDocument, DocumentVersion, Suggestions } from "@/lib/types";
import { daysUntil, formatBytes, formatDate, formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ComboboxInput } from "@/components/ui/combobox-input";
import { DateInput } from "@/components/ui/date-input";
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

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Save />}
      {pending ? "Saving…" : "Save changes"}
    </Button>
  );
}

/**
 * Fix what was typed when the certificate was filed: the vendor it belongs to
 * and the date it expires. The file is not touched here — replacing that is
 * what "Upload a new version" is for.
 *
 * Code and name behave exactly as they do on the upload form, including filling
 * each other in, so correcting a vendor is the same gesture as choosing one.
 */
function EditCertForm({
  doc,
  vendors,
  onClose,
}: {
  doc: CertDocument;
  vendors: Suggestions["vendors"];
  onClose: () => void;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    updateDocument,
    null,
  );

  // Written to the sibling input through a ref rather than through state, so
  // the fields stay uncontrolled and keep whatever the user has typed.
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const codes = useMemo(() => vendors.map((v) => v.code), [vendors]);
  const names = useMemo(() => vendors.map((v) => v.name), [vendors]);

  function findVendor(key: "code" | "name", value: string) {
    const needle = value.trim().toLowerCase();
    if (!needle) return undefined;
    return vendors.find((v) => v[key].toLowerCase() === needle);
  }

  function onCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const match = findVendor("code", e.target.value);
    if (match && nameRef.current) nameRef.current.value = match.name;
  }

  function onNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const match = findVendor("name", e.target.value);
    if (match && codeRef.current) codeRef.current.value = match.code;
  }

  return (
    <form
      action={formAction}
      className="mt-3 space-y-3 rounded-lg border bg-muted/30 p-3"
    >
      <input type="hidden" name="id" value={doc.id} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor={`edit-code-${doc.id}`}>Vendor / customer code</Label>
          <ComboboxInput
            id={`edit-code-${doc.id}`}
            name="vendor_code"
            options={codes}
            ref={codeRef}
            defaultValue={doc.folder?.code ?? ""}
            onChange={onCodeChange}
            className="font-mono"
            autoComplete="off"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`edit-name-${doc.id}`}>Vendor / customer name</Label>
          <ComboboxInput
            id={`edit-name-${doc.id}`}
            name="vendor_name"
            options={names}
            ref={nameRef}
            defaultValue={doc.folder?.name ?? ""}
            onChange={onNameChange}
            autoComplete="off"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`edit-expiry-${doc.id}`}>Expiry date</Label>
          <DateInput
            id={`edit-expiry-${doc.id}`}
            name="expiry_date"
            defaultValue={doc.expiry_date}
            required
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        The code decides which folder this certificate is filed under — an
        existing code moves it there, a new one creates the folder. A changed
        name renames the vendor, as long as the folder holds none of anyone
        else&apos;s certificates. Correcting the expiry re-arms the reminders;
        to replace the file itself, upload a new version.
      </p>

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

      <div className="flex items-center gap-2">
        <SaveButton />
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {state?.success ? "Close" : "Cancel"}
        </Button>
      </div>
    </form>
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

function CertRow({
  doc,
  canWrite,
  vendors,
}: {
  doc: CertDocument;
  canWrite: boolean;
  vendors: Suggestions["vendors"];
}) {
  const [editing, setEditing] = useState(false);

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
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing((open) => !open)}
              aria-expanded={editing}
            >
              <Pencil />
              {editing ? "Close" : "Edit"}
            </Button>
          )}
          {canWrite && <DeleteDocumentButton doc={doc} />}
        </div>
      </div>
      {canWrite && editing && (
        <EditCertForm
          doc={doc}
          vendors={vendors}
          onClose={() => setEditing(false)}
        />
      )}
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
  vendors,
}: {
  documents: CertDocument[];
  /** Whether this account sees everyone's certificates, not just its own. */
  viewAll: boolean;
  /**
   * Department accounts are view-only, so their edit and delete controls are
   * dropped. Admins keep theirs on every row, not just their own.
   */
  canWrite: boolean;
  /** Existing vendors, offered as hints on the edit form. */
  vendors: Suggestions["vendors"];
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
                <CertRow
                  key={doc.id}
                  doc={doc}
                  canWrite={canWrite}
                  vendors={vendors}
                />
              ))}
            </div>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
