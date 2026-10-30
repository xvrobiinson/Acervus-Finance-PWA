# Acervus Finance PWA: status (2026-10-30)

## Decisions confirmed by the owner
- Several separate businesses with self-service sign-up; whoever creates a business is its admin.
- Roles: Admin, Collector and Viewer (`convex/lib/access.ts`).
- Passwordless email codes (sent through Brevo), plus Continue with Google (working since 2026-10-29). Changed from email and password on 2026-10-28.
- Offline: create clients, payments, expenses and income. Everything else needs a connection.
- ID photos: Convex storage, admins only, never cached, exported or printed.
- Desktop: two-way live sync with the PWA, chosen 2026-10-28 (`DESKTOP-SYNC-PLAN.md`). Phases 0–4 done (desktop 0.7.0 released 2026-10-30); phase 5, the import, done 2026-10-30 (the desktop books are the business "VZ Capital Group"); each phase needs approval.
- Live at https://acervus-finance-pwa.vz-labs.workers.dev (Convex production `proper-pony-55`), deployed by GitHub Actions on every push to `main`. Code is in the private GitHub repo `xvrobiinson/Acervus-Finance-PWA`.

## Implemented
- **Engine** (`shared/domain`): port of the desktop engine and services logic.
- **Backend** (`convex/`):
  - multi-tenant schema;
  - Better Auth (email codes, Google, per-account and safe per-IP rate limits);
  - authorization on every function;
  - clients, loans (with edited schedules), payments (4 allocation modes), late fees and waivers, defaults;
  - capital, expenses, income, transfers, adjustments;
  - settings and wording, logo, members, invitations;
  - audit log, idempotent operations, stale and conflict detection, hourly late-fee job;
  - admin-only photo endpoint.
- **App** (`src/`):
  - sign-in and sign-up with an email code, invitations, create business;
  - Overview (KPIs, growth chart, needs attention, recent payments);
  - Clients (search, profile, ID photo);
  - Loans (filters, detail with installments or interest periods, payments, waivers, default, delete);
  - loan form with schedule preview and editor;
  - payment form with live split preview and quick amounts;
  - Money (accounts, movements, all entry forms);
  - Reports (returns, capital and gain, loans by status, monthly cash flow);
  - change History, Sync center, Settings (device, businesses: open, create, delete; business, receipts, formats, defaults, logo, wording, people, CSV/JSON export);
  - payment and loan receipts (US Letter) with print/PDF and download;
  - English and Spanish; light and dark; phone-first layout (tab bar and "+" button; side rail on wide screens).
- **Offline:**
  - service worker precache with an update prompt;
  - last copy per user and business in IndexedDB;
  - IndexedDB outbox, ordered and idempotent, with review/confirm/discard and a discard journal;
  - offline and pending banners.
- **Hosting:** `wrangler.jsonc` (Workers static assets, SPA fallback, no preview URLs), security headers with CSP, PWA manifest and icons.
- **CI/CD:** `.github/workflows/deploy.yml`: every push to `main` runs typecheck and tests, deploys Convex (building the app against it), then publishes to Cloudflare. No preview deployments.

## Test results (all run locally)
| Suite | Result |
|---|---|
| Engine: desktop unit tests ported | 47 / 47 pass |
| Engine: differential test vs the desktop's Rust engine | 200 loans / 50 portfolios (committed) pass; 3,000 / 750 batch run once, no differences; a deliberately broken rounding rule makes them fail |
| Backend (convex-test): auth, isolation, roles, invitations, workflows, idempotency, stale/conflict, late fees, cash rules | 13 / 13 pass |
| Offline outbox (fake IndexedDB): lost replies, refusals, session expiry, ordering, rebase, discard journal | 9 / 9 pass |
| `npm run typecheck` (app + Convex), `npm run build` | pass (176 KB gzipped JS) |
| `wrangler deploy --dry-run` | config valid |
| Real stack, local backend (`scripts/smoke-auth.mjs`): code requested → code in the Convex log → wrong code refused → sign-in with the code creates the account → used code refused → Convex token → anonymous calls refused → business/loan/payment → retried operation recorded once → sign-out → token refused | 12 / 12 pass (2026-10-28) |
| Browser (jev-qa, `tests/qa/email-code-*.qa`): email screen, code screen, wrong code message, sign-up with name, no password fields | 2 / 2 flows pass (2026-10-28) |
| Real app in headless Edge, phone viewport (`scripts/screenshots.mjs`): screens render; **offline payment saved on the device, shown pending, synced after reconnecting, recorded once and marked offline on the server** | pass |

