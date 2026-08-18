import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";

/**
 * The signed-in user plus a ready-to-use server client, for Server Components
 * and Server Actions. `admin` is re-derived from the session on every call —
 * never trust an admin flag that arrived from the browser.
 */
export async function getSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user, admin: isAdmin(user) };
}
