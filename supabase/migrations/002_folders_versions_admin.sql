-- ============================================================================
-- Migration 002 — vendor/customer folders, cert versioning, admin role
--
-- Run this ONCE in the Supabase SQL Editor if you already have the v1
-- `documents` table. A fresh project should run `supabase/schema.sql` instead.
--
-- What it does
--   • adds public.is_admin()
--   • adds the `folders` table (one row per vendor/customer)
--   • adds folder_id / cert_type / pic_name to `documents`, backfilling every
--     existing row into an "UNSORTED" folder with its old name as the cert type
--   • adds `document_versions` and seeds version 1 from each existing document
--   • replaces the RLS + storage policies so admins can see everything
--
-- Safe to run more than once, and safe to run a section at a time: every step
-- is guarded (`if not exists`, `is null`, `if exists`), so a re-run is a no-op
-- rather than an error.
--
-- NOTE: there is deliberately no `begin;` / `commit;` wrapper. The Supabase SQL
-- Editor already runs each execution in its own transaction, so the whole file
-- pasted at once is still atomic — but an explicit transaction spanning the
-- file would be silently rolled back if you ran the sections one by one.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Admin role  (see the comment in schema.sql — keep the email list in sync
--    with BOOTSTRAP_ADMIN_EMAILS in lib/auth.ts)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select
    coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
    or lower(coalesce(auth.jwt() ->> 'email', '')) = any (
      array['tester@test.com', 'mis-help@benfoods.com']
    );
$$;

-- ---------------------------------------------------------------------------
-- 2) Folders
-- ---------------------------------------------------------------------------
create table if not exists public.folders (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,
  name       text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint folders_code_not_blank check (length(btrim(code)) > 0),
  constraint folders_name_not_blank check (length(btrim(name)) > 0)
);

create unique index if not exists folders_code_unique
  on public.folders (upper(code));

-- ---------------------------------------------------------------------------
-- 3) New columns on documents
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists folder_id uuid references public.folders (id) on delete restrict,
  add column if not exists cert_type text,
  add column if not exists pic_name  text;

-- Park every pre-existing certificate in a holding folder so the NOT NULL
-- constraints below can be applied. Admins can rename it or create the real
-- vendors and refile afterwards.
insert into public.folders (code, name)
select 'UNSORTED', 'Unsorted — filed before folders existed'
where exists (select 1 from public.documents where folder_id is null)
  and not exists (select 1 from public.folders where upper(code) = 'UNSORTED');

update public.documents d
set folder_id = f.id
from public.folders f
where d.folder_id is null and upper(f.code) = 'UNSORTED';

-- The old free-text `name` becomes the certificate type. Guarded, because the
-- column is dropped further down: on a re-run there is no `name` to read.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'documents'
      and column_name = 'name'
  ) then
    execute 'update public.documents set cert_type = name where cert_type is null';
  end if;
end $$;

-- PIC comes from the owner's display name, falling back to their email handle.
update public.documents d
set pic_name = coalesce(
  nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
  split_part(u.email, '@', 1),
  'Unknown'
)
from auth.users u
where d.pic_name is null and u.id = d.user_id;

update public.documents set pic_name = 'Unknown' where pic_name is null;

alter table public.documents
  alter column folder_id set not null,
  alter column cert_type set not null,
  alter column pic_name  set not null;

-- `name` is superseded by folder (vendor) + cert_type; its content now lives
-- in cert_type, so the column can go.
alter table public.documents drop column if exists name;

create index if not exists documents_folder_id_idx on public.documents (folder_id);
create index if not exists documents_cert_type_idx on public.documents (cert_type);

-- ---------------------------------------------------------------------------
-- 4) Document versions
-- ---------------------------------------------------------------------------
create table if not exists public.document_versions (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references public.documents (id) on delete cascade,
  version          integer not null check (version > 0),
  file_path        text not null,
  file_type        text not null,
  file_size        bigint not null,
  expiry_date      timestamptz not null,
  is_current       boolean not null default false,
  uploaded_by      uuid references auth.users (id) on delete set null,
  uploaded_by_name text,
  created_at       timestamptz not null default now(),
  unique (document_id, version)
);

create index if not exists document_versions_document_id_idx
  on public.document_versions (document_id);

create unique index if not exists document_versions_single_current
  on public.document_versions (document_id)
  where is_current;

