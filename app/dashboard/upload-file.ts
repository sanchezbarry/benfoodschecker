"use client";

import { createClient } from "@/lib/supabase/client";
import { createUploadTicket } from "./actions";
import { compressCertificate } from "@/lib/compress";
import {
  ACCEPTED_MIME_TYPES,
  DOCUMENTS_BUCKET,
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_LABEL,
  MAX_UPLOAD_INPUT_SIZE,
  MAX_UPLOAD_INPUT_SIZE_LABEL,
} from "@/lib/constants";

/**
 * Send a certificate straight from the browser to Supabase Storage, and return
 * the path for the Server Action to record.
 *
 * The bytes never pass through Next.js: Server Actions cap request bodies at
 * 1 MB, and Vercel caps them at 4.5 MB regardless of that setting, both under
 * the 10 MB this app allows. The action receives only the resulting path.
 *
 * Images are downscaled and re-encoded on the way through, so what gets stored
 * is usually a fraction of what the user picked.
 *
 * These checks are for fast feedback, not for safety — the Server Action
 * re-reads the object's real size and type from storage, and the bucket
 * enforces both limits itself.
 */
export async function uploadCertificateFile(
  file: unknown,
): Promise<{ path: string; note: string | null } | { error: string }> {
  if (!(file instanceof File) || file.size === 0)
    return { error: "Please attach a certificate file." };
  if (
    !ACCEPTED_MIME_TYPES.includes(file.type as (typeof ACCEPTED_MIME_TYPES)[number])
  )
    return { error: "Only PDF, PNG, JPG, or WEBP files are allowed." };
  if (file.size > MAX_UPLOAD_INPUT_SIZE)
    return {
      error: `That file is over ${MAX_UPLOAD_INPUT_SIZE_LABEL}. Please pick a smaller one.`,
    };

  // Shrink images before they go anywhere. PDFs come back untouched.
  const { file: prepared, note } = await compressCertificate(file);

  if (prepared.size > MAX_FILE_SIZE)
    return {
      error:
        prepared === file
          ? `File is too large. Max size is ${MAX_FILE_SIZE_LABEL}.`
          : `Still over ${MAX_FILE_SIZE_LABEL} after compression. Please use a smaller file.`,
    };

  const ticket = await createUploadTicket(prepared.type);
  if ("error" in ticket) return { error: ticket.error };

  const { error } = await createClient()
    .storage.from(DOCUMENTS_BUCKET)
    .uploadToSignedUrl(ticket.path, ticket.token, prepared, {
      contentType: prepared.type,
    });

  if (error) return { error: `Upload failed: ${error.message}` };

  return { path: ticket.path, note };
}
