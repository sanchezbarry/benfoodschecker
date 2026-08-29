-- ============================================================================
-- Migration 007 — correcting a certificate after it has been filed
--
-- Run this in the Supabase SQL Editor. Safe to run more than once.
--
-- The dashboard gains an "Edit" control on every certificate the caller may
-- write: vendor code, vendor name and expiry date. Two of those three already
-- work under the existing policies —
--
--   * changing the expiry is an UPDATE on `documents` (and on the current
--     `document_versions` row, which mirrors it), both already open to the
--     owner and to admins;
--   * changing the code re-files the certificate into the folder that code
--     names, creating it when the code is new. That is `documents.folder_id`,
--     the same UPDATE.
--
-- Only the name needed the database to change. A folder is *shared*: renaming
-- FL001 rewrites the vendor name shown on every certificate inside it, so
-- renaming was admin-only. That reasoning stops applying when the folder holds
-- nothing but the caller's own certificates — there is nobody else to affect,
-- and it is exactly the case a user hits after mistyping a vendor name while
-- creating the folder on the upload form.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) "Is this folder entirely mine?"
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER is load-bearing, not incidental. A policy expression is part
-- of the query it guards, so a plain sub-select on `documents` would itself be
-- filtered by that table's RLS: other people's certificates would be invisible,
-- `not exists (... someone else's ...)` would always hold, and one certificate
-- in a shared folder would be enough to rename it for everybody. Running as the
-- owner is what lets the check count the rows it is supposed to count.
--
-- An empty folder answers false — there is nothing here that is "mine" — so
-- tidying up unused folders stays an admin job.
create or replace function public.owns_folder_contents(folder uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.can_write()
     and exists (
       select 1 from public.documents d
       where d.folder_id = folder and d.user_id = auth.uid()
     )
     and not exists (
       select 1 from public.documents d
       where d.folder_id = folder and d.user_id <> auth.uid()
     );
$$;

-- ---------------------------------------------------------------------------
-- 2) Widen the folder UPDATE policy to match
-- ---------------------------------------------------------------------------
-- `folders_code_unique` still rejects a rename onto a code already in use, so
-- this cannot be used to collide two vendors.
drop policy if exists "folders - admins may amend" on public.folders;
drop policy if exists "folders - admin or sole owner may amend" on public.folders;

create policy "folders - admin or sole owner may amend"
  on public.folders for update
  to authenticated
  using (public.is_admin() or public.owns_folder_contents(id))
  with check (public.is_admin() or public.owns_folder_contents(id));
