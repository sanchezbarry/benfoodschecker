# Ben Foods · Cert Checker

Track document / certificate **expiry dates** and send **automated, escalating email reminders**.

- **Auth** — Supabase Auth (email + password)
- **Upload** — PDFs or images to a private Supabase Storage bucket, size-limited to **10 MB** and restricted to PDF/PNG/JPG/WEBP
- **Two-level reminders**
  1. **On expiry** → email the **marketing contact**
  2. **N days later**, if the certificate still hasn't been renewed → escalate to **senior management**
- **Email** — [Resend](https://resend.com)
- **Scheduling** — a secret-protected cron endpoint, driven by **Vercel Cron** or **Supabase `pg_cron`**

Built with Next.js 16 (App Router), React 19, Tailwind v4, and hand-authored shadcn/ui components (dark theme).

---

## Architecture

```
Browser ──► Next.js (App Router)
             ├─ /login            Supabase Auth (email/password)
             ├─ /dashboard        upload + list documents (RLS-scoped)
             │     └─ Server Actions ──► Supabase Postgres + Storage
             └─ /api/cron/check-expiries   ◄── Vercel Cron or pg_cron (daily)
                     │  service-role client → reads documents
                     └─ Resend → marketing (L1) / management (L2) emails
```

Reminder state lives in the `documents.status` enum (`active → notified → escalated`).
Because each email is tied to a status transition, the job is **idempotent** — running
it repeatedly never double-sends.

---

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run [`supabase/schema.sql`](supabase/schema.sql). This creates the
   `documents` table + RLS policies and the private `documents` storage bucket with a 10 MB /
   MIME limit.
3. **Authentication → Providers → Email**: keep Email enabled. For fastest local testing you can
   turn **off** "Confirm email" so sign-up logs you straight in.
4. Grab your keys from **Project Settings → API**: the project URL, the `anon` public key, and the
   `service_role` secret key.

### 2. Resend

1. Sign up at [resend.com](https://resend.com) and create an **API key**.
2. Verify a sending domain, or use the sandbox sender `onboarding@resend.dev` for testing
   (it can only send to your own verified address).

### 3. Environment variables

```bash
cp .env.local.example .env.local
```

Fill in every value (see the comments in the file):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET` (any long random string), `NEXT_PUBLIC_APP_URL`.

### 4. Run

```bash
npm install
npm run dev
```

Open <http://localhost:3000>, create an account, and add a document.

---

## Scheduling the reminder job

The logic lives in [`app/api/cron/check-expiries/route.ts`](app/api/cron/check-expiries/route.ts).
It's protected by `CRON_SECRET` (sent as `Authorization: Bearer <secret>` or `?secret=<secret>`).

**Test it manually:**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/check-expiries
# → {"ok":true,"notified":1,"escalated":0,"errors":[]}
```

**Option A — Vercel Cron (recommended if deploying to Vercel).**
[`vercel.json`](vercel.json) already schedules it daily at 08:00 UTC. Add `CRON_SECRET` in your
Vercel project's env vars — Vercel automatically sends it as the Bearer token.

**Option B — Supabase `pg_cron` + `pg_net`.**
Uncomment and edit the final block in [`supabase/schema.sql`](supabase/schema.sql)
(set your deployed URL and `CRON_SECRET`), then run it. This lets Supabase call the endpoint
daily with no extra infrastructure.

> Hobby-tier schedulers typically run at most once per day, which is exactly what this workflow needs.

---

## How the two levels work

| Trigger condition | Action | New status |
| --- | --- | --- |
| `expiry_date <= today` and status `active` | email **marketing contact** | `notified` |
| `today >= expiry_date + escalation_days` and status `notified` | email **senior management** (cc marketing) | `escalated` |

To "renew" a certificate, upload the new file as a new document and delete the old row — removing
the `notified` row stops any escalation.

## Security notes

- The `service_role` key is only imported by the cron Route Handler and never reaches the browser.
- All document reads/writes are constrained by Postgres **RLS** and Storage policies scoped to
  `auth.uid()`, so users can only ever see their own files.
- File downloads use short-lived (60s) **signed URLs** — the bucket itself is private.
