/** Shared constants for document uploads and escalation. */

export const DOCUMENTS_BUCKET = "documents";

/** Max upload size in bytes (10 MB). Enforced client-side, in the action, and on the bucket. */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

export const MAX_FILE_SIZE_LABEL = "10 MB";

/** Accepted MIME types: PDFs and common images. */
export const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const ACCEPTED_FILE_EXTENSIONS = ".pdf,.png,.jpg,.jpeg,.webp";

/** Default days after expiry before escalating to senior management. */
export const DEFAULT_ESCALATION_DAYS = 7;
