-- ============================================================================
-- Ben Foods · Cert Checker — database schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- ============================================================================

-- 1) Documents table -----------------------------------------------------------
create type document_status as enum ('active', 'notified', 'escalated');

create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  name            text not null,
  file_path       text not null,          -- path inside the `documents` storage bucket
  file_type       text not null,
  file_size       bigint not null,
  expiry_date     date not null,
  marketing_email text not null,          -- Level 1 contact
  management_email text not null,         -- Level 2 (escalation) contact
  escalation_days integer not null default 7 check (escalation_days >= 0),
  status          document_status not null default 'active',
  notified_at     timestamptz,
  escalated_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index documents_user_id_idx on public.documents (user_id);
create index documents_status_idx on public.documents (status);
create index documents_expiry_idx on public.documents (expiry_date);

-- 2) Row Level Security --------------------------------------------------------
-- Each signed-in user can only see and manage their own documents.
-- The cron job uses the service-role key, which bypasses RLS.
alter table public.documents enable row level security;

create policy "own documents - select"
  on public.documents for select
  using (auth.uid() = user_id);

create policy "own documents - insert"
  on public.documents for insert
  with check (auth.uid() = user_id);

create policy "own documents - update"
  on public.documents for update
  using (auth.uid() = user_id);

create policy "own documents - delete"
  on public.documents for delete
  using (auth.uid() = user_id);

-- 3) Private storage bucket ----------------------------------------------------
-- File-size limit (10 MB) and allowed MIME types are enforced at the bucket
-- level, in addition to the checks in the upload Server Action.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  10485760, -- 10 MB
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Storage RLS: users may only touch files under a folder named after their uid.
-- Uploads use the path `<user_id>/<uuid>.<ext>`.
create policy "own files - read"
  on storage.objects for select
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own files - insert"
  on storage.objects for insert
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own files - delete"
  on storage.objects for delete
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================================
-- 4) OPTIONAL — schedule the cron job from inside Supabase (pg_cron + pg_net)
--    Skip this block if you use Vercel Cron instead (see vercel.json / README).
--    Runs the reminder job every day at 08:00 UTC.
-- ============================================================================
--
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule(
--   'daily-cert-check',
--   '0 8 * * *',
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
