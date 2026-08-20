import Link from "next/link";
import { redirect } from "next/navigation";
import { Eye, SlidersHorizontal } from "lucide-react";

import { getSession } from "@/lib/session";
import { ROLE_LABELS, displayName } from "@/lib/auth";
import { getSuggestions } from "@/lib/suggestions";
import type { CertDocument } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BrandLogo } from "@/components/brand-logo";
import { UploadForm } from "./upload-form";
import { NewVersionForm } from "./new-version-form";
import { DocumentsList } from "./documents-list";
import { LogoutButton } from "./logout-button";

export default async function DashboardPage() {
  const { supabase, user, admin, role, viewAll, write } = await getSession();

  // Belt-and-suspenders: the proxy already redirects unauthenticated users.
  if (!user) redirect("/login");

  // RLS decides the rows: a standard user sees their own, admins and department
  // users see everyone's.
  const [{ data }, suggestions] = await Promise.all([
    supabase
      .from("documents")
      .select("*, folder:folders(id, code, name), versions:document_versions(*)")
      .order("expiry_date", { ascending: true }),
    getSuggestions(),
  ]);

  const documents = (data ?? []) as CertDocument[];
  const pic = displayName(user);

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <BrandLogo priority />
            <div className="min-w-0 border-l pl-3 leading-tight">
              <p className="text-sm font-semibold">Cert Checker</p>
              <p className="truncate text-xs text-muted-foreground">
                {pic} · {user.email}
                {role !== "user" && ` · ${ROLE_LABELS[role]}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {admin && (
              <Button asChild variant="outline" size="sm">
                <Link href="/admin">
                  <SlidersHorizontal />
                  Admin
                </Link>
              </Button>
            )}
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 p-4 sm:p-6">
        {write ? (
          <>
            <UploadForm suggestions={suggestions} picName={pic} />
            <NewVersionForm documents={documents} />
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Eye className="size-4 text-muted-foreground" />
                View-only access
              </CardTitle>
              <CardDescription>
                You can browse and download every certificate here. Adding,
                replacing and deleting are handled by the team that owns each
                one.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
        <DocumentsList
          documents={documents}
          viewAll={viewAll}
          canWrite={write}
        />
      </main>
    </div>
  );
}
