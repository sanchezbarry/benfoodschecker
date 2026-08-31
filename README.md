# Ben Foods · Cert Checker

Track certificate **expiry dates** per vendor/customer and send **automated,
escalating email reminders**.

- **Auth** — Supabase Auth (email + password). **No public sign-up**: an admin
  creates every account.
- **Folders** — each certificate is filed under a **vendor / customer** folder
  (code + name, e.g. `FL001 — Fresh Life Pte Ltd`)
- **Versions** — upload a new version of a certificate and it **replaces** the
  file it supersedes, which is deleted. Only the newest version's expiry date is
  tracked.
- **Edit** — fix the vendor code, vendor name or expiry date typed at upload,
  without deleting the certificate and losing its history. Admins can do it on
  anyone's behalf.
- **Upload** — PDFs or images, sent **straight from the browser** to a private
  Supabase Storage bucket via a signed upload URL, restricted to
  PDF/PNG/JPG/WEBP and capped at **25 MB** once stored
- **Compression** — photos and large scanned PDFs are re-rendered in the browser
  before upload, typically shedding 70–90% of the bytes
- **CSV export** — download the register (vendors, PICs, certificate types,
  expiry dates and more) as a spreadsheet, scoped by the same RLS as the list
- **Four-level reminders**
  1. **60 days before expiry** (default), while the certificate is still valid →
     email the **marketing contact**
  2. **30 days before expiry** (default) → email the **marketing contact** again
  3. **On expiry** → email the **marketing contact**
  4. **7 days later** (default), if the certificate still hasn't been renewed →
     escalate to **senior management**

  Every lead time is prefilled with the default above and editable per
  certificate; 0 switches either advance reminder off.
- **Admin console** — manage users, passwords, and folders; fire any reminder
  level on demand
