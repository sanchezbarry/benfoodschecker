import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import type { CertDocument } from "@/lib/types";
import { UploadForm } from "./upload-form";
import { DocumentsList } from "./documents-list";
import { LogoutButton } from "./logout-button";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Belt-and-suspenders: the proxy already redirects unauthenticated users.
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("documents")
    .select("*")
    .order("expiry_date", { ascending: true });

  const documents = (data ?? []) as CertDocument[];

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold">Ben Foods · Cert Checker</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <LogoutButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 p-4 sm:p-6">
        <UploadForm />
        <DocumentsList documents={documents} />
      </main>
    </div>
  );
}
