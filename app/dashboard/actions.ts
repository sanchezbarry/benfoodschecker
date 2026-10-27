"use server";

import { revalidatePath } from "next/cache";
import type { User } from "@supabase/supabase-js";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { displayName, roleOf } from "@/lib/auth";
import type { DocumentVersion } from "@/lib/types";
import { formatDate, splitEmails } from "@/lib/utils";
import {
  ACCEPTED_MIME_TYPES,
  DEFAULT_ESCALATION_DAYS,
  DEFAULT_REMINDER_DAYS_BEFORE,
  DEFAULT_SECOND_REMINDER_DAYS_BEFORE,
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
// Vendor folders
// ---------------------------------------------------------------------------

type Vendor = { id: string; code: string; name: string };

/**
 * Find the folder a vendor code names, creating it with `name` when the code is
 * new. Shared by filing a certificate and by correcting one, so both read a
 * typed code the same way: the code decides which folder the certificate lives
 * in, and nothing else.
 *
 * `ilike` narrows the search, but a code containing % or _ would match as a
 * wildcard, so the exact (case-insensitive) match is confirmed in JS — the same
 * comparison the folders_code_unique index uses.
 *
 * Whether the caller's `name` may overwrite an existing folder's is left to the
 * caller: filing keeps the stored name, correcting tries to rename.
 */
async function resolveVendorFolder(
  supabase: SessionClient,
  userId: string,
  code: string,
  name: string,
): Promise<
  { ok: true; folder: Vendor; created: boolean } | { ok: false; error: string }
> {
  const { data: candidates, error: lookupError } = await supabase
    .from("folders")
    .select("id, code, name")
    .ilike("code", code);

  if (lookupError)
    return { ok: false, error: `Could not look up the vendor: ${lookupError.message}` };

  const existing = candidates?.find(
    (f) => f.code.toLowerCase() === code.toLowerCase(),
  );
  if (existing) return { ok: true, folder: existing, created: false };

  const { data: created, error: createError } = await supabase
    .from("folders")
    .insert({ code, name, created_by: userId })
    .select("id, code, name")
    .single();

  if (createError || !created)
    return {
      ok: false,
      error: `Could not create the vendor folder: ${createError?.message ?? "unknown error"}`,
    };

  return { ok: true, folder: created, created: true };
}

// ---------------------------------------------------------------------------
// Reminder schedule and contacts
// ---------------------------------------------------------------------------

/**
 * Validate the pair of advance-reminder lead times, returning the problem to
 * show the user or `null` when they are fine.
 *
 * The second reminder is the nearer one, so it has to be the smaller number:
 * equal values would send two identical emails on the same morning, and an
 * inverted pair would label the early warning as the last one. Either may be 0,
 * which switches that reminder off, and 0 is exempt from the ordering rule —
 * "no first reminder, then one 30 days out" is a real thing to want.
 */
function checkReminderDays(first: number, second: number): string | null {
  if (!Number.isFinite(first) || first < 0)
    return "First reminder days must be 0 or more.";
  if (!Number.isFinite(second) || second < 0)
    return "Second reminder days must be 0 or more.";
  if (first > 0 && second > 0 && second >= first)
    return "The second reminder must be closer to expiry than the first — give it fewer days.";
  return null;
}

/**
 * Validate who a certificate's emails go to, returning the problem to show the
 * user or `null` when they are fine. Shared by filing and editing, so a contact
 * that is refused on one is refused on the other with the same words.
 */
function checkContacts(
  marketingEmail: string,
  managementEmails: string[],
): string | null {
  if (!EMAIL_RE.test(marketingEmail))
    return "Enter a valid marketing contact email.";
  if (managementEmails.length === 0)
    return "Enter at least one senior management email.";
  const bad = managementEmails.find((e) => !EMAIL_RE.test(e));
  if (bad)
    return `"${bad}" isn't a valid senior management email. Separate several with commas.`;
  return null;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * File a new certificate against a file the browser has already uploaded.
 *
 * Vendor code and name are free text with dropdown hints. An unrecognised code
 * creates the vendor folder on the fly; a code that already exists files the
 * certificate into that folder and keeps the folder's stored name. Filing never
 * renames a vendor: a name typed absent-mindedly next to a familiar code must
 * not rewrite that vendor on everyone else's certificates. Renaming is a
 * deliberate act, so it lives in `updateDocument`.
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
  const managementEmails = splitEmails(
    String(formData.get("management_email") ?? ""),
  );
  const escalationDays = Number(
    formData.get("escalation_days") ?? DEFAULT_ESCALATION_DAYS,
  );
  const reminderDaysBefore = Number(
    formData.get("reminder_days_before") ?? DEFAULT_REMINDER_DAYS_BEFORE,
  );
  const secondReminderDaysBefore = Number(
    formData.get("second_reminder_days_before") ??
      DEFAULT_SECOND_REMINDER_DAYS_BEFORE,
  );

  // ---- Validation ----
  if (!filePath) return { error: "Please attach a certificate file." };
  if (!vendorCode) return fail("Vendor / customer code is required.");
  if (!vendorName) return fail("Vendor / customer name is required.");
  if (!certType) return fail("Certificate type is required.");
  if (!expiryRaw || !expiryDate || Number.isNaN(expiryDate.getTime()))
    return fail("Expiry date is required.");
  const contactProblem = checkContacts(marketingEmail, managementEmails);
  if (contactProblem) return fail(contactProblem);
  if (!Number.isFinite(escalationDays) || escalationDays < 0)
    return fail("Escalation days must be a positive number.");
  const reminderProblem = checkReminderDays(
    reminderDaysBefore,
    secondReminderDaysBefore,
  );
  if (reminderProblem) return fail(reminderProblem);

  const upload = await claimUpload(supabase, user.id, filePath);
  if (!upload.ok) return fail(upload.error);

  // ---- Resolve (or create) the vendor folder ----
  const resolved = await resolveVendorFolder(
    supabase,
    user.id,
    vendorCode,
    vendorName,
  );
  if (!resolved.ok) return fail(resolved.error);

  const { folder } = resolved;
  const folderNote = resolved.created
    ? ` New vendor folder ${folder.code} created.`
    : folder.name.toLowerCase() !== vendorName.toLowerCase()
      ? ` Filed under the existing vendor ${folder.code} — ${folder.name}; you can correct the name from the certificate's Edit panel.`
      : "";

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
      management_email: managementEmails.join(", "),
      reminder_days_before: Math.round(reminderDaysBefore),
      second_reminder_days_before: Math.round(secondReminderDaysBefore),
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
 * `documents` row, so the reminder job tracks it and nothing else. All four
 * reminder levels reset, so the advance reminders fire again against the new
 * date rather than being suppressed by the previous cycle.
 *
 * The reminder schedule can be retuned as part of the renewal — a certificate
 * that now needs more lead time gets it here. The fields are optional on the
 * wire: omitted, the certificate keeps the schedule it already had.
 *
 * The version being replaced is deleted, rows and stored files both, once the
 * new one is safely in place. Keeping the old file was a per-upload choice
 * ("retain" vs "delete"); it is now the one behaviour, because a renewed
 * certificate supersedes its predecessor outright and the retained copies were
 * only accumulating storage. Reinstating the choice means restoring the
 * `old_versions` branch marked RETAIN below and the fieldset in
 * `new-version-form.tsx`; nothing in the schema was removed, and versions
 * uploaded before this change are still on file.
 *
 * The file always ends up in the **owner's** storage folder. The browser
 * uploads into the uploader's own folder, which is the same thing unless an
 * admin is renewing somebody else's certificate — and then the file is moved
 * across, because storage only lets the owner open files in their own folder.
 */
export async function uploadNewVersion(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user, write, admin } = await getSession();
  if (!user) return { error: "You must be signed in." };
  if (!write) return { error: "Your account is view-only, so it can't change certificates." };

  const filePath = String(formData.get("file_path") ?? "");
  // Where the file is now: it moves to the owner's folder below if need be, and
  // a failure has to clean up wherever it ended up.
  let storedPath = filePath;
  const fail = async (error: string): Promise<ActionState> => {
    await discard(supabase, storedPath);
    return { error };
  };

  const id = String(formData.get("id") ?? "");
  const expiryRaw = String(formData.get("expiry_date") ?? "");
  const expiryDate = expiryRaw ? new Date(expiryRaw) : null;
  // RETAIN (removed): the form used to offer "retain" or "delete" here.
  //   const deleteOld = String(formData.get("old_versions") ?? "retain") === "delete";
  // Every prior version is now deleted unconditionally, below.

  // `null` here means "leave it alone", which is what an omitted field gets.
  const reminderRaw = String(formData.get("reminder_days_before") ?? "").trim();
  const secondReminderRaw = String(
    formData.get("second_reminder_days_before") ?? "",
  ).trim();
  const escalationRaw = String(formData.get("escalation_days") ?? "").trim();
  const reminderDaysBefore = reminderRaw === "" ? null : Number(reminderRaw);
  const secondReminderDaysBefore =
    secondReminderRaw === "" ? null : Number(secondReminderRaw);
  const escalationDays = escalationRaw === "" ? null : Number(escalationRaw);

  if (!filePath) return { error: "Please attach the new certificate file." };
  if (!id) return fail("Choose which certificate you're updating.");
  if (!expiryRaw || !expiryDate || Number.isNaN(expiryDate.getTime()))
    return fail("The new version's expiry date is required.");
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
      "id, user_id, cert_type, reminder_days_before, second_reminder_days_before, escalation_days, versions:document_versions(*)",
    )
    .eq("id", id)
    .single();

  if (fetchError || !existing) return fail("Could not find that certificate.");

  // An omitted field keeps what the certificate already uses, so the pair is
  // only checkable once the stored values are known.
  const nextReminderDays = Math.round(
    reminderDaysBefore ?? existing.reminder_days_before,
  );
  const nextSecondReminderDays = Math.round(
    secondReminderDaysBefore ?? existing.second_reminder_days_before,
  );
  const reminderProblem = checkReminderDays(
    nextReminderDays,
    nextSecondReminderDays,
  );
  if (reminderProblem) return fail(reminderProblem);

  // Renewing somebody else's certificate — only an admin can reach one — files
  // the upload under its owner, not the uploader. Service role: moving into
  // another person's folder is beyond any session.
  if (existing.user_id !== user.id) {
    if (!admin) return fail("Only an admin can renew somebody else's certificate.");
    const ownerPath = `${existing.user_id}/${filePath.split("/").pop()}`;
    const { error: moveError } = await createAdminClient()
      .storage.from(DOCUMENTS_BUCKET)
      .move(filePath, ownerPath);
    if (moveError) return fail(`Could not file the upload under its owner: ${moveError.message}`);
    storedPath = ownerPath;
  }

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
    file_path: storedPath,
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
      file_path: storedPath,
      file_type: upload.type,
      file_size: upload.size,
      expiry_date: expiryDate.toISOString(),
      reminder_days_before: nextReminderDays,
      second_reminder_days_before: nextSecondReminderDays,
      escalation_days: Math.round(escalationDays ?? existing.escalation_days),
      status: "active",
      reminded_at: null,
      second_reminded_at: null,
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

  // The superseded versions go, files and rows both. Deliberately last: the new
  // version is current and mirrored onto the certificate by this point, so a
  // failure here leaves stale files behind rather than a certificate pointing
  // at a file that no longer exists.
  //
  // RETAIN (removed): this used to be conditional on `deleteOld`, with the
  //   other branch leaving the old rows alone and reporting
  //   `Version ${nextVersion - 1} kept in the history.` Restoring the choice
  //   means putting that condition back around the block below.
  let note = "";
  if (priorVersions.length > 0) {
    const stalePaths = priorVersions.map((v) => v.file_path).filter(Boolean);
    if (stalePaths.length > 0) {
      await supabase.storage.from(DOCUMENTS_BUCKET).remove(stalePaths);
    }
    await supabase
      .from("document_versions")
      .delete()
      .eq("document_id", id)
      .neq("is_current", true);
    note = ` ${priorVersions.length} earlier version${priorVersions.length === 1 ? "" : "s"} deleted.`;
  }

  revalidatePath("/dashboard");
  return {
    success: `Version ${nextVersion} of "${existing.cert_type}" is now the tracked certificate.${note}`,
  };
}

