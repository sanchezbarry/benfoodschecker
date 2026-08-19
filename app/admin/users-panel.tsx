"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { KeyRound, Loader2, Trash2, UserPlus } from "lucide-react";

import { createUser, deleteUser, updateUser, type AdminState } from "./actions";
import type { AppUser } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function Pending({ idle, busy }: { idle: React.ReactNode; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? busy : idle}
    </Button>
  );
}

function Feedback({ state }: { state: AdminState }) {
  if (state?.error)
    return (
      <p className="text-sm text-destructive" role="alert">
        {state.error}
      </p>
    );
  if (state?.success)
    return (
      <p className="text-sm text-primary" role="status">
        {state.success}
      </p>
    );
  return null;
}

/** One account: summary line, with an expandable edit form underneath. */
function UserRow({ user, currentUserId }: { user: AppUser; currentUserId: string }) {
  const [editState, editAction] = useActionState<AdminState, FormData>(
    updateUser,
    null,
  );
  const [deleteState, deleteAction] = useActionState<AdminState, FormData>(
    deleteUser,
    null,
  );

  const isSelf = user.id === currentUserId;
  const canDelete = !isSelf && !user.is_bootstrap_admin;

  return (
    <details className="rounded-lg border">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-4">
        <span className="font-medium">{user.full_name}</span>
        <span className="text-sm text-muted-foreground">{user.email}</span>
        {user.is_admin && (
          <Badge variant={user.is_bootstrap_admin ? "default" : "secondary"}>
            {user.is_bootstrap_admin ? "admin (permanent)" : "admin"}
          </Badge>
        )}
        {isSelf && <Badge variant="outline">you</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">
          {user.last_sign_in_at
            ? `last seen ${formatDateTime(user.last_sign_in_at)}`
            : "never signed in"}
        </span>
      </summary>

      <div className="space-y-4 border-t p-4">
        <form action={editAction} className="space-y-4">
          <input type="hidden" name="user_id" value={user.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`name-${user.id}`}>Name (used as PIC)</Label>
              <Input
                id={`name-${user.id}`}
                name="full_name"
                defaultValue={user.full_name}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`email-${user.id}`}>Email</Label>
              <Input
                id={`email-${user.id}`}
                name="email"
                type="email"
                defaultValue={user.email}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`password-${user.id}`}>New password</Label>
              <Input
                id={`password-${user.id}`}
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="Leave blank to keep the current one"
                minLength={8}
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="is_admin"
                  defaultChecked={user.is_admin}
                  disabled={user.is_bootstrap_admin}
                  className="size-4 accent-primary"
                />
                Administrator
                {user.is_bootstrap_admin && (
                  <span className="text-xs text-muted-foreground">
                    (always on for this account)
                  </span>
                )}
              </label>
            </div>
          </div>
          <Feedback state={editState} />
          <Pending idle={<><KeyRound />Save changes</>} busy="Saving…" />
        </form>

        {canDelete ? (
          <form
            action={deleteAction}
            onSubmit={(e) => {
              if (
                !confirm(
                  `Delete ${user.email}? Their certificates and uploaded files are deleted too. This cannot be undone.`,
                )
              )
                e.preventDefault();
            }}
            className="space-y-2 border-t pt-4"
          >
            <input type="hidden" name="user_id" value={user.id} />
            <Feedback state={deleteState} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 />
              Delete this user
            </Button>
          </form>
        ) : (
          <p className="border-t pt-4 text-xs text-muted-foreground">
            {isSelf
              ? "You can't delete your own account."
              : "This is a permanent admin account and can't be deleted."}
          </p>
        )}
      </div>
    </details>
  );
}

export function UsersPanel({
  users,
  missingAdminEmails,
  currentUserId,
}: {
  users: AppUser[];
  missingAdminEmails: string[];
  currentUserId: string;
}) {
  const [state, formAction] = useActionState<AdminState, FormData>(
    createUser,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>
          Create accounts, change names, emails and passwords, and grant or
          revoke admin access. Sign-up is closed to the public — every account
          starts here. The name you set becomes the PIC on that person&apos;s
          certificates.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {missingAdminEmails.length > 0 && (
          <div
            className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning"
            role="status"
          >
            {missingAdminEmails.join(" and ")}{" "}
            {missingAdminEmails.length === 1 ? "is" : "are"} designated
            administrator{missingAdminEmails.length === 1 ? "" : "s"} with no
            account yet. Create {missingAdminEmails.length === 1 ? "it" : "them"}{" "}
            below — admin rights are granted automatically.
          </div>
        )}

        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new_full_name">Name</Label>
              <Input
                id="new_full_name"
                name="full_name"
                placeholder="e.g. Amy Tan"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new_email">Email</Label>
              <Input
                id="new_email"
                name="email"
                type="email"
                defaultValue={missingAdminEmails[0] ?? ""}
                placeholder="person@benfoods.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new_password">Password</Label>
              <Input
                id="new_password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                minLength={8}
                required
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="is_admin"
                  className="size-4 accent-primary"
                />
                Administrator
              </label>
            </div>
          </div>
          <Feedback state={state} />
          <Pending idle={<><UserPlus />Create user</>} busy="Creating…" />
        </form>

        <div className="space-y-2">
          <p className="text-sm font-medium">
            {users.length} account{users.length === 1 ? "" : "s"}
          </p>
          {users.map((user) => (
            <UserRow key={user.id} user={user} currentUserId={currentUserId} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
