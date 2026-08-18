import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  BOOTSTRAP_ADMIN_EMAILS,
  displayName,
  isAdmin,
  isBootstrapAdmin,
} from "@/lib/auth";
import type { AppUser, CertDocument, FolderWithCount } from "@/lib/types";

/**
 * Read-only loaders for the admin console.
 *
 * Deliberately NOT a "use server" module: every export of such a file becomes a
 * publicly callable endpoint, and these are plain Server Component reads. The
 * page guards access before calling them.
 */

/** Every account, plus which of the named admin emails has no account yet. */
export async function listUsers(): Promise<{
  users: AppUser[];
  missingAdminEmails: string[];
}> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });

  if (error || !data) return { users: [], missingAdminEmails: [] };

  const users: AppUser[] = data.users
    .map((u) => ({
      id: u.id,
      email: u.email ?? "",
      full_name: displayName(u),
      is_admin: isAdmin(u),
      is_bootstrap_admin: isBootstrapAdmin(u.email),
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));

  const existing = new Set(users.map((u) => u.email.toLowerCase()));
  const missingAdminEmails = BOOTSTRAP_ADMIN_EMAILS.filter(
    (email) => !existing.has(email),
  );

  return { users, missingAdminEmails };
}

/** Vendor / customer folders with how many certificates each holds. */
export async function listFolders(): Promise<FolderWithCount[]> {
  const admin = createAdminClient();

  const [{ data: folders }, { data: docs }] = await Promise.all([
    admin.from("folders").select("*").order("code"),
    admin.from("documents").select("folder_id"),
  ]);

  const counts = new Map<string, number>();
  for (const row of (docs ?? []) as { folder_id: string }[]) {
    counts.set(row.folder_id, (counts.get(row.folder_id) ?? 0) + 1);
  }

  return ((folders ?? []) as FolderWithCount[]).map((f) => ({
    ...f,
    cert_count: counts.get(f.id) ?? 0,
  }));
}

/** Certificates an admin can pick as the sample for a test email. */
export async function listCertificates(): Promise<CertDocument[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("*, folder:folders(id, code, name)")
    .order("expiry_date", { ascending: true });
  return (data ?? []) as CertDocument[];
}
