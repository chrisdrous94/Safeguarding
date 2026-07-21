# I CAN School — Safeguarding Platform

A KCSIE-aligned safeguarding case-management platform for I CAN School. Single-file frontend (`index.html`), Google Apps Script backend (`apps-script-db.gs`) writing to a Google Sheet. There is no Node/Express server — an earlier Node-based deployment path has been fully retired.

---

## Architecture

- **Frontend**: `index.html` — one file, Tailwind (CDN), Chart.js (loaded lazily), Lucide icons, Material You–style design. No build step.
- **Backend**: `apps-script-db.gs`, deployed as a Google Apps Script Web App. Reads/writes a Google Sheet with these tabs (created automatically on first use if missing):
  - `users` — staff accounts and hashed access codes
  - `cases` — every logged concern
  - `send_reports` / `send_cases` — the whole-school SEND report and register
  - `students` — durable per-student metadata (currently just `familyId`/`notes` — student name/year/form are still derived from case rows)
  - `families` — sibling groupings for the Families view
- All authenticated calls are `POST` requests with a JSON body (never a URL query string, and never a GET) — see **Security model** below for why.

---

## Deployment (Apps Script)

1. Open the Google Sheet you want to use as the database, then **Extensions → Apps Script**.
2. Paste the contents of `apps-script-db.gs` into the script editor (or use Settings → "Apps Script code" → Copy inside the running app, which always mirrors this repo file exactly).
3. **Deploy → New deployment → Web app**. Execute as **Me**, access **Anyone** (the app enforces its own auth on top of this — see below). Copy the `.../exec` URL.
4. In the script editor, go to **Project Settings → Script Properties** and set:
   - `ADMIN_CODE` — the master code the first Lead DSL logs in with. **Do not** put this in a committed file; set it only here. Alternatively, leave it unset — the very first person to log in with any code on a brand-new sheet (with no active Lead DSL/Principal/Senior Leadership user yet) automatically becomes the bootstrap admin and this property gets set for you.
5. Paste the Web App URL into the running app's **Settings → Apps Script Web App URL** field (or edit `SCRIPT_URL` near the top of `index.html` before hosting it).
6. **Lock down the underlying Sheet's sharing to yourself/the service account only.** This is a manual step in Google Sheets/Drive sharing settings — it can't be done from code, and it's the primary at-rest protection for this data (see Security model).
7. Host `index.html` anywhere that serves static files (GitHub Pages, etc.) — `_config.yml` already excludes the backend source and any local secrets from a GitHub Pages build.

### Migrating an existing deployment

All changes here are additive — nothing about your existing `users`/`cases`/`send_*` rows needs to change by hand:

- **`codeHash` column (users sheet)**: unchanged column, new value format. Existing plain-SHA-256 hashes keep working — the first successful login against a legacy hash silently re-hashes it with salted PBKDF2 and saves it back. No user re-registration needed.
- **`linkedCaseIds` column (cases sheet)**: new, appended after `strategyDuration`. Defaults to `[]` for every existing row.
- **`students` and `families` sheets**: new, created automatically the first time they're needed. Empty until you assign a student to a family.
- **Sessions**: login now returns a short-lived opaque token instead of the app storing your access code. Existing users are unaffected — you just log in the same way, with your existing code.

---

## Security model

This app handles real child-protection data, so the auth model is deliberately conservative:

