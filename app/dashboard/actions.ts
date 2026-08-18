"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { displayName } from "@/lib/auth";
import type { DocumentVersion } from "@/lib/types";
import {
  ACCEPTED_MIME_TYPES,
  DEFAULT_ESCALATION_DAYS,
  DOCUMENTS_BUCKET,
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_LABEL,
} from "@/lib/constants";

export type ActionState = { error?: string; success?: string } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Shared file checks. Returns an error message, or null when the file is fine. */
function validateFile(file: FormDataEntryValue | null): string | null {
  if (!(file instanceof File) || file.size === 0)
    return "Please attach a certificate file.";
  if (file.size > MAX_FILE_SIZE)
    return `File is too large. Max size is ${MAX_FILE_SIZE_LABEL}.`;
  if (!ACCEPTED_MIME_TYPES.includes(file.type as (typeof ACCEPTED_MIME_TYPES)[number]))
    return "Only PDF, PNG, JPG, or WEBP files are allowed.";
  return null;
}

function storagePath(userId: string, file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  return `${userId}/${crypto.randomUUID()}.${ext}`;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * File a new certificate.
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
  const { supabase, user } = await getSession();
  if (!user) return { error: "You must be signed in." };

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
  const file = formData.get("file");

  // ---- Validation ----
  if (!vendorCode) return { error: "Vendor / customer code is required." };
  if (!vendorName) return { error: "Vendor / customer name is required." };
  if (!certType) return { error: "Certificate type is required." };
  if (!expiryRaw || !expiryDate || Number.isNaN(expiryDate.getTime()))
    return { error: "Expiry date is required." };
  if (!EMAIL_RE.test(marketingEmail))
    return { error: "Enter a valid marketing contact email." };
  if (!EMAIL_RE.test(managementEmail))
    return { error: "Enter a valid senior management email." };
  if (!Number.isFinite(escalationDays) || escalationDays < 0)
    return { error: "Escalation days must be a positive number." };

  const fileError = validateFile(file);
  if (fileError) return { error: fileError };
  const certFile = file as File;

  // ---- Resolve (or create) the vendor folder ----
  // `ilike` narrows the search, but a code containing % or _ would match as a
  // wildcard, so the exact (case-insensitive) match is confirmed in JS — the
  // same comparison the folders_code_unique index uses.
  const { data: candidates, error: folderLookupError } = await supabase
    .from("folders")
    .select("id, code, name")
    .ilike("code", vendorCode);

  if (folderLookupError)
    return { error: `Could not look up the vendor: ${folderLookupError.message}` };

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
      return {
        error: `Could not create the vendor folder: ${folderError?.message ?? "unknown error"}`,
      };
    folder = created;
    folderNote = ` New vendor folder ${created.code} created.`;
  } else if (folder.name.toLowerCase() !== vendorName.toLowerCase()) {
    folderNote = ` Filed under the existing vendor ${folder.code} — ${folder.name}; ask an admin to rename it if that's wrong.`;
  }

  // ---- Upload to the private Storage bucket (scoped to the user's folder) ----
  const path = storagePath(user.id, certFile);
  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, certFile, { contentType: certFile.type, upsert: false });

  if (uploadError) return { error: `Upload failed: ${uploadError.message}` };

  // ---- Insert the certificate, then its first version ----
  const pic = displayName(user);

  const { data: doc, error: insertError } = await supabase
    .from("documents")
    .insert({
      user_id: user.id,
      folder_id: folder.id,
      cert_type: certType,
      pic_name: pic,
      file_path: path,
      file_type: certFile.type,
      file_size: certFile.size,
      expiry_date: expiryDate.toISOString(),
      marketing_email: marketingEmail,
      management_email: managementEmail,
      escalation_days: Math.round(escalationDays),
    })
    .select("id")
    .single();

  if (insertError || !doc) {
    // Roll back the uploaded file so we don't leave orphans.
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    return {
      error: `Could not save the certificate: ${insertError?.message ?? "unknown error"}`,
    };
  }

  const { error: versionError } = await supabase.from("document_versions").insert({
    document_id: doc.id,
    version: 1,
    file_path: path,
    file_type: certFile.type,
    file_size: certFile.size,
    expiry_date: expiryDate.toISOString(),
    is_current: true,
    uploaded_by: user.id,
    uploaded_by_name: pic,
  });

  if (versionError) {
    await supabase.from("documents").delete().eq("id", doc.id);
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    return { error: `Could not save the certificate: ${versionError.message}` };
  }

  revalidatePath("/dashboard");
  return { success: `"${certType}" added for ${folder.code}.${folderNote}` };
}