Problems found and fixed while testing:
- Two outbox ops made in the same millisecond could be sent out of order.
- Money figures wrapped onto two lines on narrow phones.
- Sheets were wider than the phone.
- The app trusted a WebSocket that hadn't noticed the network was gone.
- **Better Auth's rate limits would have put all users in one shared bucket**, because Convex HTTP actions passed no client IP.

## Limitations
- Each mutation reads the business's whole ledger, which is fine for small and medium lenders. Very large books would need cached per-loan summaries (Convex transaction read limits).
- Not tested on real Android or iPhone hardware by us; the owner uses it live. The per-IP rate limit depends on what Convex cloud forwards; per-account limits always apply.
- The session token lives in localStorage (the cross-domain plugin's design), mitigated by the CSP.
- Offline: no new loans or edits; receipts only after sync; queued payments aren't counted in figures until accepted; the app must be opened online once per device. iOS needs the app installed to keep offline data reliably.
- Desktop-only features with no PWA equivalent: SQLite backup/restore files (replaced by Convex backups and CSV/JSON export), the Windows file picker, keyboard shortcuts, Diagnostics.
- The receipt page-count note uses the desktop's row measurements (US Letter in Edge). Other browsers may break pages slightly differently.

## To do (in this order)
1. **Collector test.** First try (2026-10-30): the invited person signed in and was asked to create a business instead of joining. Cause: an invitation only worked through the emailed link in the same browser tab, and Google sign-in returned to the home page and lost it. Fixed: open invitations for the signed-in email are shown with an Accept button (welcome screen and Settings › Businesses), and Google sign-in comes back to the invitation. Next: deploy, then the owner tries again and checks the desktop with that account.
2. **New design for both apps.** The owner will send example designs when ready; wait for them before changing any screens.
3. **Desktop release** of the business list (switch, create, delete) and whatever the redesign brings. Pushing `main` in the desktop repo makes a release, so only on the owner's word.
4. **Branding.** Brand architecture (owner, 2026-10-30): **VZ Labs** is the parent technology brand; **Acervus Finance** is its first major software product. Show this in an About section in the PWA and the desktop app. Questions for the owner:
   - Exact About wording? Suggestion: "Acervus Finance, by VZ Labs" plus the version.
   - Copyright line: "© 2026 VZ Labs"? Is VZ Labs a registered company (full legal name, such as SRL or LLC, and country)?
   - Contact for VZ Labs: website and support email to show?
   - Is there a VZ Labs logo? Where should it appear (About only, sign-in screen, receipt footer)?
   - Desktop installer: change the Windows "Publisher" to VZ Labs?
   - Old "VZ Finance" names remain inside the desktop (`vz-finance.exe`, the `VZFinance` data folder). Rename them? Moving the data folder needs a careful migration.
5. **Terms of Service** for the app (PWA and desktop). Questions for the owner:
   - Which country's law applies, and is the service for businesses only?
   - A Privacy Policy as well? It would say where data lives (Convex, Cloudflare, Google Drive backups) and how to delete an account.
   - Must people accept them at sign-up (a checkbox), or is a link in About enough?
   - Will a lawyer review the text? A draft from us is a starting point, not legal advice.

## Waiting on you
1. Deployment, email and Google sign-in are done.
2. Later: a custom domain (optional).