- **Email** — [Resend](https://resend.com), or any SMTP mailbox
- **Scheduling** — a secret-protected cron endpoint, driven by **Vercel Cron** or
  **Supabase `pg_cron`**

Built with Next.js 16 (App Router), React 19, Tailwind v4, and hand-authored
shadcn/ui components.

### Dates and time

Every certificate date is entered, stored and displayed against **Asia/Singapore**
(`APP_TIME_ZONE` / `APP_UTC_OFFSET` in [`lib/constants.ts`](lib/constants.ts)).
Singapore observes no daylight saving, so the offset is a constant `+08:00` and
the two values cannot drift apart.

This matters because an expiry is a *calendar date*, not a moment in time, so it
has to read the same wherever it is rendered. Storing the visitor's midnight did
not achieve that: picked in Singapore, "23 Aug" was stored as `2026-08-22T16:00Z`,
which the browser printed as 23 Aug and the Vercel server — rendering the very
same certificate's reminder email — printed as 22 Aug.

So `DateInput` pins the picked date to `+08:00`, and `formatDate`,
`formatDateTime` and `daysUntil` all read back in `APP_TIME_ZONE` rather than the
ambient zone. `formatDate` and `daysUntil` have to agree on the calendar or a row
can read "Expires Aug 23 · Expired 1d ago" around midnight.

### Theme

Light theme, styled to the Ben Foods identity. The palette in
[`app/globals.css`](app/globals.css) is taken from benfoods.com — the brand green
`#1f9a3a`, the deep green `#00672a`, the red `#c72031` and the orange `#f4792d` —
and the wordmark is served from [`public/benfoods-logo.png`](public/benfoods-logo.png).

The browser icons are the logo's triangle-and-B mark with the wordmark cropped
away: `app/favicon.ico` (16/32/48), `app/icon.png` (512) and `app/apple-icon.png`
(180, flattened onto white since iOS home screens have no alpha).

Two green tokens, because one can't do both jobs:

| Token | Value | Used for |
| --- | --- | --- |
| `--brand` | `#1f9a3a` exactly as published | decoration only — the accent rule at the top of every page |
| `--primary` | the same hue darkened to `oklch(0.491 …)` | anything carrying text: buttons, links, success messages, badges |

At its published lightness the brand green gives white button text only 3.7:1,
which fails WCAG AA. The darkened value clears 4.5:1 in all three places it's
used — as a button background, as text on the page, and as badge text on its own
15% tint. `--destructive` and `--warning` are tuned the same way; the emails in
[`lib/email.ts`](lib/email.ts) mirror these as plain hex, since mail clients
don't understand `oklch()`.

---

## Architecture

```
Browser ──► Next.js (App Router)
             ├─ /login            Supabase Auth (sign-in only)
             ├─ /dashboard        file certs, upload versions, list (RLS-scoped)
             │     └─ Server Actions ──► Supabase Postgres + Storage
             ├─ /admin            users · folders · notification tests
             │     └─ Server Actions ──► Supabase Auth Admin API + Postgres
             ├─ /api/export/certificates   CSV of the register (RLS-scoped)
             └─ /api/cron/check-expiries   ◄── Vercel Cron or pg_cron (daily)
                     │  service-role client → lib/reminders.ts
                     └─ Resend → marketing (L1-L3) / management (L4) emails
```

The reminder logic lives in [`lib/reminders.ts`](lib/reminders.ts) so the cron
endpoint and the admin console's "Run reminder job" button run the exact same
code.

### Data model

| Table | Holds |
| --- | --- |
| `folders` | one row per vendor / customer — `code` (unique, case-insensitive) + `name` |
| `documents` | one row per certificate; its file and `expiry_date` **mirror the current version** |
| `document_versions` | every upload for a certificate; exactly one row is `is_current` (a new version deletes the one it replaces, so this is normally a single row plus history from before that change) |

Reminder state lives in `documents.status` (`active → notified → escalated`)
plus two nullable timestamps, `reminded_at` and `second_reminded_at`, for the
two advance reminders. Because each email is tied to a status transition or to
stamping one of those timestamps, the job is **idempotent** — running it
repeatedly never double-sends. Uploading a new version resets the
status to `active`, which re-arms the workflow against the new expiry date — and
so does correcting the expiry from the **Edit** panel.

### Roles

Three roles, stored in `app_metadata.role` on the auth user — writable only by
the service-role key, so nobody can promote themselves. An admin sets them from
the role selector in `/admin`.

| Role | Sees | Can change | Reaches `/admin` |
| --- | --- | --- | --- |
| `admin` | every certificate | everything | yes |
| `department` | every certificate | **nothing** | no |
| `user` (default) | only its own | only its own | no |

`department` is the view-and-download account — for a team that needs oversight
of every vendor's compliance without touching the records. `marketing@benfoods.com`
is the first of these; the admin console prompts to create it if it doesn't exist.

Read access widens for `department`; write access deliberately does not. Note
that "owns nothing, so can't write anything" is **not** sufficient on its own —
without an explicit `can_write()` on the insert policies a department user could
create a row with their own uid as `user_id` and become its owner. So each write
policy carries that check, and each write Server Action re-derives the same
capability from the session. Hiding a form is never the boundary: a Server Action
is a reachable POST endpoint whether or not any UI calls it.

The dropdown hints on the certificate form (vendor codes and names, certificate
types, contact emails) are drawn from what the **whole company** has already
entered, so everyone reuses the same vocabulary. Only distinct values are read —
never other people's certificate rows.

### Permanent admins

`tester@test.com` and `mis-help@benfoods.com` are admins no matter what their
metadata says, so the console can never be locked out. They're listed in two
places that must stay in sync:

- [`BOOTSTRAP_ADMIN_EMAILS`](lib/auth.ts) — the app
- `public.app_role()` in [`supabase/schema.sql`](supabase/schema.sql) — row level
  security

Their role selector is disabled in the console, and an admin cannot demote
themselves — that would lock them out on the next page load.

---

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run:
   - a fresh project → [`supabase/schema.sql`](supabase/schema.sql)
   - an existing database → the numbered files in
     [`supabase/migrations/`](supabase/migrations) in order. `002` is the big one
     (folders + versioning); `003` raises the bucket size limit; `004` adds the
     `department` role; `005` adds the advance reminder; `006` pins every stored
     expiry to Singapore midnight; `007` lets a user rename a vendor folder that
     holds only their own certificates; `008` adds the second advance reminder
     and moves the first to 60 days. `002` specifically applies to a v1
     database (a
     `documents` table with a `name` column and no folders).
     It backfills every existing certificate into an `UNSORTED` folder, turns its
     old `name` into the certificate type, and seeds version 1 of each file.
     Every step is guarded, so it is safe to re-run and safe to execute a
     section at a time. Run the sections **in order** — section 4 reads columns
     that section 3 adds.
3. **Authentication → Providers → Email**: keep Email enabled. Admin-created
   accounts are confirmed automatically, so the "Confirm email" setting doesn't
   affect them.
4. Grab your keys from **Project Settings → API**: the project URL, the `anon`
   public key, and the `service_role` secret key.

### 2. Email

Two transports. **SMTP wins whenever `SMTP_HOST` is set**; otherwise Resend is
used. `/admin` shows which one is live, so a failed send is easy to place.

Whichever you pick, the constraint is the same: no provider will send to
arbitrary recipients until you have proved you control the sending identity.
That is anti-spam, not a quirk — but proving it does not have to mean DNS.

**Resend (default).** Sign up at [resend.com](https://resend.com) and create an
API key. The shared sender `onboarding@resend.dev` works immediately but
**delivers only to the address the Resend account was registered with** — fine
for testing, useless for reminding a real contact. Verifying a domain lifts that
and gives the best deliverability, but needs DNS access.

**SMTP.** Any mailbox that speaks SMTP will send to anyone once authenticated,
with no DNS changes:

| Provider | Host | Port | Notes |
| --- | --- | --- | --- |
| Google Workspace / Gmail | `smtp.gmail.com` | 587 | needs 2-Step Verification, then an App Password; some admins disable these |
| Microsoft 365 | `smtp.office365.com` | 587 | |
| Brevo | `smtp-relay.brevo.com` | 587 | verify one sender address, no DNS |
| SendGrid | `smtp.sendgrid.net` | 587 | username is the literal `apikey` |

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and point `EMAIL_FROM`
at an address the mailbox may send as.

### Routing everything to one inbox

`EMAIL_REDIRECT_TO` sends every reminder to a single address instead of each
certificate's real contacts, naming the intended recipient in the subject and in
a banner at the top of the body. Useful for a demo, or while contacts are still
placeholders.

It is **not** a way round the sending restriction: the redirect only changes who
the message is addressed to, and the transport still has to be allowed to reach
that address. On Resend's shared sender the only value that works is the Resend
account's own address; any other makes every send fail. With SMTP configured,
any address works.

### 3. Environment variables

```bash
cp .env.local.example .env.local
```

Fill in every value (see the comments in the file):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `EMAIL_FROM`, `CRON_SECRET` (any long random
string), `NEXT_PUBLIC_APP_URL`, and either `RESEND_API_KEY` or the `SMTP_*`
group. `NEXT_PUBLIC_APP_URL` must be absolute and publicly reachable — email
clients cannot resolve `localhost`, so a local value there means a broken logo
and a dead button in anything you send from your machine.

### 4. Run

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

### 5. Create the first accounts

Because sign-up is closed, the very first account has to be made in Supabase:
**Authentication → Users → Add user**, email `tester@test.com`, with
*Auto Confirm User* ticked. Sign in with it, then open **/admin** — the console
will point out that `mis-help@benfoods.com` has no account yet and pre-fill the
form. Everyone else is created from there too.

---

## Using it

### Uploads

Certificates never pass through Next.js. The browser asks a Server Action for a
short-lived signed upload URL, sends the file directly to Supabase Storage, then
submits only the resulting path. Two limits make that necessary rather than
merely tidy: Server Action request bodies default to **1 MB**, and Vercel caps
function request bodies at **4.5 MB** regardless of `serverActions.bodySizeLimit`
— both below the 10 MB this app allows.

The path is minted server-side from the session (`<user_id>/<uuid>.<ext>`, the
extension derived from the MIME type, never the filename), and re-validated when
it comes back: [`app/dashboard/actions.ts`](app/dashboard/actions.ts) confirms it
sits in the caller's own folder and re-reads the object's true size and type from
storage, which is also where the `file_size` / `file_type` columns come from.

Before uploading, [`lib/compress.ts`](lib/compress.ts) downscales images to
2000px on the longest edge and re-encodes them as WEBP at quality 0.82 — a
3000×2000 scan measured at an 86% reduction. It honours EXIF orientation, flattens
transparency onto white, and keeps the original whenever re-encoding would not
actually be smaller or the browser cannot decode the file.

**PDFs over 3 MB** are re-rendered page by page at 150dpi and re-encoded as
JPEG, using `pdfjs-dist` to rasterise and `pdf-lib` to rebuild. Both are imported
lazily, so neither reaches the bundle unless someone actually picks a big PDF.

The threshold exists because rasterising flattens the document — any selectable
text is lost. A sample of nine real certificates showed the split cleanly:

| | Size | Character |
| --- | --- | --- |
| 4 files | 0.12–0.31 MB | born-digital; embedded images are only logos and QR codes |
| 3 files | 0.40–2.06 MB | single-page scans, one at a needless 600dpi |
| 2 files | 11.4 / 17.5 MB | 13- and 14-page scan bundles at up to 768dpi |

So below 3 MB nothing is worth flattening, and above it the file is a scan with
no text layer to lose. Measured on those samples: **17.46 MB → 3.94 MB (77%) in
1.7s**, and 11.41 MB → 3.65 MB (68%). The rebuilt PDF keeps its page count and
original page dimensions, so it still prints to scale. If rasterising saves less
than 20%, the original is kept instead.

| Constant | Meaning |
| --- | --- |
| `MAX_FILE_SIZE` (25 MB) | what may finally land in the bucket, after compression |
| `MAX_UPLOAD_INPUT_SIZE` (40 MB) | what a user may pick — a big photo is fine, it gets downscaled |
| `PDF_COMPRESS_THRESHOLD` (3 MB) | PDFs below this keep their text layer, untouched |

25 MB rather than 10: the two real scan bundles above exceeded a 10 MB cap and
were rejected outright. Because uploads bypass the Server Action entirely,
Vercel's 4.5 MB limit is not a factor and the bucket limit is the only ceiling —
keep `MAX_FILE_SIZE` in sync with `storage.buckets.file_size_limit`
(see [`supabase/migrations/003_raise_bucket_size_limit.sql`](supabase/migrations/003_raise_bucket_size_limit.sql)).

### Finding and managing things (`/dashboard`)

The certificate list is grouped by vendor folder with a **search box** that
filters on vendor code or name. The query is tokenised, so "fresh life" matches
"Fresh Life Pte Ltd" and "FL001 fresh" matches too.

**Export CSV** downloads the register as a spreadsheet — vendor code and name,
PIC, certificate type, expiry, days to expiry, status, both contacts, the
reminder schedule and the upload date, one row per certificate, ordered by
expiry. It is a plain link to
[`app/api/export/certificates/route.ts`](app/api/export/certificates/route.ts),
so the browser downloads it directly and it works with JavaScript off.

Who gets which rows is **RLS, not a check in the route**: the query runs on the
caller's own session client, so a standard user's file holds their own
certificates and an admin's or department account's holds everybody's — the
same rows the dashboard shows them. Searching first narrows the download too:
the search box's text travels as `?q=`, and the server re-runs the same matcher
the list uses, so nothing the browser is holding decides what lands in the file.

Three details the file depends on: it opens with a UTF-8 BOM (without it Excel
on Windows mangles non-ASCII vendor names), rows end with CRLF per RFC 4180, and
any cell starting `=`, `+`, `-` or `@` is prefixed with an apostrophe so a
certificate type someone typed as `=ISO 22000` cannot execute as a formula on
whoever opens the report — while a negative "days to expiry" stays a number.

Everyone, including view-only department accounts, can **change their own
password** from the bottom of the dashboard. The current password is required —
Supabase would otherwise let a live session set a new one without it, which
would let anyone who found a signed-in browser lock the real owner out.

### Filing a certificate (`/dashboard`)

| Field | Notes |
| --- | --- |
| Vendor / customer code | free text with a dropdown of existing codes; a new code creates the folder |
| Vendor / customer name | free text with a dropdown; picking either code or name fills in the other |
| PIC | read-only, taken from your account's name |
| Certificate type | free text with a dropdown of types already in use (`SUPPLIER FORM`, `ISO 22000`, …) |
| Expiry date | whole days — stored as 00:00 Singapore time; the reminder job watches this |
| First reminder (days before expiry) | Level 1 heads-up while the certificate is still valid — prefilled 60; 0 disables it |
| Second reminder (days before expiry) | Level 2 follow-up, nearer the date — prefilled 30, and must be fewer days than the first; 0 disables it |
| File, contacts, escalation window | PDF/image, the two email recipients, and the grace period (prefilled 7 days) |

Typing a code that already exists files the certificate into that folder and
keeps the folder's stored name. Filing never renames a vendor: a name typed
absent-mindedly next to a familiar code must not rewrite that vendor on
everybody else's certificates. Renaming is a deliberate act, so it lives in
**Edit**.

### Editing a certificate (`/dashboard`)

Every certificate row has an **Edit** panel for correcting what was typed when
it was filed — vendor code, vendor name, expiry date and the reminder schedule —
so a mistake no longer means deleting the certificate and losing its history. Owners edit their
own; admins edit anyone's, from the same list. Department accounts see no Edit
button, and the Server Action refuses them anyway.

| Field | What editing it does |
| --- | --- |
| Vendor / customer code | decides which folder the certificate is filed under — an existing code **moves** it there, a new code creates the folder |
| Vendor / customer name | **renames** the vendor, if the folder holds none of anyone else's certificates; otherwise the stored name stands and the reply says so |
| Expiry date | written to the certificate **and** to its current version, which the certificate mirrors |
| First / second reminder, escalation window | retunes the schedule without waiting for the next renewal. Changing a lead time never un-sends: a reminder already sent stays sent, and one still pending fires against the new window |

The file, the PIC and the owner are deliberately out of scope: replacing the
file is what a new version is for, and an admin editing on someone's behalf
never becomes the owner.

A folder is shared, so renaming it rewrites the vendor shown on every
certificate inside — which is why it was admin-only. That reasoning stops
applying when the folder holds nothing but the caller's own certificates, and
that is exactly the case someone hits after mistyping a vendor name while
creating the folder from the upload form. The rule is enforced in the database
by `public.owns_folder_contents()`, which is `security definer` on purpose: a
policy expression is part of the query it guards, so a plain sub-select on
`documents` would be filtered by that table's own RLS, other people's
certificates would be invisible, and one certificate in a shared folder would be
enough to rename it for everybody.

Changing the expiry re-arms all four reminder levels (`status` back to
`active`, the four timestamps cleared), so a certificate that was chased — or
escalated — against the wrong day is reconsidered against the right one. An
unchanged date leaves reminder state alone, so fixing a vendor typo never
re-sends an email.

### New versions

**Upload a new version** takes the certificate, the new file, its new expiry, and
the reminder schedule — prefilled from the certificate, so submitting it
unchanged keeps the schedule it already had.

The new version becomes the tracked one: its expiry is mirrored onto the
certificate and reminder state resets to `active`. **The version it replaces is
deleted**, row and stored file both, once the new one is safely in place.

Keeping the old file used to be a per-upload choice ("retain" or "delete"). It
is now the single behaviour: a renewed certificate supersedes its predecessor
outright, and the retained copies only accumulated storage. The code for the
choice is commented out rather than deleted — search for `RETAIN (removed)` in
[`app/dashboard/actions.ts`](app/dashboard/actions.ts) and
[`app/dashboard/new-version-form.tsx`](app/dashboard/new-version-form.tsx) —
and nothing was dropped from the schema, so versions uploaded before the change
are still on file and still listed under a certificate's version history.

### Admin console (`/admin`)

- **Users** — create accounts, change name / email / password, grant or revoke
  admin. Deleting a user also deletes their certificates and stored files. You
  can't delete yourself or either permanent admin.
- **Vendor / customer folders** — create, rename, delete. A folder that still
  holds certificates can't be deleted; refile or delete them first. Admins are
  the only ones who can rename a folder shared between several people's
  certificates, or delete an empty one.
- **Notification tests** — send any level's email to any address you type in
  (the advance-reminder form picks Level 1 or Level 2; escalation takes a "to"
  and an optional "cc"). Test emails
  are badged as tests and change nothing in the database. A separate **Run
  reminder job** button runs the real daily job early — that one does email real
  contacts and advance statuses.

---

## Scheduling the reminder job

The endpoint is [`app/api/cron/check-expiries/route.ts`](app/api/cron/check-expiries/route.ts),
protected by `CRON_SECRET` (sent as `Authorization: Bearer <secret>` or
`?secret=<secret>`).

**Test it manually:**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/check-expiries
# → {"ok":true,"remindedFirst":2,"remindedSecond":1,"notified":1,"escalated":0,"errors":[]}
```

**Option A — Vercel Cron (recommended if deploying to Vercel).**
[`vercel.json`](vercel.json) already schedules it daily at 01:00 UTC, which is
09:00 in Singapore — reminders land at the start of the working day. Add
`CRON_SECRET` in your Vercel project's env vars — Vercel automatically sends it
as the Bearer token.

**Option B — Supabase `pg_cron` + `pg_net`.**
Uncomment and edit the final block in [`supabase/schema.sql`](supabase/schema.sql)
(set your deployed URL and `CRON_SECRET`), then run it.

> Hobby-tier schedulers typically run at most once per day, which is exactly what
> this workflow needs.

---

## How the four levels work

| # | Trigger condition | Action | State change |
| --- | --- | --- | --- |
| 1 | `now >= expiry_date - reminder_days_before`, still valid, `reminded_at` null | email **marketing contact** | stamps `reminded_at` |
| 2 | `now >= expiry_date - second_reminder_days_before`, still valid, `second_reminded_at` null | email **marketing contact** | stamps `second_reminded_at` |
| 3 | `expiry_date <= now` and status `active` | email **marketing contact** | status → `notified` |
| 4 | `now >= expiry_date + escalation_days` and status `notified` | email **senior management** (cc marketing) | status → `escalated` |

Levels 1 and 2 deliberately do **not** advance `status`. The status enum drives
the expire/escalate handover, and the advance reminders are orthogonal to it — a
certificate stays `active` after being reminded so Level 3 still fires on the
day. The two nullable timestamps keep the job idempotent without disturbing
that. Setting either lead time to 0 disables that reminder for that certificate;
every other level still fires.

**At most one advance reminder per certificate per run**, and it is the nearest
one that is due. Both windows are open at once whenever a certificate is filed
late — inside its own lead times — or when the job misses a day, and two
near-identical emails in one morning read as a bug. When Level 2 goes out with
Level 1 still unsent, Level 1 is stamped alongside it: its moment has passed,
and sending it the next day would say less than what just went out.

`expiry_date` is always the current version's, so an older file left over from
before versions were auto-deleted never triggers stale reminders. Uploading a
new version clears all four markers, so both advance reminders fire again
against the new date.

## Security notes

- The `service_role` key is only imported by server-side modules (the reminder
  job, the admin console, and the suggestion lookup) and never reaches the
  browser.
- Certificate reads/writes are constrained by Postgres **RLS** and Storage
  policies: `auth.uid() = user_id`, widened to everything for `public.is_admin()`.
- Every admin Server Action re-derives the caller's admin status from the
  session. Nothing about who the caller is comes from the form.
- The one policy that has to see rows the caller cannot goes through a
  `security definer` function (`public.owns_folder_contents`) rather than an
  inline sub-select, which RLS would have quietly filtered — see
  [Editing a certificate](#editing-a-certificate-dashboard).
- There is no sign-up Server Action at all — a Server Action is a reachable POST
  endpoint whether or not any UI calls it, so closing self-registration means
  deleting the action, not hiding a button.
- File downloads use short-lived (60s) **signed URLs** — the bucket is private.
