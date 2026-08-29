-- ============================================================================
-- Ben Foods · Cert Checker — database schema (v2)
--
-- FRESH INSTALL: run this whole file in the Supabase SQL Editor.
-- UPGRADING from v1 (a `documents` table with `name`, no folders): run
-- `supabase/migrations/002_folders_versions_admin.sql` instead.
--
-- Model
--   folders            one row per vendor/customer (code + name)
--   documents          one row per certificate, always inside a folder;
--                      mirrors the CURRENT version's file + expiry date
--   document_versions  full upload history for a certificate
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Roles
-- ---------------------------------------------------------------------------
-- Source of truth is `app_metadata.role` on the auth user, stamped by the admin
-- console through the service-role key (users cannot set it themselves):
--
--   admin       everything: sees all certificates, manages users and folders
--   department  read-only:  sees all certificates, may download, changes nothing
--   user        the default: sees and manages only its own certificates
--
-- The email list is a bootstrap fallback so the two named accounts are admins
-- from the very first login, before any metadata exists.
--
-- Keep the list in sync with BOOTSTRAP_ADMIN_EMAILS in lib/auth.ts.
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
-- 1) Folders — one per vendor / customer
-- ---------------------------------------------------------------------------
create table public.folders (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,          -- e.g. FL001
  name       text not null,          -- e.g. Fresh Life Pte Ltd
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint folders_code_not_blank check (length(btrim(code)) > 0),
  constraint folders_name_not_blank check (length(btrim(name)) > 0)
);

-- Vendor codes are unique regardless of casing, so "fl001" can't shadow "FL001".
create unique index folders_code_unique on public.folders (upper(code));

-- ---------------------------------------------------------------------------
-- 2) Documents — one per certificate
-- ---------------------------------------------------------------------------
create type document_status as enum ('active', 'notified', 'escalated');

create table public.documents (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  folder_id        uuid not null references public.folders (id) on delete restrict,
  cert_type        text not null,        -- free text, e.g. "ISO 22000"
  pic_name         text not null,        -- person in charge, captured at creation
  file_path        text not null,        -- current version's path in the bucket
  file_type        text not null,
  file_size        bigint not null,
  expiry_date      timestamptz not null, -- ALWAYS the current version's expiry,
                                         -- stored as 00:00 Asia/Singapore
  marketing_email  text not null,        -- Level 0 + Level 1 contact
  management_email text not null,        -- Level 2 (escalation) contact
  -- Days before expiry for the advance reminder. 0 disables it.
  reminder_days_before integer not null default 30 check (reminder_days_before >= 0),
  escalation_days  integer not null default 7 check (escalation_days >= 0),
  status           document_status not null default 'active',
  reminded_at      timestamptz,          -- Level 0 sent (certificate stays 'active')
  notified_at      timestamptz,
  escalated_at     timestamptz,
  created_at       timestamptz not null default now()
);

create index documents_user_id_idx on public.documents (user_id);
create index documents_folder_id_idx on public.documents (folder_id);
create index documents_status_idx on public.documents (status);
create index documents_expiry_idx on public.documents (expiry_date);
create index documents_cert_type_idx on public.documents (cert_type);

-- ---------------------------------------------------------------------------
-- 3) Document versions — upload history
-- ---------------------------------------------------------------------------
-- Exactly one row per certificate carries `is_current`. That row's expiry_date
-- is mirrored onto documents.expiry_date and is the ONLY one the reminder job
-- looks at: retained older versions are history, never tracked for expiry.
create table public.document_versions (
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

create index document_versions_document_id_idx
  on public.document_versions (document_id);

create unique index document_versions_single_current
  on public.document_versions (document_id)
  where is_current;

-- ---------------------------------------------------------------------------
-- 4) Row Level Security
-- ---------------------------------------------------------------------------
-- Regular users see only their own certificates; admins see everything.
-- The cron job uses the service-role key, which bypasses RLS entirely.

alter table public.folders enable row level security;

-- Every signed-in user needs to read the vendor list to file a certificate,
-- and may add a vendor on the fly from the upload form. Renaming is admin-only
-- unless the folder holds only the caller's own certificates (see
-- owns_folder_contents below); deleting is always an admin operation.
create policy "folders - read for all signed-in users"
  on public.folders for select
  to authenticated
  using (true);

create policy "folders - any signed-in user may add"
  on public.folders for insert
  to authenticated
  with check (auth.uid() is not null and public.can_write());

