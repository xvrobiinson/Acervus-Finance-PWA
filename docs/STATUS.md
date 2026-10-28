# Acervus Finance PWA: status (2026-10-28)

## Decisions confirmed by the owner
- Several separate businesses with self-service sign-up; whoever creates a business is its admin.
- Roles: Admin, Collector and Viewer (`convex/lib/access.ts`).
- Email and password with verification (Resend), plus optional Google.
- Offline: create clients, payments, expenses and income. Everything else needs a connection.
- ID photos: Convex storage, admins only, never cached, exported or printed.
- The desktop app stays separate and untouched; migration will be decided later (`DESKTOP-SYNC-PLAN.md`).
- The owner has Convex and Cloudflare accounts. Code is in the private GitHub repo `xvrobiinson/Acervus-Finance-PWA` (approved 2026-10-28). **Nothing is deployed yet.**

## Implemented
- **Engine** (`shared/domain`): port of the desktop engine and services logic.
- **Backend** (`convex/`):
  - multi-tenant schema;
  - Better Auth (verification, reset, Google, per-account and safe per-IP rate limits);
  - authorization on every function;
  - clients, loans (with edited schedules), payments (4 allocation modes), late fees and waivers, defaults;
  - capital, expenses, income, transfers, adjustments;
  - settings and wording, logo, members, invitations;
  - audit log, idempotent operations, stale and conflict detection, hourly late-fee job;
  - admin-only photo endpoint.
- **App** (`src/`):
  - sign-in, sign-up, verification, password reset, invitations, create business;
  - Overview (KPIs, growth chart, needs attention, recent payments);
  - Clients (search, profile, ID photo);
  - Loans (filters, detail with installments or interest periods, payments, waivers, default, delete);
  - loan form with schedule preview and editor;
  - payment form with live split preview and quick amounts;
  - Money (accounts, movements, all entry forms);
  - Reports (returns, capital and gain, loans by status, monthly cash flow);
  - change History, Sync center, Settings (device, business, receipts, formats, defaults, logo, wording, people, CSV/JSON export);
  - payment and loan receipts (US Letter) with print/PDF and download;
  - English and Spanish; light and dark; phone-first layout (tab bar and "+" button; side rail on wide screens).
- **Offline:**
  - service worker precache with an update prompt;
  - last copy per user and business in IndexedDB;
  - IndexedDB outbox, ordered and idempotent, with review/confirm/discard and a discard journal;
  - offline and pending banners.
- **Hosting:** `wrangler.jsonc` (Workers static assets, SPA fallback), security headers with CSP, PWA manifest and icons.

## Test results (all run locally)
| Suite | Result |
|---|---|
| Engine: desktop unit tests ported | 47 / 47 pass |
| Engine: differential test vs the desktop's Rust engine | 200 loans / 50 portfolios (committed) pass; 3,000 / 750 batch run once, no differences; a deliberately broken rounding rule makes them fail |
| Backend (convex-test): auth, isolation, roles, invitations, workflows, idempotency, stale/conflict, late fees, cash rules | 13 / 13 pass |
| Offline outbox (fake IndexedDB): lost replies, refusals, session expiry, ordering, rebase, discard journal | 9 / 9 pass |
| `npm run typecheck` (app + Convex), `npm run build` | pass (176 KB gzipped JS) |
| `wrangler deploy --dry-run` | config valid |
| Real stack, local backend (`scripts/smoke-auth.mjs`): sign-up → unverified sign-in refused → email link → sign-in → Convex token → anonymous calls refused → business/loan/payment → retried operation recorded once → sign-out → token refused | 13 / 13 pass |
| Real app in headless Edge, phone viewport (`scripts/screenshots.mjs`): screens render; **offline payment saved on the device, shown pending, synced after reconnecting, recorded once and marked offline on the server** | pass |

Problems found and fixed while testing:
- Two outbox ops made in the same millisecond could be sent out of order.
- Money figures wrapped onto two lines on narrow phones.
- Sheets were wider than the phone.
- The app trusted a WebSocket that hadn't noticed the network was gone.
- **Better Auth's rate limits would have put all users in one shared bucket**, because Convex HTTP actions passed no client IP.

## Limitations
- Each mutation reads the business's whole ledger, which is fine for small and medium lenders. Very large books would need cached per-loan summaries (Convex transaction read limits).
- Not tested on real Android or iPhone hardware or the production Convex cloud. The Google sign-in round trip and real email delivery (Resend) are untested; they need your accounts. The per-IP rate limit depends on what Convex cloud forwards; per-account limits always apply.
- The session token lives in localStorage (the cross-domain plugin's design), mitigated by the CSP.
- Offline: no new loans or edits; receipts only after sync; queued payments aren't counted in figures until accepted; the app must be opened online once per device. iOS needs the app installed to keep offline data reliably.
- Desktop-only features with no PWA equivalent: SQLite backup/restore files (replaced by Convex backups and CSV/JSON export), the Windows file picker, keyboard shortcuts, Diagnostics.
- The receipt page-count note uses the desktop's row measurements (US Letter in Edge). Other browsers may break pages slightly differently.

## Waiting on you
1. Follow `DEPLOYMENT.md`: `npx convex login`, production secrets, Resend domain, `npx wrangler login`, deploy.
2. Optional: Google OAuth client; custom domain.
