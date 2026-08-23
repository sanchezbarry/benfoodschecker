-- ============================================================================
-- Migration 005 — an advance reminder, sent BEFORE a certificate expires
--
-- Run this in the Supabase SQL Editor. Safe to run more than once.
--
-- The workflow gains a level in front of the existing two:
--
--   Level 0  reminder_days_before the expiry date  -> marketing contact
--   Level 1  on the expiry date                    -> marketing contact
--   Level 2  escalation_days after expiry          -> senior management
--
-- Level 0 is tracked with its own timestamp rather than a new `status` value.
-- The status enum drives the expire/escalate handover, and the advance reminder
-- is orthogonal to it: a certificate stays 'active' after being reminded, so
-- Level 1 still fires on the day. A nullable `reminded_at` keeps the job
-- idempotent without disturbing that.
-- ============================================================================

alter table public.documents
  add column if not exists reminder_days_before integer not null default 30,
  add column if not exists reminded_at timestamptz;

-- 0 disables the advance reminder for a certificate; the other two levels are
-- unaffected and still fire.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'documents_reminder_days_before_check'
  ) then
    alter table public.documents
      add constraint documents_reminder_days_before_check
      check (reminder_days_before >= 0);
  end if;
end $$;

-- Anything already expired or notified should not now receive a "coming up
-- soon" email for a date in the past, so mark those as already reminded.
update public.documents
set reminded_at = coalesce(notified_at, now())
where reminded_at is null
  and (status <> 'active' or expiry_date <= now());