-- "Is this folder entirely mine?" — the test that lets a user correct a vendor
-- name they mistyped while creating the folder from the upload form.
--
-- SECURITY DEFINER is load-bearing, not incidental. A policy expression is part
-- of the query it guards, so a plain sub-select on `documents` would itself be
-- filtered by that table's RLS: other people's certificates would be invisible,
-- `not exists (... someone else's ...)` would always hold, and one certificate
-- in a shared folder would be enough to rename it for everybody. Running as the
-- owner is what lets the check count the rows it is supposed to count.
--
-- An empty folder answers false, so tidying up unused folders stays admin-only.
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

-- Renaming a folder rewrites the vendor shown on every certificate inside it,
-- so it stays an admin job — except when the folder holds nothing but the
-- caller's own certificates, where there is nobody else to affect.
-- `folders_code_unique` still rejects a rename onto a code already in use.
create policy "folders - admin or sole owner may amend"
  on public.folders for update
  to authenticated
  using (public.is_admin() or public.owns_folder_contents(id))
  with check (public.is_admin() or public.owns_folder_contents(id));

create policy "folders - admins may delete"
  on public.folders for delete
  to authenticated
  using (public.is_admin());

alter table public.documents enable row level security;

-- Department users read everything but own nothing. Owning nothing is not by
-- itself enough to stop them writing — without can_write() they could insert a
-- row with their own uid as user_id and become its owner.
create policy "documents - own or view-all: select"
  on public.documents for select
  to authenticated
  using (auth.uid() = user_id or public.can_view_all());

create policy "documents - own: insert"
  on public.documents for insert
  to authenticated
  with check (auth.uid() = user_id and public.can_write());

create policy "documents - own or admin: update"
  on public.documents for update
  to authenticated
  using ((auth.uid() = user_id or public.is_admin()) and public.can_write())
  with check ((auth.uid() = user_id or public.is_admin()) and public.can_write());

create policy "documents - own or admin: delete"
  on public.documents for delete
  to authenticated
  using ((auth.uid() = user_id or public.is_admin()) and public.can_write());

alter table public.document_versions enable row level security;

-- Versions inherit the access rules of the certificate they belong to.
create policy "versions - follow parent document: select"
  on public.document_versions for select
  to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and (d.user_id = auth.uid() or public.can_view_all())
    )
  );

create policy "versions - follow parent document: insert"
  on public.document_versions for insert
  to authenticated
  with check (
    public.can_write() and exists (
      select 1 from public.documents d
      where d.id = document_id
        and (d.user_id = auth.uid() or public.is_admin())
    )
  );

create policy "versions - follow parent document: update"
  on public.document_versions for update
  to authenticated
  using (
    public.can_write() and exists (
      select 1 from public.documents d
      where d.id = document_id
        and (d.user_id = auth.uid() or public.is_admin())
    )
  );

create policy "versions - follow parent document: delete"
  on public.document_versions for delete
  to authenticated
  using (
    public.can_write() and exists (
      select 1 from public.documents d
      where d.id = document_id
        and (d.user_id = auth.uid() or public.is_admin())
    )
  );

-- ---------------------------------------------------------------------------
-- 5) Private storage bucket
-- ---------------------------------------------------------------------------
-- File-size limit and allowed MIME types are enforced at the bucket level, in
-- addition to the checks in the upload Server Action. Keep the limit in sync
-- with MAX_FILE_SIZE in lib/constants.ts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  26214400, -- 25 MB
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Files live under `<user_id>/<uuid>.<ext>`. Users may only touch their own
-- folder; admins can read (and clean up) everything.
create policy "documents bucket - own or view-all: read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.can_view_all())
  );

create policy "documents bucket - own: insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.can_write()
  );

create policy "documents bucket - own or admin: delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
    and public.can_write()
  );

-- ============================================================================
-- 6) OPTIONAL — schedule the reminder job from inside Supabase (pg_cron+pg_net)
--    Skip this block if you use Vercel Cron instead (see vercel.json / README).
--    Runs the reminder job every day at 08:00 UTC.
-- ============================================================================
--
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule(
--   'daily-cert-check',
--   '0 1 * * *',
--   $$
--   select net.http_post(
--     url     := 'https://YOUR-APP-DOMAIN/api/cron/check-expiries',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer YOUR_CRON_SECRET'
--     ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );
--
-- To remove it later:  select cron.unschedule('daily-cert-check');