// ---------------------------------------------------------------------------
// PIC — the account that owns a certificate
// ---------------------------------------------------------------------------

type ServiceClient = ReturnType<typeof createAdminClient>;

/** The account behind an email. Service role: a session can't list users. */
async function findAccount(
  service: ServiceClient,
  email: string,
): Promise<{ ok: true; account: User | null } | { ok: false; error: string }> {
  const wanted = email.toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data) return { ok: false, error: error?.message ?? "unknown error" };
    const match = data.users.find((u) => u.email?.toLowerCase() === wanted);
    if (match) return { ok: true, account: match };
    if (data.users.length < 1000) return { ok: true, account: null };
  }
}

/**
 * Hand a certificate to another account. It becomes the owner and shows as
 * PIC, and every file the certificate has moves into that account's storage
 * folder: the storage policies only let people open and replace files in their
 * own folder, so a file left behind would lock the new PIC out of their own
 * certificate. Runs with the service role — moving into somebody else's folder
 * is beyond any session — so the caller must already have checked for an admin.
 *
 * Each step is undone if a later one fails, leaving the certificate exactly as
 * it was.
 */
async function transferCertificate(
  service: ServiceClient,
  documentId: string,
  owner: User,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: doc, error: fetchError } = await service
    .from("documents")
    .select("id, user_id, pic_name, file_path, versions:document_versions(id, file_path)")
    .eq("id", documentId)
    .single();
  if (fetchError || !doc) return { ok: false, error: "could not find that certificate" };

  const versions = (doc.versions ?? []) as { id: string; file_path: string }[];
  const destination = (path: string) => `${owner.id}/${path.split("/").pop()}`;
  const toMove = [
    ...new Set([doc.file_path, ...versions.map((v) => v.file_path)].filter(Boolean)),
  ].filter((path) => !path.startsWith(`${owner.id}/`));

  const bucket = service.storage.from(DOCUMENTS_BUCKET);
  const moved: string[] = [];
  const moveBack = async () => {
    for (const path of moved) await bucket.move(destination(path), path);
  };
  for (const path of toMove) {
    const { error } = await bucket.move(path, destination(path));
    if (error) {
      await moveBack();
      return { ok: false, error: `could not move its file (${error.message})` };
    }
    moved.push(path);
  }
  const newPath = (path: string) => (moved.includes(path) ? destination(path) : path);

  const { error: docError } = await service
    .from("documents")
    .update({ user_id: owner.id, pic_name: displayName(owner), file_path: newPath(doc.file_path) })
    .eq("id", doc.id);
  if (docError) {
    await moveBack();
    return { ok: false, error: docError.message };
  }

  for (const version of versions.filter((v) => moved.includes(v.file_path))) {
    const { error } = await service
      .from("document_versions")
      .update({ file_path: destination(version.file_path) })
      .eq("id", version.id);
    if (error) {
      for (const v of versions)
        await service.from("document_versions").update({ file_path: v.file_path }).eq("id", v.id);
      await service
        .from("documents")
        .update({ user_id: doc.user_id, pic_name: doc.pic_name, file_path: doc.file_path })
        .eq("id", doc.id);
      await moveBack();
      return { ok: false, error: error.message };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

/**
 * Correct the details of a certificate that is already on file: which vendor it
 * belongs to, what it is, when it expires and who its emails go to. For fixing
 * a mistake made at upload time, without deleting the certificate and losing
 * its version history.
 *
 * The vendor **code** decides which folder the certificate sits in — exactly as
 * it does when filing one. An existing code (case-insensitively) re-files it
 * there; a code nobody has used creates the folder. So "I filed this under the
 * wrong vendor" is fixed by correcting the code.
 *
 * The vendor **name** belongs to the folder, which is shared, so a changed name
 * is a rename attempt rather than a certain thing: the database allows it for an
 * admin, or when the folder holds nothing but the caller's own certificates. If
 * it holds someone else's too, the stored name stands and the reply says so.
 *
 * The **expiry** is written to the certificate and to its current version, which
 * `documents.expiry_date` mirrors — they must not drift apart, or the history
 * would contradict the date the reminder job watches. A changed date re-arms all
 * four reminder levels, so a certificate chased against the wrong day is
 * reconsidered against the right one; an unchanged date leaves reminder state
 * alone, so fixing a vendor typo never re-sends an email.
 *
 * The **reminder schedule** — both advance lead times and the escalation window
 * — is editable here too, because a certificate that turns out to need a longer
 * run-up should not have to wait for its next renewal to get one. Changing a
 * lead time does not un-send anything: a reminder already sent stays sent, so
 * widening the window on a certificate that was reminded last week doesn't mail
 * the contact a second time. One not yet sent simply fires against the new
 * window on the next run.
 *
 * The **certificate type** and the two **contacts** — marketing, and senior
 * management — are plain fields on the certificate, editable for the same
 * reason. A changed contact receives whatever email is due next; nothing
 * already sent goes out again, exactly as with a retuned lead time.
 *
 * The **PIC** is the account that owns the certificate, and only an admin may
 * change it — the database refuses anyone else. The field is only on an
 * admin's form; when it is absent the PIC is left alone. A new PIC must already
 * have an account, and not a view-only one; the certificate's files move into
 * their storage folder with it (see `transferCertificate`).
 *
 * The file itself is untouched — replacing it is what `uploadNewVersion` is
 * for. An admin editing on someone's behalf does not become the owner.
 */
export async function updateDocument(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user, write, admin } = await getSession();
  if (!user) return { error: "You must be signed in." };
  if (!write) return { error: "Your account is view-only, so it can't change certificates." };

  const id = String(formData.get("id") ?? "");
  const vendorCode = String(formData.get("vendor_code") ?? "").trim();
  const vendorName = String(formData.get("vendor_name") ?? "").trim();
  const certType = String(formData.get("cert_type") ?? "").trim();
  const expiryRaw = String(formData.get("expiry_date") ?? "");
  const expiryDate = expiryRaw ? new Date(expiryRaw) : null;
  const marketingEmail = String(formData.get("marketing_email") ?? "").trim();
  const managementEmails = splitEmails(
    String(formData.get("management_email") ?? ""),
  );
  // Only an admin's form carries it; absent means "leave the PIC alone".
  const picField = formData.get("pic_email");
  const picEmail = picField === null ? null : String(picField).trim();
  // `null` means "leave it alone", which is what an omitted field gets — never
  // 0, which would silently switch a reminder off.
  const optionalDays = (field: string) => {
    const raw = String(formData.get(field) ?? "").trim();
    return raw === "" ? null : Number(raw);
  };
  const reminderRaw = optionalDays("reminder_days_before");
  const secondReminderRaw = optionalDays("second_reminder_days_before");
  const escalationRaw = optionalDays("escalation_days");

  if (!id) return { error: "Choose which certificate you're editing." };
  if (!vendorCode) return { error: "Vendor / customer code is required." };
  if (!vendorName) return { error: "Vendor / customer name is required." };
  if (!certType) return { error: "Certificate type is required." };
  if (!expiryRaw || !expiryDate || Number.isNaN(expiryDate.getTime()))
    return { error: "Expiry date is required." };
  const contactProblem = checkContacts(marketingEmail, managementEmails);
  if (contactProblem) return { error: contactProblem };
  if (picEmail !== null && !EMAIL_RE.test(picEmail))
    return { error: "Enter the PIC's account email." };

  // RLS scopes this to the caller's own certificate (or any, for an admin), so
  // the id off the form can only ever name a row they are allowed to change.
  // Every prior value is read here so the change can be undone below.
  const { data: existing, error: fetchError } = await supabase
    .from("documents")
    .select(
      "id, user_id, cert_type, folder_id, expiry_date, marketing_email, management_email, status, reminded_at, second_reminded_at, notified_at, escalated_at, reminder_days_before, second_reminder_days_before, escalation_days",
    )
    .eq("id", id)
    .single();

  if (fetchError || !existing) return { error: "Could not find that certificate." };

  // An omitted field keeps what the certificate already uses. Checked before
  // the vendor is resolved, because resolving can create a folder — and a
  // rejected edit should not leave one behind.
  const reminderDays = Math.round(
    reminderRaw ?? existing.reminder_days_before,
  );
  const secondReminderDays = Math.round(
    secondReminderRaw ?? existing.second_reminder_days_before,
  );
  const escalationDays = Math.round(
    escalationRaw ?? existing.escalation_days,
  );

  const reminderProblem = checkReminderDays(reminderDays, secondReminderDays);
  if (reminderProblem) return { error: reminderProblem };
  if (!Number.isFinite(escalationDays) || escalationDays < 0)
    return { error: "Escalation days must be a positive number." };

  // ---- PIC: looked up before anything is written, so a mistyped email
  // rejects the whole edit instead of saving half of it ----
  let newOwner: User | null = null;
  let service: ServiceClient | null = null;
  if (picEmail !== null) {
    service = createAdminClient();
    const lookup = await findAccount(service, picEmail);
    if (!lookup.ok) return { error: `Could not look up ${picEmail}: ${lookup.error}` };
    if (!lookup.account)
      return { error: `No account uses ${picEmail}. Create it in Admin first, then choose it here.` };
    if (lookup.account.id !== existing.user_id) {
      if (!admin) return { error: "Only an admin can change a certificate's PIC." };
      if (roleOf(lookup.account) === "department")
        return { error: `${picEmail} is a view-only account, so it can't be a certificate's PIC.` };
      newOwner = lookup.account;
    }
  }

  const resolved = await resolveVendorFolder(
    supabase,
    user.id,
    vendorCode,
    vendorName,
  );
  if (!resolved.ok) return { error: resolved.error };

  const { folder } = resolved;
  const changes: string[] = [];
  let note = "";

  // ---- Vendor ----
  if (resolved.created) {
    changes.push(`filed under the new vendor ${folder.code} — ${folder.name}`);
  } else {
    if (folder.id !== existing.folder_id)
      changes.push(`refiled under ${folder.code} — ${folder.name}`);

    // Compared exactly, not case-insensitively: "fresh life pte ltd" →
    // "Fresh Life Pte Ltd" is a correction someone deliberately typed.
    if (folder.name !== vendorName) {
      const { data: renamed } = await supabase
        .from("folders")
        .update({ name: vendorName })
        .eq("id", folder.id)
        .select("id");

      // No error and no row means the policy declined it — the folder holds
      // certificates belonging to other people, so this is not the caller's
      // name to change.
      if (renamed && renamed.length > 0) {
        changes.push(`vendor ${folder.code} renamed to ${vendorName}`);
      } else {
        note = ` The name stayed ${folder.name}: ${folder.code} also holds other people's certificates, so only an admin can rename it.`;
      }
    }
  }

  // ---- Type ----
  // Compared exactly, like the vendor name: "brc" → "BRC" is a deliberate fix.
  if (certType !== existing.cert_type)
    changes.push(`type changed to ${certType}`);

  // ---- Expiry ----
  const expiryIso = expiryDate.toISOString();
  const expiryChanged =
    new Date(existing.expiry_date).getTime() !== expiryDate.getTime();
  if (expiryChanged) changes.push(`expiry corrected to ${formatDate(expiryIso)}`);

  // ---- Contacts ----
  // The stored list is normalised before comparing, so the same addresses
  // written with different spacing don't count as a change.
  const managementEmail = managementEmails.join(", ");
  if (marketingEmail !== existing.marketing_email)
    changes.push(`marketing contact now ${marketingEmail}`);
  if (managementEmail !== splitEmails(existing.management_email).join(", "))
    changes.push(`senior management now ${managementEmail}`);

  // ---- Reminder schedule ----
  // Reported as one change however many of the three moved: "reminders now
  // 90d + 45d, escalating 14d after" is what the user just set, and three
  // separate clauses for it would bury the vendor and expiry changes.
  const scheduleChanged =
    reminderDays !== existing.reminder_days_before ||
    secondReminderDays !== existing.second_reminder_days_before ||
    escalationDays !== existing.escalation_days;

  if (scheduleChanged) {
    const advance =
      [reminderDays, secondReminderDays].filter((d) => d > 0).join("d + ") ||
      "off";
    changes.push(
      `reminders now ${advance === "off" ? "off" : `${advance}d before expiry`}, escalating ${escalationDays}d after`,
    );
  }

  const { error: updateError } = await supabase
    .from("documents")
    .update({
      folder_id: folder.id,
      cert_type: certType,
      expiry_date: expiryIso,
      marketing_email: marketingEmail,
      management_email: managementEmail,
      reminder_days_before: reminderDays,
      second_reminder_days_before: secondReminderDays,
      escalation_days: escalationDays,
      ...(expiryChanged
        ? {
            status: "active",
            reminded_at: null,
            second_reminded_at: null,
            notified_at: null,
            escalated_at: null,
          }
        : {}),
    })
    .eq("id", id);

  if (updateError)
    return { error: `Could not save the change: ${updateError.message}` };

  if (expiryChanged) {
    const { error: versionError } = await supabase
      .from("document_versions")
      .update({ expiry_date: expiryIso })
      .eq("document_id", id)
      .eq("is_current", true);

    // Put the certificate back rather than leave the tracked date and the
    // version it is supposed to mirror out of step.
    if (versionError) {
      await supabase
        .from("documents")
        .update({
          folder_id: existing.folder_id,
          cert_type: existing.cert_type,
          expiry_date: existing.expiry_date,
          marketing_email: existing.marketing_email,
          management_email: existing.management_email,
          reminder_days_before: existing.reminder_days_before,
          second_reminder_days_before: existing.second_reminder_days_before,
          escalation_days: existing.escalation_days,
          status: existing.status,
          reminded_at: existing.reminded_at,
          second_reminded_at: existing.second_reminded_at,
          notified_at: existing.notified_at,
          escalated_at: existing.escalated_at,
        })
        .eq("id", id);
      return { error: `Could not save the change: ${versionError.message}` };
    }
  }

  // ---- PIC, last: everything above is saved either way, and the transfer
  // puts itself back if it fails part-way ----
  if (newOwner && service) {
    const transfer = await transferCertificate(service, id, newOwner);
    if (!transfer.ok) {
      revalidatePath("/dashboard");
      return {
        error:
          `The PIC couldn't be changed: ${transfer.error}.` +
          (changes.length ? ` Everything else was saved: ${changes.join("; ")}.` : ""),
      };
    }
    changes.push(`PIC now ${displayName(newOwner)} (${newOwner.email})`);
  }

  revalidatePath("/dashboard");

  if (changes.length === 0)
    return { success: `No changes to save on "${existing.cert_type}".${note}` };

  return {
    success:
      `"${existing.cert_type}" updated — ${changes.join("; ")}.` +
      (expiryChanged ? " Reminders re-armed against the new date." : "") +
      note,
  };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete a single non-current version and its stored file.
 *
 * New versions no longer leave one behind, so this reaches only history from
 * before that change — and the RETAIN branch, if it is ever restored.
 */
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
