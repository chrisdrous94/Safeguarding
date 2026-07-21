# Sign-In & Platform Testing Checklist

## Pre-Deployment

### Environment Setup
- [ ] Apps Script Web App deployed from `apps-script-db.gs` (Execute as: Me, Access: Anyone)
- [ ] `ADMIN_CODE` script property set (or a fresh sheet with no admin users yet, so the first login bootstraps it)
- [ ] Web App `.../exec` URL configured in `index.html` (`SCRIPT_URL`) or via Settings
- [ ] Underlying Google Sheet's sharing restricted to the owner/service account only

### Automated checks (run on any change)
- [ ] `node --check` passes on the inline JS extracted from `index.html`
- [ ] `node --check` passes on `apps-script-db.gs`
- [ ] jsdom smoke test boots the app and switches every view without a console error

---

## Frontend Testing

### Initial Load
- [ ] Auth overlay appears on first load
- [ ] Logo and title display correctly
- [ ] Focus automatically on code input

### Access Code Login

#### Basic Flow
- [ ] User can type access code
- [ ] Character count updates in real-time
- [ ] Pressing Enter submits the form

#### Valid Code Entry
- [ ] Entering a valid code → "Verifying…" state
- [ ] Button disabled during verification
- [ ] Success message appears with user's name
- [ ] User logged in and lands on the dashboard
- [ ] No access code appears anywhere in the Network tab request URL (only in the POST body)

#### Invalid Code Entry
- [ ] Entering an invalid code → error message appears
- [ ] Error message is user-friendly (no user enumeration — same generic message whether the code doesn't exist or belongs to a deactivated account, per `loginByCode`)
- [ ] Button re-enables after error
- [ ] Input remains focused for retry

#### Validation Errors
- [ ] Empty code → "Please enter your access code" warning
- [ ] Too short (< 6 chars) → warning
- [ ] Spaces in code → warning
- [ ] Very long input rejected server-side too (not just trimmed client-side)

#### Rate limiting
- [ ] 5 consecutive failed attempts with the same code → "Too many attempts" error, even if a 6th attempt would've been the correct code
- [ ] A *different* code is unaffected by another code's lockout
- [ ] Lockout clears after ~15 minutes

#### Network Issues
- [ ] Offline → "Network error" message
- [ ] Apps Script URL not configured → clear message prompting Settings

### Session Management

#### First Time Login
- [ ] After successful login, overlay fades and dashboard loads automatically
- [ ] User name/initials/role display correctly

#### Page Reload
- [ ] Session persists on page reload (token still valid)
- [ ] No auth overlay appears
- [ ] `localStorage` (`ics_session`) contains only a token + display fields — **never** the access code

#### Idle timeout
- [ ] After 18 minutes of inactivity, a "Still there?" warning appears with a countdown
- [ ] Clicking "Stay signed in" dismisses the warning and resets the timer
- [ ] Ignoring the warning signs the user out automatically at 20 minutes
- [ ] Any mouse/keyboard/touch activity before the warning appears keeps resetting the idle timer

#### Sign Out
- [ ] Sign out clears local session state and calls the server to revoke the token
- [ ] Auth overlay reappears; code input is empty and focused
- [ ] A revoked token can no longer be reused for any authenticated action

#### Session Expiration
- [ ] Server-side session expires after 20 minutes idle (sliding) or 8 hours absolute, whichever comes first
- [ ] An expired/invalid token on any authenticated call triggers a clean "session expired, please sign in again" prompt rather than a silent failure or crash

---

## Accessibility Testing

### Keyboard Navigation
- [ ] Tab key moves through form inputs
- [ ] Enter key submits the login form
- [ ] Error messages announced to screen readers

### Screen Reader
- [ ] Auth overlay is readable
- [ ] Input labels are associated
- [ ] Error/success messages are announced

### Visual
- [ ] Text has sufficient contrast (WCAG AA)
- [ ] Error text is not color-only
- [ ] Focus indicators visible
- [ ] Mobile layout is readable

---

## Mobile Testing

### Responsive Layout
- [ ] Auth overlay centered on phone
- [ ] Inputs are touch-friendly (44px minimum)
- [ ] No horizontal scrolling needed

### Touch Input
- [ ] Code input accepts touch keyboard
- [ ] Submit button tappable
- [ ] Mobile keyboard closes after submit

---

## Security Testing

### Input Validation
- [ ] XSS attempts in any free-text field (description, notes, names) are escaped on render, not executed
- [ ] Very long inputs rejected server-side (name/notes length bounds, code length bounds)
- [ ] Role field can't be set to an arbitrary string via a crafted request — server validates against the fixed role list

### Session & transport
- [ ] No access code or session token ever appears in a URL (check Network tab across every authenticated action, not just login)
- [ ] `localStorage` never contains a raw access code, at any point in the session lifecycle
- [ ] Every sensitive action (user management, SEND report, case status) re-validates the caller's role server-side — confirm by checking a lower-privilege account can't successfully call an admin action even if the client-side nav is hidden
- [ ] CSP header/meta present; a script from a non-allowlisted host fails to load if injected

### Error Messages
- [ ] No system paths exposed
- [ ] No Google Sheet/Apps Script internals leaked in error text
- [ ] No user enumeration possible (login error is identical for "code doesn't exist" and "code deactivated")

---

## Performance Testing

- [ ] Auth overlay appears instantly
- [ ] Searching/filtering concerns or students doesn't lag while typing (debounced)
- [ ] Chart.js only downloads once you open Dashboard/Analytics/the SEND report, not on initial boot
- [ ] Re-opening the app shortly after doesn't re-fetch the full case list if nothing changed server-side (check Network tab: a `getVersion` call, not a full `getCases`, on most reopens)
- [ ] A concern/student/task list beyond 50 items shows a "Show more" control rather than rendering everything at once

---

## Browser Compatibility

- [ ] Chrome/Edge — auth overlay, all features, no console errors
- [ ] Firefox — same
- [ ] Safari (desktop + iOS) — same
- [ ] Mobile Chrome/Safari — same

---

## Work Item 4 — Full Chronology

- [ ] Opening a student's "Full chronology" button navigates to a dedicated view (not just the quick timeline in the student profile)
- [ ] Every concern, note, status change, agency referral, reassignment, action and body-map record for that student appears, sorted by date
- [ ] Type filter and date-range filters narrow the list correctly
- [ ] CSV export downloads a file matching the currently-filtered list
- [ ] Print/PDF opens a clean printable summary
- [ ] An audit log entry ("Chronology opened") is created each time
- [ ] A Teacher without access to a given student can't reach that student's chronology (same gating as the Students view)

## Work Item 5 — Linked concerns & families

- [ ] From a case detail view, linking another case shows it on both cases' "Linked cases" panels
- [ ] Unlinking removes it from both sides
- [ ] Creating a family, assigning students, and saving persists across a page reload and a fresh login
- [ ] Removing a student from a family clears their family badge
- [ ] A family with 3+ combined open concerns in the last 90 days shows the alert badge; a family under the threshold doesn't
- [ ] Existing students with no family assigned show no family badge and aren't otherwise affected

---

## Error Scenarios

- [ ] Apps Script deployment unreachable → graceful error, no app crash
- [ ] Invalid/expired session mid-action → clean re-auth prompt, no silent data loss (case edits queued via the optimistic local save aren't lost — check `persist()`/localStorage after a forced session expiry)
- [ ] Concurrent edits: two sessions editing the same case in quick succession don't corrupt the sheet (LockService serializes the writes)

---

**Last updated:** 2026-07-21
