"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_LABELS, isBootstrapAdmin, type AppRole } from "@/lib/auth";
import {
  sendEscalationEmail,
  sendExpiryEmail,
  sendUpcomingExpiryEmail,
  type MailableCert,
} from "@/lib/email";
import { runReminderJob } from "@/lib/reminders";
import {
  DEFAULT_ESCALATION_DAYS,
  DEFAULT_REMINDER_DAYS_BEFORE,
  DOCUMENTS_BUCKET,
  MIN_PASSWORD_LENGTH,
} from "@/lib/constants";
import type { CertDocument } from "@/lib/types";

export type AdminState = { error?: string; success?: string } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The role comes off a form, so treat it as untrusted: anything unrecognised
 * falls back to the least-privileged option rather than being taken at face
 * value. Bootstrap admin emails are forced to admin regardless.
 */
function readRole(formData: FormData, email: string): AppRole {
  if (isBootstrapAdmin(email)) return "admin";
  const value = String(formData.get("role") ?? "");
  return value === "admin" || value === "department" ? value : "user";
}

/**
 * Every export in this file is a reachable POST endpoint, so each action
 * re-derives the caller's admin status from the session. Nothing about who the
 * caller is ever comes from the form.
 */
async function requireAdmin() {
  const { supabase, user, admin } = await getSession();
  if (!user || !admin) return null;
  return { supabase, user };
}

// ===========================================================================
// Users
// ===========================================================================

export async function createUser(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  if (!(await requireAdmin())) return { error: "Admins only." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();

  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  if (password.length < MIN_PASSWORD_LENGTH)
    return {
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  if (!fullName)
    return {
      error:
        "Enter the person's name — it is used as the PIC on their certificates.",
    };

  const role = readRole(formData, email);

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    // Admin-created accounts are trusted, so skip the confirmation email.
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { role },
  });

  if (error) return { error: error.message };

  revalidatePath("/admin");
  return {
    success: `${fullName} (${email}) can now sign in as: ${ROLE_LABELS[role]}.`,
  };
}

export async function updateUser(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireAdmin();
  if (!session) return { error: "Admins only." };

  const userId = String(formData.get("user_id") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!userId) return { error: "Missing user." };
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  if (!fullName) return { error: "Name cannot be empty." };
  if (password && password.length < MIN_PASSWORD_LENGTH)
    return {
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };

  const role = readRole(formData, email);

  // Demoting yourself would lock you out of this console on the next page load,
  // so refuse rather than let it happen mid-session.
  if (userId === session.user.id && role !== "admin") {
    return { error: "You can't remove your own admin access." };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    email,
    user_metadata: { full_name: fullName },
    app_metadata: { role },
    ...(password ? { password } : {}),
  });

  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return {
    success: `${fullName} updated (${ROLE_LABELS[role]})${password ? ", including a new password" : ""}.`,
  };
}

