import { createClient } from "@/lib/supabase/server";
import { canViewAll, canWrite, isAdmin, roleOf } from "@/lib/auth";

/**
 * The signed-in user plus a ready-to-use server client, for Server Components
 * and Server Actions. Every capability is re-derived from the session on each
 * call — never trust a role or flag that arrived from the browser.
 */
export async function getSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    supabase,
    user,
    role: roleOf(user),
    admin: isAdmin(user),
    /** Sees every certificate: admins and department users. */
    viewAll: canViewAll(user),
    /** May change anything at all: false only for department users. */
    write: canWrite(user),
  };
}
