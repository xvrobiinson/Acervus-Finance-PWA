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

**3. Desktop sync layer (desktop repo)** (in progress)

Design (2026-10-29), local-first so the screens and forms keep working as
they are:
- Linked, the SQLite file is a replica: the latest `data.snapshot` with each
  record's `recordNo` as its row id (record numbers are unique per table, so
  every screen, receipt and id keeps working), plus a `remote_ids` table
  (row id ↔ Convex id and `version`).
- A save still runs the existing local code at once and also queues an
  intent (`outbox`: kind, arguments with Convex ids, `opId`, the `version` it
  started from). A background worker sends the queue in order through the
  same mutations the PWA uses.
- Each new snapshot replaces the replica in one transaction and replays the
  intents still waiting, so the screen shows the server's books plus what is
  pending. A refused intent is kept for review and dropped from the replay.
- Offline, only the PWA's offline kinds are accepted (new clients, payments,
  expenses, income); other saves say they need a connection.
- Receipts for a new payment or loan print once the server has accepted it,
  with the server's record number.

Stages: 3a foundation (Convex client on a background thread, email-code
sign-in, session in Credential Manager, version check, snapshot feed);
3b replica (migration 0007, applying snapshots); 3c outbox and the write
path; 3d ID photos (DPAPI); then phase 4, the screens.

Done so far (desktop repo, not released): 3a; 3b (2026-10-29). A linked
business gets its own database file (`%LOCALAPPDATA%\VZFinance\cloud\<business
id>.db`), so the books kept on the PC before linking are never changed and
stay the rollback. `sync::replica::apply` refuses a file with its own books
or another business's, keeps client photos, this PC's preferences, the change
history and the outbox, and is all or nothing. Tested end to end: the seed
demo exported, imported into a local backend, received by the worker and
applied gives the same 26 figures and per-loan figures as the desktop that
exported it (`tests/sync_local.rs`). The logo download goes with 3d.

3c (2026-10-29): `sync::change::Change` lists every save; `Store::save`
runs it with the local code and, when linked, queues the matching mutation
(`outbox`, record ids and `expectedVersion` from `remote_ids`). The worker
sends one at a time and answers accepted / refused / no answer / not sent.
A lost answer is sent again only for the `opId` kinds (clients.create,
payments.record, money.addEntry); any other change is put aside for review
so it can't be made twice. Refused changes are kept with the cloud's reason.
Each new copy shows the waiting offline kinds on top; after any outcome the
app applies the last copy again. Tested on a local backend: every kind of
change except `setLateFeeWaived` and photos is accepted, and after each the
cloud's figures equal the desktop's own; a stale edit is refused
(`conflict`); an `opId` change sent twice is recorded once.
Notes for phase 4: a new record takes the cloud's record number when it is
accepted (the cloud numbers all records of a business with one counter), so
receipts wait for the accepted copy and find the record by its cloud id; a
linked desktop shouldn't assess late fees itself (the cloud does, hourly).

3d (2026-10-29): ID photos and the logo. `Change::ClientPhoto` and
`Change::Logo` queue the file (base64) with the mutation; the worker
uploads it to storage first (`photoUploadUrl` / `logoUploadUrl`) and a
failed upload leaves the change waiting. After each copy,
`Store::cloud_downloads` lists what to fetch (`cloud_files` tracks the
client version and logo address already held); `Worker::download` fetches
photos from `/client-photo` with the user's token (admins only) and the
logo from its address. Photos are kept as JPEG encrypted with DPAPI for the
Windows user; a copy for a non-admin is deleted and none are fetched;
`forget_cloud_photos` is for signing out. A new client's photo is sent once
the cloud has the client (phase 4 form). Tested on a local backend: photo
and logo up and back down, and a late fee waived (the last change kind).

Original outline:
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

Progress (2026-10-29, desktop repo, version 0.7.0, not released):
- `app::cloud`: sign-in, the worker's events, switching to a business's
  own file and back, sending the outbox one change at a time, photo and
  logo downloads, receipts opened once the cloud has the record. Every
  form saves through `VzApp::save(Change)`; restore and reset are refused
  while linked; a linked desktop doesn't assess late fees itself.
- Settings: a "Cloud sync" card (email code sign-in, business list,
  status, review list with Send again / Discard). Overview header: the new
  kit `Chip` showing the status; the owner is asked before it goes to the
  sidebar.
- Found and fixed while trying it: `/convex/token` answers with only the
  `convex_jwt` cookie, and 3a stored that as the whole session, which
  signed the desktop out on the next token. Renewals are now merged.
- Google check: `workers.dev` and `convex.site` are on the Public Suffix
  List, so `vz-labs.workers.dev` and `proper-pony-55.convex.site` count as
  domains of their own. Google's return address is
  `https://proper-pony-55.convex.site/api/auth/callback/google`.

Also in phase 4 (owner's request, 2026-10-29):
- **"Continue with Google"** next to the email code, in the PWA and the
  desktop. Better Auth's Google provider; one account per email, so the
  same person can use either. The desktop opens the browser and receives
  the result on a local loopback address. Needs a free OAuth client in a
  Google Cloud project (the owner creates it, guided). Check first that
  Google accepts our free addresses (`vz-labs.workers.dev`,
  `proper-pony-55.convex.site`) for a published app.
- **Backups to Google Drive:** the desktop's backup of a linked business
  (its copy is the whole book from the cloud) is also uploaded to the
  person's own Google Drive, daily and on demand, into an "Acervus Finance
  backups" folder, keeping the latest 30. Drive permission (`drive.file`:
  the app sees only the files it made) is asked only when backups are turned
  on. Not a sync channel: Convex stays the one copy that devices sync with.

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
- Google sign-in and backups to Google Drive: yes, in phase 4, after the
  sync works.
