-- ============================================================================
-- Migration 003 — raise the documents bucket size limit to 25 MB
--
-- Real certificates turned out to include multi-page scan bundles of 11 MB and
-- 17 MB, which the original 10 MB limit rejected outright. Uploads now go
-- straight from the browser to Supabase Storage, so neither the Server Action's
-- 1 MB body limit nor Vercel's 4.5 MB function limit is in play — the bucket's
-- own limit is the only ceiling.
--
-- Keep this in sync with MAX_FILE_SIZE in lib/constants.ts.
-- ============================================================================

update storage.buckets
set file_size_limit = 26214400 -- 25 MB
where id = 'documents';
