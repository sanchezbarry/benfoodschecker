"use server";

import { getSession } from "@/lib/session";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";

export type AccountState = { error?: string; success?: string } | null;

/**
 * Let a signed-in user change their own password. Available to every role,
 * including view-only department accounts — managing your own credentials
 * isn't a write to anybody's certificates.
 */
export async function changePassword(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const { supabase, user } = await getSession();
  if (!user?.email) return { error: "You must be signed in." };

  const current = String(formData.get("current_password") ?? "");
  const next = String(formData.get("new_password") ?? "");
  const confirmation = String(formData.get("confirm_password") ?? "");

  if (!current) return { error: "Enter your current password." };
  if (next.length < MIN_PASSWORD_LENGTH)
    return {
      error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  if (next !== confirmation)
    return { error: "The two new passwords don't match." };
  if (next === current)
    return { error: "The new password must be different from the current one." };

  // Re-authenticate before allowing the change. Supabase will happily update a
  // password from a live session without the old one, which would let anyone
  // who got hold of a signed-in browser lock the real owner out of the account.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (reauthError) return { error: "Your current password is incorrect." };

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { error: error.message };

  return { success: "Password updated. Use it next time you sign in." };
}
