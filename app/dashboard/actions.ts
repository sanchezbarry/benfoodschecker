"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  ACCEPTED_MIME_TYPES,
  DEFAULT_ESCALATION_DAYS,
  DOCUMENTS_BUCKET,
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_LABEL,
} from "@/lib/constants";

export type ActionState = { error?: string; success?: string } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createDocument(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const name = String(formData.get("name") ?? "").trim();
  const expiryRaw = String(formData.get("expiry_date") ?? "");
  const expiryDate = expiryRaw ? new Date(expiryRaw) : null;
  const marketingEmail = String(formData.get("marketing_email") ?? "").trim();
  const managementEmail = String(formData.get("management_email") ?? "").trim();
  const escalationDays = Number(
    formData.get("escalation_days") ?? DEFAULT_ESCALATION_DAYS,
  );
  const file = formData.get("file");

  // ---- Validation ----
  if (!name) return { error: "Document name is required." };
  if (!expiryRaw || !expiryDate || Number.isNaN(expiryDate.getTime()))
    return { error: "Expiry date is required." };
  if (!EMAIL_RE.test(marketingEmail))
    return { error: "Enter a valid marketing contact email." };
  if (!EMAIL_RE.test(managementEmail))
    return { error: "Enter a valid senior management email." };
  if (!Number.isFinite(escalationDays) || escalationDays < 0)
    return { error: "Escalation days must be a positive number." };
  if (!(file instanceof File) || file.size === 0)
    return { error: "Please attach a document file." };
  if (file.size > MAX_FILE_SIZE)
    return { error: `File is too large. Max size is ${MAX_FILE_SIZE_LABEL}.` };
  if (!ACCEPTED_MIME_TYPES.includes(file.type as (typeof ACCEPTED_MIME_TYPES)[number]))
    return { error: "Only PDF, PNG, JPG, or WEBP files are allowed." };

  // ---- Upload to private Storage bucket (scoped to the user's folder) ----
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return { error: `Upload failed: ${uploadError.message}` };
  }

  // ---- Insert the tracking row ----
  const { error: insertError } = await supabase.from("documents").insert({
    user_id: user.id,
    name,
    file_path: path,
    file_type: file.type,
    file_size: file.size,
    expiry_date: expiryDate.toISOString(),
    marketing_email: marketingEmail,
    management_email: managementEmail,
    escalation_days: Math.round(escalationDays),
  });

  if (insertError) {
    // Roll back the uploaded file so we don't leave orphans.
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    return { error: `Could not save document: ${insertError.message}` };
  }

  revalidatePath("/dashboard");
  return { success: `"${name}" added.` };
}

/**
 * Renew an already-tracked document: upload the new file, set the new
 * expiry, and reset the workflow back to `active` so the two-level
 * reminders can fire again on the new expiry. Keeps the existing name,
 * contacts, and escalation window — only the file and expiry change.
 */
export async function replaceDocument(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const id = String(formData.get("id") ?? "");
  const expiryRaw = String(formData.get("expiry_date") ?? "");
  const expiryDate = expiryRaw ? new Date(expiryRaw) : null;
  const file = formData.get("file");

  if (!id) return { error: "Choose which document you're replacing." };
  if (!expiryRaw || !expiryDate || Number.isNaN(expiryDate.getTime()))
    return { error: "New expiry date is required." };
  if (!(file instanceof File) || file.size === 0)
    return { error: "Please attach the renewed document file." };
  if (file.size > MAX_FILE_SIZE)
    return { error: `File is too large. Max size is ${MAX_FILE_SIZE_LABEL}.` };
  if (!ACCEPTED_MIME_TYPES.includes(file.type as (typeof ACCEPTED_MIME_TYPES)[number]))
    return { error: "Only PDF, PNG, JPG, or WEBP files are allowed." };

  // RLS scopes this to the signed-in user's own row.
  const { data: existing, error: fetchError } = await supabase
    .from("documents")
    .select("id, file_path")
    .eq("id", id)
    .single();

  if (fetchError || !existing)
    return { error: "Could not find that document." };

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return { error: `Upload failed: ${uploadError.message}` };
  }

  const { error: updateError } = await supabase
    .from("documents")
    .update({
      file_path: path,
      file_type: file.type,
      file_size: file.size,
      expiry_date: expiryDate.toISOString(),
      status: "active",
      notified_at: null,
      escalated_at: null,
    })
    .eq("id", id);

  if (updateError) {
    // Roll back the newly uploaded file so we don't leave orphans.
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    return { error: `Could not save the renewal: ${updateError.message}` };
  }

  // Old file is no longer referenced — remove it now that the swap succeeded.
  if (existing.file_path) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([existing.file_path]);
  }

  revalidatePath("/dashboard");
  return { success: "Document replaced with the renewed certificate." };
}

export async function deleteDocument(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const path = String(formData.get("file_path") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // RLS ensures a user can only delete their own rows/files.
  if (path) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
  }
  await supabase.from("documents").delete().eq("id", id);

  revalidatePath("/dashboard");
}

/** Create a short-lived signed URL so the owner can view/download a file. */
export async function getSignedUrl(path: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, 60);
  if (error) return null;
  return data.signedUrl;
}
