"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { displayName } from "@/lib/auth";
import type { DocumentVersion } from "@/lib/types";
import {
  ACCEPTED_MIME_TYPES,
  DEFAULT_ESCALATION_DAYS,
  DEFAULT_REMINDER_DAYS_BEFORE,
  DOCUMENTS_BUCKET,
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_LABEL,
} from "@/lib/constants";

export type ActionState = { error?: string; success?: string } | null;
export type UploadTicket = { path: string; token: string } | { error: string };

/*
 * Department accounts read everything and change nothing. Hiding the forms is
 * not a boundary — a Server Action is a reachable POST endpoint either way —
 * so every write below re-derives `write` from the session, and the RLS
 * policies enforce the same rule independently at the database.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The extension is derived from the MIME type rather than the uploaded
 * filename, so a client can't smuggle a path or a misleading suffix into the
 * bucket.
 */
const EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

type SessionClient = Awaited<ReturnType<typeof getSession>>["supabase"];

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

/**
 * Mint a short-lived signed URL so the browser can upload a certificate
 * **straight to Supabase Storage**, instead of streaming the bytes through a
 * Server Action.
 *
 * Server Actions cap request bodies at 1 MB, and on Vercel the platform caps
 * them at 4.5 MB no matter what `serverActions.bodySizeLimit` says — both well
 * under the 10 MB this app allows. Going direct sidesteps both: the action then
 * only receives the resulting path, a couple of hundred bytes.
 *
 * The path is built from the session, never from the client, so it always lands
 * in the folder the storage policy lets this user write to.
 */
export async function createUploadTicket(
  contentType: string,
): Promise<UploadTicket> {
  const { supabase, user, write } = await getSession();
  if (!user) return { error: "You must be signed in." };
  if (!write) return { error: "Your account is view-only, so it can't change certificates." };

  const extension = EXTENSION_BY_MIME[contentType];
  if (!extension)
    return { error: "Only PDF, PNG, JPG, or WEBP files are allowed." };

  const path = `${user.id}/${crypto.randomUUID()}.${extension}`;

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data)
    return {
      error: `Could not start the upload: ${error?.message ?? "unknown error"}`,
    };

  return { path, token: data.token };
}

/**
 * Confirm a path the browser hands back really is an object this user just
 * uploaded, and read its true size and MIME type from storage.
 *
 * We minted the path, but it makes a round trip through the client, so it is
 * untrusted on the way back. Reading the metadata here rather than accepting
 * the client's word for it is also what supplies the `file_size` / `file_type`
 * columns. (The bucket independently enforces the size and MIME limits, so this
 * is the second of two gates, not the only one.)
 */
async function claimUpload(
  supabase: SessionClient,
  userId: string,
  path: string,
): Promise<
  { ok: true; type: string; size: number } | { ok: false; error: string }
> {
  if (!path.startsWith(`${userId}/`) || path.includes(".."))
    return { ok: false, error: "That upload doesn't belong to you." };

  const separator = path.lastIndexOf("/");
  const folder = path.slice(0, separator);
  const name = path.slice(separator + 1);

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .list(folder, { search: name, limit: 100 });

  const object = data?.find((o) => o.name === name);
  if (error || !object)
    return {
      ok: false,
      error: "The uploaded file could not be found. Please try again.",
    };

  const size = Number(object.metadata?.size ?? 0);
  const type = String(object.metadata?.mimetype ?? "");

  if (!size) return { ok: false, error: "The uploaded file is empty." };
  if (size > MAX_FILE_SIZE)
    return {
      ok: false,
      error: `File is too large. Max size is ${MAX_FILE_SIZE_LABEL}.`,
    };
  if (!ACCEPTED_MIME_TYPES.includes(type as (typeof ACCEPTED_MIME_TYPES)[number]))
    return {
      ok: false,
      error: "Only PDF, PNG, JPG, or WEBP files are allowed.",
    };

  return { ok: true, type, size };
}

