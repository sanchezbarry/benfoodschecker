# Bulk import — bringing the existing certificates onto the portal

Everything filed so far was typed in by hand through the dashboard. The back
catalogue is too big for that, so it comes in as a **spreadsheet plus a folder
of files**, checked by a dry run and then written straight to the database with
the service-role client.

- [`certificates-template.csv`](certificates-template.csv) — what the team fills in
- One flat folder of certificate files, named exactly as the `file_name` column says

---

## What the team hands over

| Column | Required | Notes |
| --- | --- | --- |
| `file_name` | ✅ | Exact filename in the handover folder. This is the join key — get it wrong and the row has no file. |
| `vendor_code` | ✅ | `FL030`, `FT004A`… Matches an existing folder case-insensitively; an unknown code **creates** a new vendor folder. |
| `vendor_name` | ✅ | Ignored when the code already exists — the stored name wins, exactly as filing through the form behaves. |
| `cert_type` | ✅ | Free text. Reuse the wording already in the portal or the list fragments into near-duplicates. |
| `expiry_date` | ✅ | `YYYY-MM-DD`. Stored as **00:00 Asia/Singapore**, matching every date the app writes. |
| `pic_name` | ✅ | The name shown on the certificate. Free text — it does not have to match an account. |
| `pic_email` | ✅ | The account that will **own** the row, which is what RLS uses to decide who may edit it. Must be an existing account, or one we create first. |
| `marketing_email` | ✅ | Gets the two advance reminders and the expiry notice. |
| `management_email` | ✅ | Gets the escalation. Several addresses go in the one cell, separated by commas — Excel quotes the cell for you. |
| `first_reminder_days` | — | Blank → 60 |
| `second_reminder_days` | — | Blank → 30, and must be fewer days than the first |
| `escalation_days` | — | Blank → 7 |
| `notes` | — | Ignored by the importer; a scratch column for the team. |

**Files must be PDF, PNG, JPG or WEBP, and each under 25 MB** — the same limits
the upload form and the bucket enforce. Anything else (`.doc`, `.tiff`, `.heic`)
has to be converted before it can be imported. The type is read from the file's
own bytes, not its extension, so a JPEG renamed `.pdf` is rejected on import
rather than stored as a broken PDF.

### File names

They only have to survive the handover. The bucket path is
`<user_id>/<uuid>.<ext>` and the extension comes from the detected MIME type, so
**the original name is not stored anywhere** — there is no column for it. That
makes an elaborate convention pointless, and renaming a few hundred files by
hand a good way to introduce errors that did not previously exist.

The one hard requirement is that names are **unique across the handover**, since
the folder is flattened. Beyond that: no commas (the sheet is comma-separated),
no quotes or slashes, and no renaming after the sheet is filled in.

Where the team is scanning or downloading files anyway, `CODE_TYPE_YYYY-MM-DD.pdf`
costs them nothing extra and lets the dry run **cross-check the sheet against the
file names** — a row whose vendor code or expiry disagrees with its own file name
is a transcription error worth catching before import. Treat it as a bonus, not a
requirement.

To keep `file_name` honest, generate it rather than typing it:

```bash
cd /path/to/handover
{ echo file_name; ls -1; } > ~/Desktop/file-names.csv   # paste in as column A
```

---

## Two things that will bite if they are not planned for

### 1. Reminders firing on everything at once

Import a certificate expiring in three weeks and the next cron run emails the
marketing contact, because its reminder windows are already open. Import two
hundred and the workflow mails every contact in the company on day one, then
escalates the expired ones to management a week later.

The importer therefore **stamps any reminder whose window is already open at
import time**, the same rule migration 008's backfill used, and files
already-expired certificates at the status they have actually reached rather
than as `active`. Nothing is sent retroactively; the workflow starts from the
import date and runs forward normally.

This is not optional and it is not a detail — it is the difference between a
quiet migration and a hundred confused vendors.

### 2. Storage, before the files arrive

Free tier is **1 GB of file storage**. Certificates uploaded through the browser
are compressed on the way (70–90% off a photo or a big scan); a bulk import has
no browser, so what the team hands over is what gets stored, at full size.

Measure the handover folder **before** importing:

```bash
du -sh /path/to/handover        # total
find /path/to/handover -type f -size +5M | wc -l   # the heavy ones
```

Under ~700 MB, import as-is. Over it, either compress the scans first or move to
Pro ($25/mo, 100 GB) — which is worth doing anyway for point-in-time restore on
what are, after all, compliance records.

---

## Running it

**1. Dry run, and keep running it until it is clean.** Validate the whole sheet
without writing anything: missing files, unreadable dates, unknown `pic_email`,
bad MIME types, oversized files, `second >= first` reminder pairs, and rows that
duplicate something already on the portal. Hand the errors back to the team, get
a corrected sheet, run again.

**2. Create the missing accounts.** `pic_email` has to resolve to a real user
before its rows can be owned. Most of the team already has one.

**3. Import into a second Supabase project first.** The free plan allows two
projects, so a staging copy costs nothing. Point `.env.local` at it, import,
then open the dashboard and look at the result as a user would.

**4. Import to production in batches**, newest expiry first, so anything that
goes wrong goes wrong on the certificates that matter least. Every row logs its
`document.id` and storage path, which is what makes a partial import reversible.

**5. Read the register back.** `Export CSV` on the dashboard now covers the whole
portal, so the import can be reconciled against the source spreadsheet in Excel —
row counts, per-vendor counts, and any expiry that moved by a day (which would
mean a timezone bug, not a typo).

---

## Per row, the importer does exactly what the upload form does

1. Upload the file to `<owner_user_id>/<uuid>.<ext>` — the path convention the
   storage policies expect, so ownership keeps working afterwards.
2. Resolve or create the vendor folder from `vendor_code`.
3. Insert the `documents` row, with reminder stamps set as described above.
4. Insert `document_versions` version 1, `is_current = true`.

Steps 3 and 4 mirror `createDocument` in
[`app/dashboard/actions.ts`](../../app/dashboard/actions.ts). If that action
changes, this has to change with it.
