import { createAdminClient } from "@/lib/supabase/admin";
import type { Suggestions } from "@/lib/types";

function distinct(values: (string | null | undefined)[]) {
  const cleaned = values
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v));
  return Array.from(new Set(cleaned)).sort((a, b) => a.localeCompare(b));
}

/**
 * Dropdown hints for the free-text fields on the certificate form: vendor
 * code/name, certificate type, and the two contact emails.
 *
 * Read with the service-role client on purpose. RLS scopes a user to their own
 * certificates, but the point of these lists is to reuse the vocabulary the
 * *company* has already typed — otherwise a new user's dropdowns are empty and
 * everyone invents their own spelling of "ISO 22000". Only distinct scalar
 * values are returned, never rows, so no one else's certificates are exposed.
 */
export async function getSuggestions(): Promise<Suggestions> {
  const admin = createAdminClient();

  const [folders, docs] = await Promise.all([
    admin.from("folders").select("id, code, name").order("code"),
    admin.from("documents").select("cert_type, marketing_email, management_email"),
  ]);

  const rows = docs.data ?? [];

  return {
    vendors: folders.data ?? [],
    certTypes: distinct(rows.map((r) => r.cert_type)),
    marketingEmails: distinct(rows.map((r) => r.marketing_email)),
    managementEmails: distinct(rows.map((r) => r.management_email)),
  };
}