/** Drop an already-uploaded object when the surrounding action can't complete. */
async function discard(supabase: SessionClient, path: string) {
  if (path) await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * File a new certificate against a file the browser has already uploaded.
 *
 * Vendor code and name are free text with dropdown hints. An unrecognised code
 * creates the vendor folder on the fly; a code that already exists files the
 * certificate into that folder and keeps the folder's stored name (renaming a
 * vendor is an admin action, so a typo here can't rewrite it for everyone).
 */
export async function createDocument(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user, write } = await getSession();
  if (!user) return { error: "You must be signed in." };
  if (!write) return { error: "Your account is view-only, so it can't change certificates." };

  const filePath = String(formData.get("file_path") ?? "");

  // The file is already in the bucket by the time this runs, so every failure
  // from here on has to take it back out rather than leave an orphan behind.
  const fail = async (error: string): Promise<ActionState> => {
    await discard(supabase, filePath);
    return { error };
  };

  const vendorCode = String(formData.get("vendor_code") ?? "").trim();
  const vendorName = String(formData.get("vendor_name") ?? "").trim();
  const certType = String(formData.get("cert_type") ?? "").trim();
  const expiryRaw = String(formData.get("expiry_date") ?? "");
  const expiryDate = expiryRaw ? new Date(expiryRaw) : null;
  const marketingEmail = String(formData.get("marketing_email") ?? "").trim();
  const managementEmail = String(formData.get("management_email") ?? "").trim();
  const escalationDays = Number(
    formData.get("escalation_days") ?? DEFAULT_ESCALATION_DAYS,
  );
  const reminderDaysBefore = Number(
    formData.get("reminder_days_before") ?? DEFAULT_REMINDER_DAYS_BEFORE,
  );

  // ---- Validation ----
  if (!filePath) return { error: "Please attach a certificate file." };
  if (!vendorCode) return fail("Vendor / customer code is required.");
  if (!vendorName) return fail("Vendor / customer name is required.");
  if (!certType) return fail("Certificate type is required.");
  if (!expiryRaw || !expiryDate || Number.isNaN(expiryDate.getTime()))
    return fail("Expiry date is required.");
  if (!EMAIL_RE.test(marketingEmail))
    return fail("Enter a valid marketing contact email.");
  if (!EMAIL_RE.test(managementEmail))
    return fail("Enter a valid senior management email.");
  if (!Number.isFinite(escalationDays) || escalationDays < 0)
    return fail("Escalation days must be a positive number.");
  if (!Number.isFinite(reminderDaysBefore) || reminderDaysBefore < 0)
    return fail("Advance reminder days must be 0 or more.");

  const upload = await claimUpload(supabase, user.id, filePath);
  if (!upload.ok) return fail(upload.error);

  // ---- Resolve (or create) the vendor folder ----
  // `ilike` narrows the search, but a code containing % or _ would match as a
  // wildcard, so the exact (case-insensitive) match is confirmed in JS — the
  // same comparison the folders_code_unique index uses.
  const { data: candidates, error: folderLookupError } = await supabase
    .from("folders")
    .select("id, code, name")
    .ilike("code", vendorCode);

  if (folderLookupError)
    return fail(`Could not look up the vendor: ${folderLookupError.message}`);

  let folder =
    candidates?.find(
      (f) => f.code.toLowerCase() === vendorCode.toLowerCase(),
    ) ?? null;
  let folderNote = "";

  if (!folder) {
    const { data: created, error: folderError } = await supabase
      .from("folders")
      .insert({ code: vendorCode, name: vendorName, created_by: user.id })
      .select("id, code, name")
      .single();

    if (folderError || !created)
      return fail(
        `Could not create the vendor folder: ${folderError?.message ?? "unknown error"}`,
      );
    folder = created;
    folderNote = ` New vendor folder ${created.code} created.`;
  } else if (folder.name.toLowerCase() !== vendorName.toLowerCase()) {
    folderNote = ` Filed under the existing vendor ${folder.code} — ${folder.name}; ask an admin to rename it if that's wrong.`;
  }

  // ---- Insert the certificate, then its first version ----
  const pic = displayName(user);

  const { data: doc, error: insertError } = await supabase
    .from("documents")
    .insert({
      user_id: user.id,
      folder_id: folder.id,
      cert_type: certType,
      pic_name: pic,
      file_path: filePath,
      file_type: upload.type,
      file_size: upload.size,
      expiry_date: expiryDate.toISOString(),
      marketing_email: marketingEmail,
      management_email: managementEmail,
      reminder_days_before: Math.round(reminderDaysBefore),
      escalation_days: Math.round(escalationDays),
    })
    .select("id")
    .single();

  if (insertError || !doc)
    return fail(
      `Could not save the certificate: ${insertError?.message ?? "unknown error"}`,
    );

  const { error: versionError } = await supabase.from("document_versions").insert({
    document_id: doc.id,
    version: 1,
    file_path: filePath,
    file_type: upload.type,
    file_size: upload.size,
    expiry_date: expiryDate.toISOString(),
    is_current: true,
    uploaded_by: user.id,
    uploaded_by_name: pic,
  });

  if (versionError) {
    await supabase.from("documents").delete().eq("id", doc.id);
    return fail(`Could not save the certificate: ${versionError.message}`);
  }

  revalidatePath("/dashboard");
  return { success: `"${certType}" added for ${folder.code}.${folderNote}` };
}

