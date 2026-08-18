# Ben Foods · Cert Checker

Track certificate **expiry dates** per vendor/customer and send **automated,
escalating email reminders**.

- **Auth** — Supabase Auth (email + password). **No public sign-up**: an admin
  creates every account.
- **Folders** — each certificate is filed under a **vendor / customer** folder
  (code + name, e.g. `FL001 — Fresh Life Pte Ltd`)
- **Versions** — upload a new version of a certificate and choose to **retain**
  or **delete** the old one. Only the newest version's expiry date is tracked.
- **Upload** — PDFs or images to a private Supabase Storage bucket, size-limited
  to **10 MB** and restricted to PDF/PNG/JPG/WEBP
- **Two-level reminders**
  1. **On expiry** → email the **marketing contact**
  2. **N days later**, if the certificate still hasn't been renewed → escalate to
     **senior management**
- **Admin console** — manage users, passwords, and folders; fire either reminder
  level on demand
- **Email** — [Resend](https://resend.com)
- **Scheduling** — a secret-protected cron endpoint, driven by **Vercel Cron** or
  **Supabase `pg_cron`**

Built with Next.js 16 (App Router), React 19, Tailwind v4, and hand-authored
shadcn/ui components.

### Theme

Light theme, styled to the Ben Foods identity. The palette in
[`app/globals.css`](app/globals.css) is taken from benfoods.com — the brand green
`#1f9a3a`, the deep green `#00672a`, the red `#c72031` and the orange `#f4792d` —
and the wordmark is served from [`public/benfoods-logo.png`](public/benfoods-logo.png).

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
             └─ /api/cron/check-expiries   ◄── Vercel Cron or pg_cron (daily)
                     │  service-role client → lib/reminders.ts
                     └─ Resend → marketing (L1) / management (L2) emails
```

The reminder logic lives in [`lib/reminders.ts`](lib/reminders.ts) so the cron
endpoint and the admin console's "Run reminder job" button run the exact same
code.

### Data model

| Table | Holds |
| --- | --- |
| `folders` | one row per vendor / customer — `code` (unique, case-insensitive) + `name` |
| `documents` | one row per certificate; its file and `expiry_date` **mirror the current version** |
| `document_versions` | every upload for a certificate; exactly one row is `is_current` |

Reminder state lives in `documents.status` (`active → notified → escalated`).
Because each email is tied to a status transition, the job is **idempotent** —
running it repeatedly never double-sends. Uploading a new version resets the
status to `active`, which re-arms the workflow against the new expiry date.

### Who sees what

- A signed-in user sees **only their own certificates**.
- An **admin** sees everyone's, and can reach `/admin`.
- The dropdown hints on the certificate form (vendor codes and names,
  certificate types, contact emails) are drawn from what the **whole company**
  has already entered, so everyone reuses the same vocabulary. Only distinct
  values are read — never other people's certificate rows.

### Admins

`tester@test.com` and `mis-help@benfoods.com` are permanent administrators.
They're listed in two places that must stay in sync:

- [`BOOTSTRAP_ADMIN_EMAILS`](lib/auth.ts) — the app
- `public.is_admin()` in [`supabase/schema.sql`](supabase/schema.sql) — row level
  security

Beyond those two, admin rights are stored as `app_metadata.role = "admin"` on the
auth user, which only the service-role key can write — so nobody can promote
themselves. Toggle it with the **Administrator** checkbox in the admin console.

---

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run:
   - a fresh project → [`supabase/schema.sql`](supabase/schema.sql)
   - an existing v1 database (a `documents` table with a `name` column and no
     folders) → [`supabase/migrations/002_folders_versions_admin.sql`](supabase/migrations/002_folders_versions_admin.sql).
     It backfills every existing certificate into an `UNSORTED` folder, turns its
     old `name` into the certificate type, and seeds version 1 of each file. It
     runs in a transaction, so a failure leaves the database untouched.
3. **Authentication → Providers → Email**: keep Email enabled. Admin-created
   accounts are confirmed automatically, so the "Confirm email" setting doesn't
   affect them.
4. Grab your keys from **Project Settings → API**: the project URL, the `anon`
   public key, and the `service_role` secret key.

### 2. Resend

1. Sign up at [resend.com](https://resend.com) and create an **API key**.
2. Verify a sending domain, or use the sandbox sender `onboarding@resend.dev` for
   testing (it can only send to your own verified address).

### 3. Environment variables

```bash
cp .env.local.example .env.local
```

Fill in every value (see the comments in the file):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET` (any
long random string), `NEXT_PUBLIC_APP_URL`.

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

### Filing a certificate (`/dashboard`)

| Field | Notes |
| --- | --- |
| Vendor / customer code | free text with a dropdown of existing codes; a new code creates the folder |
| Vendor / customer name | free text with a dropdown; picking either code or name fills in the other |
| PIC | read-only, taken from your account's name |
| Certificate type | free text with a dropdown of types already in use (`SUPPLIER FORM`, `ISO 22000`, …) |
| Expiry date & time | what the reminder job watches |
| File, contacts, escalation window | PDF/image, the two email recipients, and the grace period |

Typing a code that already exists files the certificate into that folder and
keeps the folder's stored name — renaming a vendor is an admin action, so a typo
here can't rewrite it for everybody.

### New versions

**Upload a new version** takes the certificate, the new file, its new expiry, and
what to do with the previous version:

- **Retain it** — the old file stays in the certificate's history. Its expiry is
  kept for reference and is **never** reminded on.
- **Delete it** — every earlier version and its stored file are removed.

Either way, the new version becomes the tracked one: its expiry is mirrored onto
the certificate and reminder state resets to `active`.

### Admin console (`/admin`)

- **Users** — create accounts, change name / email / password, grant or revoke
  admin. Deleting a user also deletes their certificates and stored files. You
  can't delete yourself or either permanent admin.
- **Vendor / customer folders** — create, rename, delete. A folder that still
  holds certificates can't be deleted; refile or delete them first.
- **Notification tests** — send a Level 1 or Level 2 email to any address you
  type in (escalation takes a "to" and an optional "cc"). Test emails are badged
  as tests and change nothing in the database. A separate **Run reminder job**
  button runs the real daily job early — that one does email real contacts and
  advance statuses.

---

## Scheduling the reminder job

The endpoint is [`app/api/cron/check-expiries/route.ts`](app/api/cron/check-expiries/route.ts),
protected by `CRON_SECRET` (sent as `Authorization: Bearer <secret>` or
`?secret=<secret>`).

**Test it manually:**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/check-expiries
# → {"ok":true,"notified":1,"escalated":0,"errors":[]}
```

**Option A — Vercel Cron (recommended if deploying to Vercel).**
[`vercel.json`](vercel.json) already schedules it daily at 08:00 UTC. Add
`CRON_SECRET` in your Vercel project's env vars — Vercel automatically sends it
as the Bearer token.

**Option B — Supabase `pg_cron` + `pg_net`.**
Uncomment and edit the final block in [`supabase/schema.sql`](supabase/schema.sql)
(set your deployed URL and `CRON_SECRET`), then run it.

> Hobby-tier schedulers typically run at most once per day, which is exactly what
> this workflow needs.

---

## How the two levels work

| Trigger condition | Action | New status |
| --- | --- | --- |
| `expiry_date <= now` and status `active` | email **marketing contact** | `notified` |
| `now >= expiry_date + escalation_days` and status `notified` | email **senior management** (cc marketing) | `escalated` |

`expiry_date` is always the current version's, so retaining old versions never
triggers stale reminders.

## Security notes

- The `service_role` key is only imported by server-side modules (the reminder
  job, the admin console, and the suggestion lookup) and never reaches the
  browser.
- Certificate reads/writes are constrained by Postgres **RLS** and Storage
  policies: `auth.uid() = user_id`, widened to everything for `public.is_admin()`.
- Every admin Server Action re-derives the caller's admin status from the
  session. Nothing about who the caller is comes from the form.
- There is no sign-up Server Action at all — a Server Action is a reachable POST
  endpoint whether or not any UI calls it, so closing self-registration means
  deleting the action, not hiding a button.
- File downloads use short-lived (60s) **signed URLs** — the bucket is private.
