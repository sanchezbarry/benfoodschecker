import type { User } from "@supabase/supabase-js";

/**
 * What a signed-in account may do.
 *
 *   admin       everything: all certificates, plus users and folders
 *   department  read-only:  all certificates, may download, changes nothing
 *   user        the default: only its own certificates
 *
 * Stored in `app_metadata.role`, which only the service-role key can write, so
 * nobody can promote themselves. Mirrored by public.app_role() in
 * supabase/schema.sql.
 */
export type AppRole = "admin" | "department" | "user";

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

/**
 * Accounts the admin console offers to create if they don't exist yet. Purely a
 * convenience prompt — unlike BOOTSTRAP_ADMIN_EMAILS this grants nothing, the
 * role still comes from app_metadata once the account is made.
 */
export const SUGGESTED_DEPARTMENT_EMAILS = ["marketing@benfoods.com"] as const;

/** Resolve a user's role. Bootstrap admins outrank whatever metadata says. */
export function roleOf(user: User | null | undefined): AppRole {
  if (!user) return "user";
  if (isBootstrapAdmin(user.email)) return "admin";
  const role = user.app_metadata?.role;
  return role === "admin" || role === "department" ? role : "user";
}

/** May reach /admin, and manage users, folders and everyone's certificates. */
export function isAdmin(user: User | null | undefined): boolean {
  return !!user && roleOf(user) === "admin";
}

/** Sees every certificate. True for admins and department users alike. */
export function canViewAll(user: User | null | undefined): boolean {
  const role = roleOf(user);
  return !!user && (role === "admin" || role === "department");
}

/**
 * May create, amend or delete anything at all. Department users are strictly
 * read-only, so this is the one gate every write has to pass.
 */
export function canWrite(user: User | null | undefined): boolean {
  return !!user && roleOf(user) !== "department";
}

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrator",
  department: "Department — view & download only",
  user: "Standard user",
};

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