// ---------------------------------------------------------------------------
// New version
// ---------------------------------------------------------------------------

/**
 * Record a new version of an existing certificate against an already-uploaded
 * file.
 *
 * The new version becomes the current one and its expiry is mirrored onto the
 * `documents` row, so the reminder job tracks it and nothing else: a retained
 * older version keeps its own recorded expiry for reference only. All three
 * reminder levels reset, so the advance reminder fires again against the new
 * date rather than being suppressed by the previous cycle.
 *
 * The reminder schedule can be retuned as part of the renewal — a certificate
 * that now needs more lead time gets it here. Both fields are optional on the
 * wire: omitted, the certificate keeps the schedule it already had.
 *
 * `old_versions` = "retain" keeps the previous files as history; "delete"
 * removes them (rows and stored files) once the new version is safely in place.
 */
export async function uploadNewVersion(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user, write } = await getSession();
  if (!user) return { error: "You must be signed in." };
  if (!write) return { error: "Your account is view-only, so it can't change certificates." };

  const filePath = String(formData.get("file_path") ?? "");
  const fail = async (error: string): Promise<ActionState> => {
    await discard(supabase, filePath);
    return { error };
  };

  const id = String(formData.get("id") ?? "");
  const expiryRaw = String(formData.get("expiry_date") ?? "");
  const expiryDate = expiryRaw ? new Date(expiryRaw) : null;
  const deleteOld = String(formData.get("old_versions") ?? "retain") === "delete";

  // `null` here means "leave it alone", which is what an omitted field gets.
  const reminderRaw = String(formData.get("reminder_days_before") ?? "").trim();
  const escalationRaw = String(formData.get("escalation_days") ?? "").trim();
  const reminderDaysBefore = reminderRaw === "" ? null : Number(reminderRaw);
  const escalationDays = escalationRaw === "" ? null : Number(escalationRaw);

  if (!filePath) return { error: "Please attach the new certificate file." };
  if (!id) return fail("Choose which certificate you're updating.");
  if (!expiryRaw || !expiryDate || Number.isNaN(expiryDate.getTime()))
    return fail("The new version's expiry date is required.");
  if (
    reminderDaysBefore !== null &&
    (!Number.isFinite(reminderDaysBefore) || reminderDaysBefore < 0)
  )
    return fail("Advance reminder days must be 0 or more.");
  if (
    escalationDays !== null &&
    (!Number.isFinite(escalationDays) || escalationDays < 0)
  )
    return fail("Escalation days must be a positive number.");

  const upload = await claimUpload(supabase, user.id, filePath);
  if (!upload.ok) return fail(upload.error);

  // RLS scopes this to the caller's own certificate (or any, for an admin).
  const { data: existing, error: fetchError } = await supabase
    .from("documents")
    .select(
      "id, cert_type, reminder_days_before, escalation_days, versions:document_versions(*)",
    )
    .eq("id", id)
    .single();

  if (fetchError || !existing) return fail("Could not find that certificate.");

  const priorVersions = (existing.versions ?? []) as DocumentVersion[];
  const nextVersion =
    priorVersions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
  const previousCurrent = priorVersions.find((v) => v.is_current);

  // Stand down the old current version first — only one row per certificate is
  // allowed to be current (enforced by a partial unique index).
  const { error: demoteError } = await supabase
    .from("document_versions")
    .update({ is_current: false })
    .eq("document_id", id)
    .eq("is_current", true);

  if (demoteError)
    return fail(`Could not update version history: ${demoteError.message}`);

  /** Put the history back as it was, so the tracked expiry never dangles. */
  const restorePrevious = async () => {
    if (previousCurrent) {
      await supabase
        .from("document_versions")
        .update({ is_current: true })
        .eq("id", previousCurrent.id);
    }
  };

  const { error: versionError } = await supabase.from("document_versions").insert({
    document_id: id,
    version: nextVersion,
    file_path: filePath,
    file_type: upload.type,
    file_size: upload.size,
    expiry_date: expiryDate.toISOString(),
    is_current: true,
    uploaded_by: user.id,
    uploaded_by_name: displayName(user),
  });

  if (versionError) {
    await restorePrevious();
    return fail(`Could not save the new version: ${versionError.message}`);
  }

  // Mirror the new version onto the certificate: this expiry is the tracked one.
  const { error: updateError } = await supabase
    .from("documents")
    .update({
      file_path: filePath,
      file_type: upload.type,
      file_size: upload.size,
      expiry_date: expiryDate.toISOString(),
      reminder_days_before: Math.round(
        reminderDaysBefore ?? existing.reminder_days_before,
      ),
      escalation_days: Math.round(escalationDays ?? existing.escalation_days),
      status: "active",
      reminded_at: null,
      notified_at: null,
      escalated_at: null,
    })
    .eq("id", id);

  if (updateError) {
    await supabase
      .from("document_versions")
      .delete()
      .eq("document_id", id)
      .eq("version", nextVersion);
    await restorePrevious();
    return fail(`Could not save the new version: ${updateError.message}`);
  }

  let note = ` Version ${nextVersion - 1} kept in the history.`;
  if (deleteOld && priorVersions.length > 0) {
    const stalePaths = priorVersions.map((v) => v.file_path).filter(Boolean);
    if (stalePaths.length > 0) {
      await supabase.storage.from(DOCUMENTS_BUCKET).remove(stalePaths);
    }
    await supabase
      .from("document_versions")
      .delete()
      .eq("document_id", id)
      .neq("is_current", true);
    note = ` ${priorVersions.length} older version${priorVersions.length === 1 ? "" : "s"} deleted.`;
  } else if (priorVersions.length === 0) {
    note = "";
  }

  revalidatePath("/dashboard");
  return {
    success: `Version ${nextVersion} of "${existing.cert_type}" is now the tracked certificate.${note}`,
  };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/** Delete a single retained (non-current) version and its stored file. */
