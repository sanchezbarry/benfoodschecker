import type { User } from "@supabase/supabase-js";

/**
 * Accounts that are admins no matter what.
 *
 * The real source of truth is `app_metadata.role === "admin"`, which only the
 * service-role key can set (so a user can never promote themselves). This list
 * is the bootstrap fallback: it guarantees the console is reachable on the very
 * first login, before any metadata has been stamped, and that locking yourself
 * out of admin is impossible.
 *
 * Mirrored by the email array inside `public.is_admin()` — if you change one,
 * change the other (supabase/schema.sql).
 */
export const BOOTSTRAP_ADMIN_EMAILS = [
  "tester@test.com",
  "mis-help@benfoods.com",
] as const;

export function isBootstrapAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalised = email.trim().toLowerCase();
  return BOOTSTRAP_ADMIN_EMAILS.some((e) => e === normalised);
}

/** Whether a signed-in user may reach /admin and see every user's certificates. */
export function isAdmin(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.app_metadata?.role === "admin") return true;
  return isBootstrapAdmin(user.email);
}

/**
 * The name shown as PIC on certificates this user creates. Admins set
 * `full_name` when creating the account; otherwise fall back to the email
 * handle so the field is never blank.
 */
export function displayName(user: User | null | undefined): string {
  if (!user) return "Unknown";
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  for (const key of ["full_name", "name"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return user.email?.split("@")[0] || "Unknown";
}
