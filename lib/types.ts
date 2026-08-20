import type { AppRole } from "@/lib/auth";

export type DocumentStatus = "active" | "notified" | "escalated";

/** A vendor / customer. Every certificate is filed inside exactly one folder. */
export interface Folder {
  id: string;
  code: string; // e.g. FL001
  name: string; // e.g. Fresh Life Pte Ltd
  created_by: string | null;
  created_at: string;
}

/** A folder plus the number of certificates filed in it. */
export interface FolderWithCount extends Folder {
  cert_count: number;
}

/**
 * One uploaded file for a certificate. A certificate can retain any number of
 * old versions, but only the `is_current` one has its expiry date tracked.
 */
export interface DocumentVersion {
  id: string;
  document_id: string;
  version: number;
  file_path: string;
  file_type: string;
  file_size: number;
  expiry_date: string;
  is_current: boolean;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
}

/**
 * A tracked certificate (mirrors the `documents` table). The file and expiry
 * columns always mirror the current version — see `document_versions`.
 */
export interface CertDocument {
  id: string;
  user_id: string;
  folder_id: string;
  cert_type: string;
  pic_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  expiry_date: string; // ISO timestamptz — 00:00 local on the expiry date
  marketing_email: string;
  management_email: string;
  escalation_days: number;
  status: DocumentStatus;
  notified_at: string | null;
  escalated_at: string | null;
  created_at: string;
  /** Joined from `folders` — present on every query the app makes. */
  folder?: Pick<Folder, "id" | "code" | "name"> | null;
  /** Joined from `document_versions` where the UI shows upload history. */
  versions?: DocumentVersion[];
}

/** An account as shown in the admin console. */
export interface AppUser {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  /** A permanent admin: the role selector is locked for these. */
  is_bootstrap_admin: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

/** An account the admin console suggests creating because it doesn't exist yet. */
export interface SuggestedAccount {
  email: string;
  role: AppRole;
}

/** Values already used elsewhere, offered as dropdown hints on free-text fields. */
export interface Suggestions {
  vendors: Pick<Folder, "id" | "code" | "name">[];
  certTypes: string[];
  marketingEmails: string[];
  managementEmails: string[];
}
