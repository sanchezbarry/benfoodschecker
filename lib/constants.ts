/** Shared constants for document uploads and escalation. */

export const DOCUMENTS_BUCKET = "documents";

/**
 * Max size of the file that finally lands in the bucket, after any compression.
 * Enforced in the browser, in the Server Action (re-read from storage), and by
 * the bucket itself.
 *
 * 25 MB rather than 10: real certificates include multi-page scan bundles that
 * measured 11 MB and 17 MB, which a 10 MB cap rejected outright. Uploads go
 * straight from the browser to Supabase, so Vercel's 4.5 MB function body limit
 * doesn't apply and the bucket's own limit is the only ceiling.
 */
export const MAX_FILE_SIZE = 25 * 1024 * 1024;

export const MAX_FILE_SIZE_LABEL = "25 MB";

/**
 * Max size of the file a user may *select*. Images are downscaled and
 * re-encoded before upload, so a 20 MB photo is fine even though a 20 MB
 * stored file is not — this ceiling only exists to stop the browser trying to
 * decode something absurd and running out of memory.
 */
export const MAX_UPLOAD_INPUT_SIZE = 40 * 1024 * 1024;

export const MAX_UPLOAD_INPUT_SIZE_LABEL = "40 MB";

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

/** Shortest password accepted, both in the admin console and by self-service. */
export const MIN_PASSWORD_LENGTH = 8;

/** Default days before expiry for the advance reminder. 0 disables it. */
export const DEFAULT_REMINDER_DAYS_BEFORE = 30;

/**
 * Public URL of the deployed app, used for the button in every reminder email.
 * Falls back to the production deployment so the link is never missing when
 * NEXT_PUBLIC_APP_URL hasn't been set in the environment.
 */
export const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://benfoodschecker.vercel.app"
).replace(/\/+$/, "");
