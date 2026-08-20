-- ============================================================================
-- Migration 004 — the "department" role: read every certificate, change none
--
-- Run this in the Supabase SQL Editor. Safe to run more than once, and safe to
-- run a section at a time (there is no begin/commit wrapper — see 002).
--
-- Three roles now, resolved from `app_metadata.role` on the auth user, which
-- only the service-role key can write:
--
--   admin       everything: sees all certificates, manages users and folders
--   department  read-only:  sees all certificates, may download, changes nothing
--   user        the default: sees and manages only its own certificates
--
-- Read access widens for department; write access deliberately does not. Note
-- that "owns nothing, so can't write anything" is NOT enough on its own — a
-- department user could otherwise insert a row with their own uid as user_id
-- and become its owner. Hence the explicit can_write() on every write policy.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Role helpers
-- ---------------------------------------------------------------------------
-- The bootstrap admin emails keep their override so the console can never be
-- locked out. Keep the list in sync with BOOTSTRAP_ADMIN_EMAILS in lib/auth.ts.
create or replace function public.app_role()
returns text
language sql
stable
as $$
  select case
    when lower(coalesce(auth.jwt() ->> 'email', '')) = any (
      array['tester@test.com', 'mis-help@benfoods.com']
    ) then 'admin'
    else coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''), 'user')
  end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select public.app_role() = 'admin';
$$;

/* Admins and department users both see every certificate. */
create or replace function public.can_view_all()
returns boolean
language sql
stable
as $$
  select public.app_role() in ('admin', 'department');
$$;

/* Department users are strictly read-only; everyone else may write. */
create or replace function public.can_write()
returns boolean
language sql
stable
as $$
  select public.app_role() <> 'department';
$$;

-- ---------------------------------------------------------------------------
-- 2) Folders — readable by all, but department may no longer add one
-- ---------------------------------------------------------------------------
drop policy if exists "folders - any signed-in user may add" on public.folders;

create policy "folders - any signed-in user may add"
  on public.folders for insert to authenticated
  with check (auth.uid() is not null and public.can_write());

-- ---------------------------------------------------------------------------
-- 3) Documents — widen SELECT, pin down the writes
-- ---------------------------------------------------------------------------
drop policy if exists "documents - own or admin: select" on public.documents;
drop policy if exists "documents - own: insert" on public.documents;
drop policy if exists "documents - own or admin: update" on public.documents;
drop policy if exists "documents - own or admin: delete" on public.documents;

create policy "documents - own or view-all: select"
  on public.documents for select to authenticated
  using (auth.uid() = user_id or public.can_view_all());

create policy "documents - own: insert"
  on public.documents for insert to authenticated
  with check (auth.uid() = user_id and public.can_write());

create policy "documents - own or admin: update"
  on public.documents for update to authenticated
  using ((auth.uid() = user_id or public.is_admin()) and public.can_write())
  with check ((auth.uid() = user_id or public.is_admin()) and public.can_write());

create policy "documents - own or admin: delete"
  on public.documents for delete to authenticated
  using ((auth.uid() = user_id or public.is_admin()) and public.can_write());

-- ---------------------------------------------------------------------------
-- 4) Versions — inherit the parent certificate's rules
-- ---------------------------------------------------------------------------
drop policy if exists "versions - follow parent document: select" on public.document_versions;
drop policy if exists "versions - follow parent document: insert" on public.document_versions;
drop policy if exists "versions - follow parent document: update" on public.document_versions;
drop policy if exists "versions - follow parent document: delete" on public.document_versions;

create policy "versions - follow parent document: select"
  on public.document_versions for select to authenticated
  using (exists (select 1 from public.documents d
                 where d.id = document_id
                   and (d.user_id = auth.uid() or public.can_view_all())));

create policy "versions - follow parent document: insert"
  on public.document_versions for insert to authenticated
  with check (public.can_write() and exists (select 1 from public.documents d
                where d.id = document_id
                  and (d.user_id = auth.uid() or public.is_admin())));

create policy "versions - follow parent document: update"
  on public.document_versions for update to authenticated
  using (public.can_write() and exists (select 1 from public.documents d
                where d.id = document_id
                  and (d.user_id = auth.uid() or public.is_admin())));

create policy "versions - follow parent document: delete"
  on public.document_versions for delete to authenticated
  using (public.can_write() and exists (select 1 from public.documents d
                where d.id = document_id
                  and (d.user_id = auth.uid() or public.is_admin())));

-- ---------------------------------------------------------------------------
-- 5) Storage — department may read every file, upload none
-- ---------------------------------------------------------------------------
-- If this section alone fails with "ERROR: 42501: must be owner of table
-- objects", everything above is already committed; add these three from the
-- dashboard instead (Storage -> Policies -> documents).
drop policy if exists "documents bucket - own or admin: read" on storage.objects;
drop policy if exists "documents bucket - own or view-all: read" on storage.objects;
drop policy if exists "documents bucket - own: insert" on storage.objects;
drop policy if exists "documents bucket - own or admin: delete" on storage.objects;

create policy "documents bucket - own or view-all: read"
  on storage.objects for select to authenticated
  using (bucket_id = 'documents'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.can_view_all()));

create policy "documents bucket - own: insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'documents'
              and (storage.foldername(name))[1] = auth.uid()::text
              and public.can_write());

create policy "documents bucket - own or admin: delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'documents'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
         and public.can_write());
