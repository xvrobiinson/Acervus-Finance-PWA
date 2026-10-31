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
1. **Collector test.** Done 2026-10-30: open invitations for the signed-in email show an Accept button (welcome screen and Settings › Businesses), and Google sign-in comes back to the invitation. The owner confirmed it works. After it, the business's totals were hidden from collectors and viewers (owner's call): Overview shows active loans, overdue and receivable only, with no growth chart; Money and Reports are admins only (same on the desktop: no Analytics, no totals in the Loans and Payments headers). This hides them on screen; the devices still receive every loan, so the cloud doesn't restrict the data itself.
2. **New design for both apps.** Done 2026-10-30: the owner chose the "Dashboard style" from their examples (glassmorphism and a hero-card style were tried and declined). Violet accent, each figure on its own card with its icon in a colored square, Needs attention and Recent payments as card-style rows under a section heading, a greeting as the Overview title, and the sign-in's night sky behind every screen in dark mode only (the blue day sky was declined for light mode). Desktop: every screen (see its DESIGN.md). PWA: the same palette and pieces in `styles.css`; committed, deploy waiting for the owner's OK.
3. **Desktop release.** Done 2026-10-30: version 0.8 (business list, hidden totals for collectors, the redesign) pushed to `main` on the owner's word.
4. **Branding.** Done 2026-10-30 (owner's answers): About in both apps says "Acervus Finance, by VZ Labs" with the version, contact officialvzlabs@gmail.com, and links to the Terms and the Privacy Policy. VZ Labs is not a registered company, so no legal name or copyright line. No VZ Labs logo inside the apps; the desktop installer carries it (icon and wizard pictures) and names VZ Labs as publisher. Desktop 0.9 renames the program to `acervus.exe` and moves the data folder from `%LOCALAPPDATA%\VZFinance` to `%LOCALAPPDATA%\VZ Labs\Acervus` on first start (never when `ACERVUS_DB` points elsewhere). The GitHub repo is still called VZ-Finance (renaming it is the owner's call).
5. **Terms of Service and Privacy Policy.** Done 2026-10-30 as a plain-language draft (no lawyer, no governing-law clause, not limited to businesses): public pages `/terms` and `/privacy` in English and Spanish, linked from the sign-in pages and Settings › About in both apps. Accepting is by using the app; no checkbox.

## Waiting on you
1. Deployment, email and Google sign-in are done.
2. Later: a custom domain (optional).
