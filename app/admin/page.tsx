import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand-logo";
import { listCertificates, listFolders, listUsers } from "./data";
import { UsersPanel } from "./users-panel";
import { FoldersPanel } from "./folders-panel";
import { TestsPanel } from "./tests-panel";
import { LogoutButton } from "../dashboard/logout-button";

// Admin data comes from the auth API and the service-role client; never cache it.
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { user, admin } = await getSession();

  // The proxy already blocks non-admins; this is the authoritative check.
  if (!user) redirect("/login");
  if (!admin) redirect("/dashboard");

  const [{ users, missingAccounts }, folders, certificates] =
    await Promise.all([listUsers(), listFolders(), listCertificates()]);

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <BrandLogo priority />
            <div className="min-w-0 border-l pl-3 leading-tight">
              <p className="text-sm font-semibold">Admin console</p>
              <p className="truncate text-xs text-muted-foreground">
                {user.email}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">
                <ArrowLeft />
                Dashboard
              </Link>
            </Button>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 p-4 sm:p-6">
        <UsersPanel
          users={users}
          missingAccounts={missingAccounts}
          currentUserId={user.id}
        />
        <FoldersPanel folders={folders} />
        <TestsPanel
          certificates={certificates}
          defaultEmail={user.email ?? ""}
        />
      </main>
    </div>
  );
}
