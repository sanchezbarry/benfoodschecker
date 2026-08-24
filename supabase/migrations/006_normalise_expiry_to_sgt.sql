-- ============================================================================
-- Migration 006 — pin every expiry to Singapore midnight
--
-- An expiry is a calendar date, not a moment in time, so it must read the same
-- wherever it is rendered. The date picker stored the *visitor's* midnight,
-- which for a Singapore user is 16:00Z the previous day. The dashboard then
-- printed that in the browser's timezone (Singapore) and the reminder email
-- printed the same instant on the server (UTC) — so one certificate showed
-- "Aug 23" in the app and "Aug 22" in its own reminder.
--
-- The app now stores and renders every certificate date against Asia/Singapore
-- (APP_TIME_ZONE / APP_UTC_OFFSET in lib/constants.ts). Singapore observes no
-- daylight saving, so +08:00 is constant and this can never drift.
--
-- This rewrites existing rows to Singapore midnight of the date they already
-- represent in Singapore, so no certificate changes the day it falls on.
--
-- Already applied to the live database via the service-role client; kept here
-- so a rebuilt environment ends up in the same state. Safe to re-run.
-- ============================================================================

update public.documents
set expiry_date =
      (((expiry_date at time zone 'Asia/Singapore')::date)::timestamp
        at time zone 'Asia/Singapore')
where expiry_date <>
      (((expiry_date at time zone 'Asia/Singapore')::date)::timestamp
        at time zone 'Asia/Singapore');

update public.document_versions
set expiry_date =
      (((expiry_date at time zone 'Asia/Singapore')::date)::timestamp
        at time zone 'Asia/Singapore')
where expiry_date <>
      (((expiry_date at time zone 'Asia/Singapore')::date)::timestamp
        at time zone 'Asia/Singapore');
