# Connecting the desktop app: plan (not done)

You chose to keep the desktop app separate for now. Nothing in `xvrobiinson/VZ-Finance` was changed, and no data was migrated. This plan is here so the decision can be made later with the facts.

## Option A: one-time import, then the PWA is the only app (recommended when you're ready)

1. In the desktop app: Settings › Back up to… (a verified SQLite copy).
2. A new importer (a local script in this repo; no change to the desktop app) reads that `.db` **read-only**. It creates the business in Convex (or uses an existing one) and maps:
   - clients, with their photos into storage;
   - loans and schedules;
   - payments, with their recorded splits and allocation modes;
   - late fees and waivers;
   - capital entries and cash entries;
   - settings, wording and logo;
   - the change log, marked "imported".

   Record numbers keep the desktop's ids, so receipt numbers stay the same.
3. **Verification before going live:** the importer recomputes every loan and the portfolio in the PWA engine and compares them with the desktop's figures as of the same date. That covers payoff per loan, both cash accounts, portfolio value and overdue totals. Any difference stops the import.
4. Run first into the **development** deployment, then production, with your approval at each step.
5. **Rollback:** the desktop app and its database are untouched. If anything is wrong, keep using the desktop and delete the imported business in Convex.

## Option B: the desktop app syncs with Convex (two apps in use)

The desktop would need to:

- add HTTPS/WebSocket networking and Better Auth sign-in (a browser-based OAuth/device flow) to a Rust app that today has no network code by design ("no account, no network requests");
- either call the Convex functions (so the server validates everything) or keep its SQLite copy as a cache with an outbox, like the PWA's;
- adopt `opId` idempotency, version checks and conflict review screens;
- move "today" and late fees to the business time zone;
- handle photos and the logo in Convex storage.

**Compatibility:** schema versions must stay in step across both apps; old desktop versions would have to be blocked from syncing.
**Risks:** two codebases implementing sync, and a much larger attack surface on the desktop. Option A is simpler and safer.
**Rollback:** keep a desktop build without sync, plus a backup taken before the switch.

Either option needs your explicit approval before any real data is touched.
