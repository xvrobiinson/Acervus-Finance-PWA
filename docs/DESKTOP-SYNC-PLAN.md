# Connecting the desktop app: two-way live sync (decided 2026-10-28)

The owner chose **two-way live sync** over a one-time import: the desktop app
and the PWA both stay in use, and a change on either one shows up on the
other. Nothing is built yet. Each phase below needs the owner's approval
before it starts, and no real data is touched before phase 5.

## The model: Convex is the single source of truth

There is one copy of the books, the one in Convex. The desktop stops being its
own database and becomes a second screen onto Convex, like the PWA:

- **Reading:** the desktop subscribes to `data.snapshot` over a WebSocket (the
  official Rust client, `convex` crate). When anything changes on any
  device, Convex pushes the new snapshot and the desktop's local SQLite copy
  is replaced in one transaction. Screens keep reading SQLite, so they work
  as they do today and keep working offline.
- **Writing:** every save calls the same Convex mutations the PWA uses. The
  server runs the engine and rejects anything that breaks the rules, so the
  two apps can't drift apart.
- **Offline:** the same rules as the PWA. New clients, payments, expenses and
  income go into a SQLite outbox (`opId`, ordered, idempotent) and are sent on
  reconnect. New loans, edits and deletions need a connection. Edits carry the
  `version` they started from; a stale edit is refused and the desktop shows
  what changed instead of overwriting it.

Nothing has to merge two databases, which keeps the sync simple
and safe. The cost: the desktop needs the internet for edits and new loans.

## Phases

**0. Cloud backend for testing** (done 2026-10-29)
The development deployment `confident-squid-285` (demo data only);
production is `proper-pony-55`.

**1. Server additions (this repo)** (done 2026-10-29)
- Sign-in: the same emailed 6-digit code as the PWA
  (`/email-otp/send-verification-otp`, `/sign-in/email-otp`), then
  `/convex/token` for the Convex token. No new auth tables: the device
  authorization plugin would have needed a local install of the Better Auth
  component and a move of the live sign-in data.
- `desktop.compat({ clientVersion })`: the desktop asks before signing in
  and before each sync whether its build may sync (`MIN_DESKTOP_VERSION`,
  first sync build 0.7.0). Raise it whenever a schema or argument change
  would let an older build write with old rules.
- Everything else already exists: `data.snapshot`, the mutations (with
  `opId` and `version`) and the admin-only `/client-photo` endpoint.
- Still to test, in phase 3 with the real desktop client: a desktop and a
  phone writing to the same loan.

**2. Importer** (done 2026-10-29)
1. Desktop repo, on the day of the import:
   `cargo run --example export_for_cloud -- <backup.db> <export-dir>` copies
   the database read-only, brings the copy up to date and writes the
   desktop engine's figures (`figures.json`).
2. This repo: `node scripts/import-desktop.mjs <export-dir> --url
   https://<deployment>.convex.cloud` signs in with the email code and calls
   `imports.desktopBook`, then uploads ID photos and the logo.

`imports.desktopBook` is one transaction: it reworks every loan with the
shared engine and compares all 26 portfolio figures and each loan's figures
with the desktop's; any difference (or an export from another day) keeps
nothing. Reversed payments (an early desktop feature) are left out. Tested
with `convex/imports.test.ts` (a demo book with every payment mode, a waived
fee, a default and an archived client) and end to end on a local backend
(photo and logo included). Mutation limits (16,000 documents written per
call) cap the size of a book imported in one go; a larger book would need
to be sent in parts.

Original outline:
Creates the business and maps clients (photos into storage), loans and
schedules, payments with their recorded splits and allocation modes, late
fees and waivers, capital and cash entries, settings, wording and logo, and
the change log (marked "imported"). Record numbers keep the desktop's ids, so
receipt numbers stay the same. It then recomputes every loan and the
portfolio and compares them with the desktop's figures as of the same date
(payoff per loan, both cash accounts, portfolio value, overdue totals). Any
difference stops it. Tested on a `seed_demo` database first.

**3. Desktop sync layer (desktop repo)**
- `src/sync/`: the Convex client on a background thread; sign-in by email
  code; the session kept in Windows Credential Manager, never in a file.
- ID photos (owner's choice): admins' desktops keep a copy for offline use,
  encrypted with Windows DPAPI (current user) and deleted on sign-out or when
  the user stops being an admin. Other roles never download them.
- Migration `0007`: Convex ids and `version` on each record, an `outbox`
  table, a `sync_state` row (business, last snapshot time).
- The services' write functions go through Convex when signed in. With sync
  off they stay as they are today, so the app still works with no account.
- "Today" and late fees use the business time zone.

**4. Desktop screens** (kit-first: tried on Overview, then the owner is asked)
Sign in / link business in Settings, sync status in the sidebar (synced /
offline with N waiting / needs review), and a review list for refused
offline changes.

**5. Real data** (each step approved)
Back up in the desktop, import into production with the figure check, link
the desktop, use both.

**Compatibility:** both apps must stay on the same schema; the
`clientVersion` check blocks old desktop builds.
**Risks:** sync code in two codebases, and the desktop gains network access
(today it makes no network requests by design).
**Rollback:** the backup taken before the switch, plus a desktop build with
sync turned off.

## Decided by the owner (2026-10-29)

- Sign-in: email code, like the PWA.
- ID photos: saved on admins' PCs too (encrypted, see phase 3).
- Users: the owner and their team (any role). The server enforces role
  rules; the desktop hides what a role can't do.