export async function deleteVersion(formData: FormData): Promise<void> {
  const versionId = String(formData.get("version_id") ?? "");
  if (!versionId) return;

  const { supabase, user, write } = await getSession();
  if (!user || !write) return;

  // RLS limits this to versions of certificates the caller can see. The
  // is_current guard keeps the tracked file from being pulled out from under
  // the reminder job.
  const { data: version } = await supabase
    .from("document_versions")
    .select("id, file_path, is_current")
    .eq("id", versionId)
    .single();

  if (!version || version.is_current) return;

  if (version.file_path) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([version.file_path]);
  }
  await supabase.from("document_versions").delete().eq("id", versionId);

  revalidatePath("/dashboard");
}

/** Delete a certificate outright, including every version's stored file. */
export async function deleteDocument(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { supabase, user, write } = await getSession();
  if (!user || !write) return;

  // Read the paths back from the database rather than trusting the form, and
  // let RLS decide whether this caller may see the row at all.
  const { data: doc } = await supabase
    .from("documents")
    .select("id, file_path, versions:document_versions(file_path)")
    .eq("id", id)
    .single();

  if (!doc) return;

  const paths = new Set<string>();
  if (doc.file_path) paths.add(doc.file_path);
  for (const v of (doc.versions ?? []) as { file_path: string }[]) {
    if (v.file_path) paths.add(v.file_path);
  }

  if (paths.size > 0) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([...paths]);
  }
  // Versions cascade with the parent row.
  await supabase.from("documents").delete().eq("id", id);

  revalidatePath("/dashboard");
}

/** Create a short-lived signed URL so the owner (or an admin) can view a file. */
export async function getSignedUrl(path: string): Promise<string | null> {
  const { supabase, user } = await getSession();
  if (!user) return null;

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, 60);
  if (error) return null;
  return data.signedUrl;
}
