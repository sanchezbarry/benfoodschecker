export type DocumentStatus = "active" | "notified" | "escalated";

/** A tracked document / certificate row (mirrors the `documents` table). */
export interface CertDocument {
  id: string;
  user_id: string;
  name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  expiry_date: string; // ISO timestamptz — full date + time of expiry
  marketing_email: string;
  management_email: string;
  escalation_days: number;
  status: DocumentStatus;
  notified_at: string | null;
  escalated_at: string | null;
  created_at: string;
}
