"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { FolderPlus, Loader2, Save, Trash2 } from "lucide-react";

import {
  createFolder,
  deleteFolder,
  updateFolder,
  type AdminState,
} from "./actions";
import type { FolderWithCount } from "@/lib/types";
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

function FolderRow({ folder }: { folder: FolderWithCount }) {
  const [editState, editAction] = useActionState<AdminState, FormData>(
    updateFolder,
    null,
  );
  const [deleteState, deleteAction] = useActionState<AdminState, FormData>(
    deleteFolder,
    null,
  );

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <form
        action={editAction}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <input type="hidden" name="id" value={folder.id} />
        <div className="space-y-2 sm:w-40">
          <Label htmlFor={`code-${folder.id}`}>Code</Label>
          <Input
            id={`code-${folder.id}`}
            name="code"
            defaultValue={folder.code}
            className="font-mono"
            required
          />
        </div>
        <div className="flex-1 space-y-2">
          <Label htmlFor={`name-${folder.id}`}>Name</Label>
          <Input
            id={`name-${folder.id}`}
            name="name"
            defaultValue={folder.name}
            required
          />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            {folder.cert_count} cert{folder.cert_count === 1 ? "" : "s"}
          </Badge>
          <Pending idle={<><Save />Save</>} busy="Saving…" />
        </div>
      </form>

      <form
        action={deleteAction}
        onSubmit={(e) => {
          if (!confirm(`Delete the folder ${folder.code} — ${folder.name}?`))
            e.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={folder.id} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
          Delete folder
        </Button>
      </form>

      <Feedback state={editState} />
      <Feedback state={deleteState} />
    </div>
  );
}

export function FoldersPanel({ folders }: { folders: FolderWithCount[] }) {
  const [state, formAction] = useActionState<AdminState, FormData>(
    createFolder,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vendor / customer folders</CardTitle>
        <CardDescription>
          Every certificate is filed in one folder. Users can create a folder by
          typing a new code on the upload form; renaming and deleting are admin
          only. A folder that still holds certificates can&apos;t be deleted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form
          ref={formRef}
          action={formAction}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="space-y-2 sm:w-40">
            <Label htmlFor="new_folder_code">Code</Label>
            <Input
              id="new_folder_code"
              name="code"
              placeholder="FL001"
              className="font-mono"
              required
            />
          </div>
          <div className="flex-1 space-y-2">
            <Label htmlFor="new_folder_name">Name</Label>
            <Input
              id="new_folder_name"
              name="name"
              placeholder="Fresh Life Pte Ltd"
              required
            />
          </div>
          <Pending idle={<><FolderPlus />Add folder</>} busy="Adding…" />
        </form>
        <Feedback state={state} />

        {folders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No folders yet. Add one above, or let a user create the first by
            filing a certificate.
          </p>
        ) : (
          <div className="space-y-3">
            {folders.map((folder) => (
              <FolderRow key={folder.id} folder={folder} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