-- Seed version 1 for every certificate that has no history yet.
insert into public.document_versions (
  document_id, version, file_path, file_type, file_size,
  expiry_date, is_current, uploaded_by, uploaded_by_name, created_at
)
select d.id, 1, d.file_path, d.file_type, d.file_size,
       d.expiry_date, true, d.user_id, d.pic_name, d.created_at
from public.documents d
where not exists (
  select 1 from public.document_versions v where v.document_id = d.id
);

-- ---------------------------------------------------------------------------
-- 5) Row Level Security — replace the owner-only policies with owner-or-admin
-- ---------------------------------------------------------------------------
alter table public.folders enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;

drop policy if exists "own documents - select" on public.documents;
drop policy if exists "own documents - insert" on public.documents;
drop policy if exists "own documents - update" on public.documents;
drop policy if exists "own documents - delete" on public.documents;

drop policy if exists "folders - read for all signed-in users" on public.folders;
drop policy if exists "folders - any signed-in user may add" on public.folders;
drop policy if exists "folders - admins may amend" on public.folders;
drop policy if exists "folders - admins may delete" on public.folders;

create policy "folders - read for all signed-in users"
  on public.folders for select to authenticated using (true);

create policy "folders - any signed-in user may add"
  on public.folders for insert to authenticated
  with check (auth.uid() is not null);

create policy "folders - admins may amend"
  on public.folders for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "folders - admins may delete"
  on public.folders for delete to authenticated
  using (public.is_admin());

drop policy if exists "documents - own or admin: select" on public.documents;
drop policy if exists "documents - own: insert" on public.documents;
drop policy if exists "documents - own or admin: update" on public.documents;
drop policy if exists "documents - own or admin: delete" on public.documents;

create policy "documents - own or admin: select"
  on public.documents for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

create policy "documents - own: insert"
  on public.documents for insert to authenticated
  with check (auth.uid() = user_id);

create policy "documents - own or admin: update"
  on public.documents for update to authenticated
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

create policy "documents - own or admin: delete"
  on public.documents for delete to authenticated
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "versions - follow parent document: select" on public.document_versions;
drop policy if exists "versions - follow parent document: insert" on public.document_versions;
drop policy if exists "versions - follow parent document: update" on public.document_versions;
drop policy if exists "versions - follow parent document: delete" on public.document_versions;

create policy "versions - follow parent document: select"
  on public.document_versions for select to authenticated
  using (exists (select 1 from public.documents d
                 where d.id = document_id
                   and (d.user_id = auth.uid() or public.is_admin())));

create policy "versions - follow parent document: insert"
  on public.document_versions for insert to authenticated
  with check (exists (select 1 from public.documents d
                      where d.id = document_id
                        and (d.user_id = auth.uid() or public.is_admin())));

create policy "versions - follow parent document: update"
  on public.document_versions for update to authenticated
  using (exists (select 1 from public.documents d
                 where d.id = document_id
                   and (d.user_id = auth.uid() or public.is_admin())));

create policy "versions - follow parent document: delete"
  on public.document_versions for delete to authenticated
  using (exists (select 1 from public.documents d
                 where d.id = document_id
                   and (d.user_id = auth.uid() or public.is_admin())));

-- ---------------------------------------------------------------------------
-- 6) Storage policies — let admins read and clean up every user's files
--
-- `storage.objects` is owned by `supabase_storage_admin`. On some projects the
-- SQL Editor role can't alter it and this section alone fails with:
--
--     ERROR: 42501: must be owner of table objects
--
-- Everything above is already committed at that point, so the app still works;
-- only cross-user admin file access is missing. If you hit it, add the three
-- policies through the dashboard instead: Storage -> Policies -> documents ->
-- New policy -> "For full customization", pasting the expressions below.
-- ---------------------------------------------------------------------------
drop policy if exists "own files - read" on storage.objects;
drop policy if exists "own files - insert" on storage.objects;
drop policy if exists "own files - delete" on storage.objects;
drop policy if exists "documents bucket - own or admin: read" on storage.objects;
drop policy if exists "documents bucket - own: insert" on storage.objects;
drop policy if exists "documents bucket - own or admin: delete" on storage.objects;

create policy "documents bucket - own or admin: read"
  on storage.objects for select to authenticated
  using (bucket_id = 'documents'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

create policy "documents bucket - own: insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'documents'
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy "documents bucket - own or admin: delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'documents'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