export async function deleteUser(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireAdmin();
  if (!session) return { error: "Admins only." };

  const userId = String(formData.get("user_id") ?? "");
  if (!userId) return { error: "Missing user." };
  if (userId === session.user.id)
    return { error: "You can't delete your own account." };

  const admin = createAdminClient();

  const { data: target } = await admin.auth.admin.getUserById(userId);
  if (!target?.user) return { error: "That account no longer exists." };
  if (isBootstrapAdmin(target.user.email))
    return {
      error: `${target.user.email} is a permanent admin account and can't be deleted.`,
    };

  // Their certificate rows cascade with the auth user, but the stored files
  // would be orphaned, so clear the user's storage folder first.
  const { data: files } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .list(userId, { limit: 1000 });

  if (files && files.length > 0) {
    await admin.storage
      .from(DOCUMENTS_BUCKET)
      .remove(files.map((f) => `${userId}/${f.name}`));
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return {
    success: `${target.user.email} deleted, along with their certificates and files.`,
  };
}

// ===========================================================================
// Folders (vendors / customers)
// ===========================================================================

export async function createFolder(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireAdmin();
  if (!session) return { error: "Admins only." };

  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!code) return { error: "Vendor / customer code is required." };
  if (!name) return { error: "Vendor / customer name is required." };

  // The user's own client, so the database policy checks admin rights too.
  const { error } = await session.supabase
    .from("folders")
    .insert({ code, name, created_by: session.user.id });

  if (error) {
    if (error.code === "23505")
      return { error: `A folder with the code ${code} already exists.` };
    return { error: error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return { success: `Folder ${code} — ${name} created.` };
}

export async function updateFolder(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireAdmin();
  if (!session) return { error: "Admins only." };

  const id = String(formData.get("id") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!id) return { error: "Missing folder." };
  if (!code) return { error: "Vendor / customer code is required." };
  if (!name) return { error: "Vendor / customer name is required." };

  const { error } = await session.supabase
    .from("folders")
    .update({ code, name })
    .eq("id", id);

  if (error) {
    if (error.code === "23505")
      return { error: `A folder with the code ${code} already exists.` };
    return { error: error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return { success: `Folder updated to ${code} — ${name}.` };
}

export async function deleteFolder(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireAdmin();
  if (!session) return { error: "Admins only." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing folder." };

  // Refuse rather than cascade: deleting a folder must never silently take a
  // pile of tracked certificates with it.
  const { count } = await session.supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("folder_id", id);

  if (count && count > 0) {
    return {
      error: `That folder still holds ${count} certificate${count === 1 ? "" : "s"}. Delete or refile them first.`,
    };
  }

  const { error } = await session.supabase.from("folders").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return { success: "Folder deleted." };
}

// ===========================================================================
// Test triggers
// ===========================================================================

/**
 * Stand-in used when no real certificate is chosen for a test email. Built per
 * call so the sample reads as "expired just now" rather than whenever the
 * server happened to boot.
 */
function sampleCert(): MailableCert {
  return {
    cert_type: "ISO 22000",
    pic_name: "Sample PIC",
    // Far enough out that the Level 0 wording ("expires in N days") reads
    // sensibly; Levels 1 and 2 describe the date rather than the gap.
    expiry_date: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    marketing_email: "marketing@benfoods.com",
    management_email: "director@benfoods.com",
    reminder_days_before: DEFAULT_REMINDER_DAYS_BEFORE,
    escalation_days: DEFAULT_ESCALATION_DAYS,
    folder: { code: "FL001", name: "Sample Vendor Pte Ltd" },
  };
}

/** Load the chosen certificate, or fall back to the sample. */
async function resolveSample(
  supabase: Awaited<ReturnType<typeof getSession>>["supabase"],
  certId: string,
): Promise<MailableCert> {
  if (!certId) return sampleCert();

  const { data } = await supabase
    .from("documents")
    .select("*, folder:folders(code, name)")
    .eq("id", certId)
    .single();

  return (data as CertDocument | null) ?? sampleCert();
}

/**
 * Send a Level 0 advance reminder to an address of the admin's choosing.
 * Nothing in the database changes — no `reminded_at` is stamped, so the real
 * workflow is unaffected.
 */
export async function sendReminderTest(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireAdmin();
  if (!session) return { error: "Admins only." };

  const to = String(formData.get("to") ?? "").trim();
  const certId = String(formData.get("cert_id") ?? "");

  if (!EMAIL_RE.test(to))
    return { error: "Enter a valid email address to send the test to." };

  const cert = await resolveSample(session.supabase, certId);

  const { error } = await sendUpcomingExpiryEmail(cert, { to, test: true });
  if (error) return { error: `Resend rejected the email: ${error.message}` };

  return { success: `Advance reminder test sent to ${to}.` };
}

/**
 * Send a Level 1 expiry notification to an address of the admin's choosing.
 * Nothing in the database changes — no status is advanced, so the real
 * workflow is unaffected.
 */
export async function sendExpiryTest(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireAdmin();
  if (!session) return { error: "Admins only." };

  const to = String(formData.get("to") ?? "").trim();
  const certId = String(formData.get("cert_id") ?? "");

  if (!EMAIL_RE.test(to))
    return { error: "Enter a valid email address to send the test to." };

  const cert = await resolveSample(session.supabase, certId);

  const { error } = await sendExpiryEmail(cert, { to, test: true });
  if (error) return { error: `Resend rejected the email: ${error.message}` };

  return { success: `Expiry notification test sent to ${to}.` };
}

/**
 * Send a Level 2 escalation to the address(es) the admin types in. Again, no
 * certificate status is touched.
 */
export async function sendEscalationTest(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireAdmin();
  if (!session) return { error: "Admins only." };

  const to = String(formData.get("escalate_to") ?? "").trim();
  const cc = String(formData.get("cc") ?? "").trim();
  const certId = String(formData.get("cert_id") ?? "");

  if (!EMAIL_RE.test(to))
    return { error: "Enter a valid email address to escalate to." };
  if (cc && !EMAIL_RE.test(cc))
    return { error: "The cc address doesn't look like a valid email." };

  const cert = await resolveSample(session.supabase, certId);

  const { error } = await sendEscalationEmail(cert, {
    to,
    cc: cc || null,
    test: true,
  });
  if (error) return { error: `Resend rejected the email: ${error.message}` };

  return {
    success: `Escalation test sent to ${to}${cc ? `, cc ${cc}` : ""}.`,
  };
}

/**
 * Run the real scheduled job right now, instead of waiting for the daily cron.
 * This one DOES advance statuses and email real contacts.
 */
export async function runRemindersNow(
  _prev: AdminState,
  _formData: FormData,
): Promise<AdminState> {
  if (!(await requireAdmin())) return { error: "Admins only." };

  const result = await runReminderJob();

  revalidatePath("/admin");
  revalidatePath("/dashboard");

  const summary =
    `${result.reminded} advance reminder${result.reminded === 1 ? "" : "s"}, ` +
    `${result.notified} expiry notification${result.notified === 1 ? "" : "s"} and ` +
    `${result.escalated} escalation${result.escalated === 1 ? "" : "s"} sent.`;

  if (result.errors.length > 0) {
    return { error: `${summary} Errors: ${result.errors.join("; ")}` };
  }
  return { success: summary };
}
