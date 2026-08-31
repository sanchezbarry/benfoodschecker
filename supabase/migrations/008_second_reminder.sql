-- ============================================================================
-- Migration 008 — a second advance reminder before expiry
--
-- Run this in the Supabase SQL Editor. Safe to run more than once.
--
-- One heads-up before expiry was not enough lead time: a certificate that needs
-- a vendor to re-audit is chased once and then goes quiet until the day it
-- lapses. The workflow now warns twice while the certificate is still valid:
--
--   Level 1  reminder_days_before        (default 60)  -> marketing contact
--   Level 2  second_reminder_days_before (default 30)  -> marketing contact
--   Level 3  on the expiry date                        -> marketing contact
--   Level 4  escalation_days after expiry (default 7)  -> senior management
--
-- The existing `reminder_days_before` / `reminded_at` pair becomes Level 1 and
-- keeps its name — renaming it would break every deployed build the moment this
-- ran, for a column whose meaning has not changed. Level 2 is the new pair.
--
-- Like Level 1, Level 2 does not advance `status`: both are orthogonal to the
-- expire/escalate handover, and their nullable timestamps are what keep the job
-- idempotent.
-- ============================================================================

-- New certificates lead with 60 days; the second reminder's own default is on
-- the column below.
alter table public.documents
  alter column reminder_days_before set default 60;

-- The add and its one-time backfill are guarded together, so re-running this
-- file cannot re-stamp reminders that have since been re-armed by an edit or a
-- new version.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'documents'
      and column_name = 'second_reminder_days_before'
  ) then
    alter table public.documents
      add column second_reminder_days_before integer not null default 30,
      add column second_reminded_at timestamptz;

    -- ---- One-time backfill for certificates already on file -------------
    --
    -- Two rules, so nobody's settings are quietly rewritten and nobody's inbox
    -- is flooded on the day this runs:
    --
    --   1. The reminder a certificate already has is KEPT — same lead time,
    --      same fired-or-not state. A lead time of 60+ days is already the
    --      early warning, so it stays as Level 1 and Level 2 takes the new
    --      30-day default. A shorter one is the near warning, so it slides
    --      down to Level 2 (carrying `reminded_at` with it) and Level 1 takes
    --      60 days. 0 means the user switched advance reminders off: both
    --      levels stay off.
    --
    --   2. The level being ADDED is stamped as already sent when its window is
    --      already open, so it never fires retroactively — a certificate 20
    --      days from expiry must not suddenly receive a "expires in 20 days"
    --      email that is really an artefact of this migration. The level being
    --      kept is untouched, so a reminder that was legitimately about to fire
    --      still fires.
    update public.documents
    set
      reminder_days_before = case
        when reminder_days_before = 0   then 0
        when reminder_days_before >= 60 then reminder_days_before
        else 60
      end,
      second_reminder_days_before = case
        when reminder_days_before = 0   then 0
        when reminder_days_before >= 60 then 30
        else reminder_days_before
      end,
      reminded_at = case
        -- Level 1 kept as-is.
        when reminder_days_before = 0 or reminder_days_before >= 60
          then reminded_at
        -- Level 1 is the added one: suppress it if its window is already open.
        when now() >= expiry_date - interval '60 days'
          then coalesce(reminded_at, now())
        else null
      end,
      second_reminded_at = case
        when reminder_days_before = 0 then null
        -- Level 2 inherited the old reminder, fired-state and all.
        when reminder_days_before < 60 then reminded_at
        -- Level 2 is the added one: suppress it if its window is already open.
        when now() >= expiry_date - interval '30 days' then now()
        else null
      end;
  end if;
end $$;

-- 0 disables the second reminder for a certificate; every other level is
-- unaffected and still fires.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'documents_second_reminder_days_before_check'
  ) then
    alter table public.documents
      add constraint documents_second_reminder_days_before_check
      check (second_reminder_days_before >= 0);
  end if;
end $$;