- **No access codes in URLs.** Every authenticated action is a `POST` with a JSON body (`Content-Type: text/plain` to stay a CORS "simple request", since Apps Script Web Apps can't answer a CORS preflight). `login` is the only action that doesn't already require a session.
- **No access codes stored client-side.** `localStorage` holds only an opaque session token (`ics_session`), never the code. The code only ever exists in memory for the duration of the login/change-password round trip.
- **Sessions**: issued by the server on login (`CacheService`, keyed by a hash of the token — the raw token is never stored or logged server-side), a 20-minute sliding idle window, an 8-hour absolute cap, and revocable via logout. The UI warns you at 18 minutes of inactivity and signs you out automatically at 20 unless you confirm you're still there.
- **Password hashing**: PBKDF2 (HMAC-SHA256, 12,000 iterations, random 16-byte salt per user) — a from-scratch implementation, since Apps Script's V8 runtime has no native PBKDF2/bcrypt/WebCrypto. Legacy single-round SHA-256 hashes are upgraded transparently on next login.
- **Access codes**: generated from `Utilities.getUuid()`-sourced entropy (CSPRNG-backed), not `Math.random()`.
- **Rate limiting**: failed login attempts are throttled per submitted code (5 attempts, then a 15-minute lockout for that code) via `CacheService`.
- **Server-side role checks**: every admin/case-sensitive action re-validates the caller's role from their session on the server — the client's role display is never trusted for authorization.
- **CSP**: a `Content-Security-Policy` meta tag pins `script-src`/`connect-src` to `'self'` plus the exact CDN hosts and the Apps Script domain. Honest caveat: this is a single static file with one large inline script and no build step, so `script-src` can't drop `'unsafe-inline'` without a nonce source we don't have — the CSP's value here is blocking any *other* script host from loading, not sandboxing the inline code itself.
- **SRI**: Chart.js and Lucide are pinned to exact versions with `integrity`/`crossorigin` attributes. Tailwind's Play CDN and Google Fonts are the two accepted exceptions — neither serves a single stable-hashable file (Play CDN is a runtime compiler; Fonts serves UA-varying CSS), which is the same trade-off most sites accept for both.
- **At-rest protection**: restricted Sheet sharing (manual step, see Deployment) + session auth + the audit log are the committed protections in this pass. Field-level encryption of free-text (case descriptions, body-map notes) was considered and deliberately **not** implemented — Apps Script has no native AES/WebCrypto, so doing this "properly" means vendoring a third-party cipher implementation into a security-critical file, which is its own review burden. This is flagged as a known gap, not a silent omission.
- **What's out of scope for this app**: 2FA, SSO, IP allowlisting. All would be reasonable future additions.

---

## Features

- **Dashboard, Concerns, Students, Actions, Analytics, Audit log** — the existing case-management views.
- **Body map** — record injury locations on a concern.
- **SEND & Safeguarding whole-school report** — monthly figures for Lead DSL/Deputy DSL/Principal, fed automatically by the SEND case register (SENDCO/DSL/Principal).
- **Full Chronology** (per student) — a single date-sorted timeline merging every concern, timeline note, status change, agency referral, action and body-map record held on one child, filterable by type and date range, exportable to CSV and printable/PDF-able. Opened from a student's profile ("Full chronology" button); logs an audit entry each time it's opened. Uses the same full-history visibility as the existing student profile (once you have legitimate access to open a student, you see their complete picture — not fragmented by who logged which case, which matches how the app already worked before this feature existed).
- **Linked concerns** — from a case's detail view, link it to other related cases (e.g. a sibling's case, or a related incident); linked cases show inline and the link is stored on both sides.
- **Families** — group siblings together; the Families view shows each family's members with a combined open-concern count and flags (a small badge) when a family's combined open concerns cross a threshold within a rolling 90-day window. A family badge appears on a student's card once they're assigned.

### Known limitation: student identity isn't fully stable

Students aren't a first-class record with a permanent ID — `studentId` is derived from a name string in a few places, so a typo or different capitalization can produce a different ID and fragment one child's history across it. Chronology and Families inherit this, same as the rest of the app already does. Fixing this would mean a "merge students" feature, which is out of scope here — worth knowing about, not something this pass silently papered over.

---

## Local development

There's no local server anymore — `index.html` is a static file that talks directly to your deployed Apps Script Web App URL. Open it directly in a browser (or serve it with any static file server) and point **Settings → Apps Script Web App URL** at your deployment.

---

## Testing

See `TESTING_CHECKLIST.md` for a full manual QA pass. Automated checks run as part of any change to this repo:
- A Node syntax check (`node --check`) on the inline JS extracted from `index.html`, and on `apps-script-db.gs`.
- A jsdom smoke test that boots the app and switches between every view without a console error.

Neither of these executes real Apps Script code (`SpreadsheetApp`/`CacheService`/`LockService` only exist in a live deployment) — a real login/session/save round trip against a live Apps Script deployment and test spreadsheet is manual QA.

---

## Repository layout

```
index.html            single-file frontend
apps-script-db.gs      Apps Script backend (deploy this as the Web App)
_config.yml            GitHub Pages config — excludes backend source from the published site
TESTING_CHECKLIST.md   manual QA checklist
.gitignore             keeps secrets and local artifacts out of git
```