// ---------------------------------------------------------------------------
// New version
// ---------------------------------------------------------------------------

/**
 * Upload a new version of an existing certificate.
 *
 * The new version becomes the current one and its expiry is mirrored onto the
 * `documents` row, so the reminder job tracks it and nothing else: a retained
 * older version keeps its own recorded expiry for reference only. Reminder
 * state resets to `active` so the two-level workflow fires again on the new date.
 *
 * `old_versions` = "retain" keeps the previous files as history; "delete"
 * removes them (rows and stored files) once the new version is safely in place.
 */
export async function uploadNewVersion(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await getSession();
  if (!user) return { error: "You must be signed in." };

  const id = String(formData.get("id") ?? "");
  const expiryRaw = String(formData.get("expiry_date") ?? "");
  const expiryDate = expiryRaw ? new Date(expiryRaw) : null;
  const deleteOld = String(formData.get("old_versions") ?? "retain") === "delete";
  const file = formData.get("file");

  if (!id) return { error: "Choose which certificate you're updating." };
  if (!expiryRaw || !expiryDate || Number.isNaN(expiryDate.getTime()))
    return { error: "The new version's expiry date is required." };

  const fileError = validateFile(file);
  if (fileError) return { error: fileError };
  const certFile = file as File;

  // RLS scopes this to the caller's own certificate (or any, for an admin).
  const { data: existing, error: fetchError } = await supabase
    .from("documents")
    .select("id, cert_type, file_path, versions:document_versions(*)")
    .eq("id", id)
    .single();

  if (fetchError || !existing) return { error: "Could not find that certificate." };

  const priorVersions = (existing.versions ?? []) as DocumentVersion[];
  const nextVersion =
    priorVersions.reduce((max, v) => Math.max(max, v.version), 0) + 1;

  const path = storagePath(user.id, certFile);
  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, certFile, { contentType: certFile.type, upsert: false });

  if (uploadError) return { error: `Upload failed: ${uploadError.message}` };

  // Stand down the old current version first — only one row per certificate is
  // allowed to be current (enforced by a partial unique index).
  const { error: demoteError } = await supabase
    .from("document_versions")
    .update({ is_current: false })
    .eq("document_id", id)
    .eq("is_current", true);

  if (demoteError) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    return { error: `Could not update version history: ${demoteError.message}` };
  }

  const { error: versionError } = await supabase.from("document_versions").insert({
    document_id: id,
    version: nextVersion,
    file_path: path,
    file_type: certFile.type,
    file_size: certFile.size,
    expiry_date: expiryDate.toISOString(),
    is_current: true,
    uploaded_by: user.id,
    uploaded_by_name: displayName(user),
  });

  if (versionError) {
    const previousCurrent = priorVersions.find((v) => v.is_current);
    if (previousCurrent) {
      await supabase
        .from("document_versions")
        .update({ is_current: true })
        .eq("id", previousCurrent.id);
    }
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    return { error: `Could not save the new version: ${versionError.message}` };
  }

  // Mirror the new version onto the certificate: this expiry is the tracked one.
  const { error: updateError } = await supabase
    .from("documents")
    .update({
      file_path: path,
      file_type: certFile.type,
      file_size: certFile.size,
      expiry_date: expiryDate.toISOString(),
      status: "active",
      notified_at: null,
      escalated_at: null,
    })
    .eq("id", id);

  if (updateError) {
    // Put the history back the way it was so the tracked expiry never points at
    // a version the certificate row doesn't know about.
    await supabase
      .from("document_versions")
      .delete()
      .eq("document_id", id)
      .eq("version", nextVersion);
    const previousCurrent = priorVersions.find((v) => v.is_current);
    if (previousCurrent) {
      await supabase
        .from("document_versions")
        .update({ is_current: true })
        .eq("id", previousCurrent.id);
    }
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    return { error: `Could not save the new version: ${updateError.message}` };
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

  const { supabase, user } = await getSession();
  if (!user) return;

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

  const { supabase, user } = await getSession();
  if (!user) return;

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
