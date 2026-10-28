# Acervus Finance PWA

The Acervus Finance lending book as an installable web app for phones and computers. You manage clients, loans (installments or interest only), payments, late fees, two cash accounts, expenses, income, reports and printable receipts.

It is built for several businesses, each with its own people and fully separate data. It keeps working without a connection.

- **Frontend:** Vite 8 + React 19 + TypeScript, an installable PWA (vite-plugin-pwa), hosted on **Cloudflare Workers static assets**.
- **Backend and database:** **Convex**, the single source of truth.
- **Authentication:** **Better Auth** on Convex (`@convex-dev/better-auth`): email and password with verification, plus optional Google sign-in.
- **Financial engine:** `shared/domain/`, the desktop app's engine ported to TypeScript. The server and the device run the same code. It is verified figure for figure against the desktop's Rust engine (see [docs/ENGINE.md](docs/ENGINE.md)).

The original desktop app (`xvrobiinson/VZ-Finance`) is separate and was not changed. See [docs/DESKTOP-SYNC-PLAN.md](docs/DESKTOP-SYNC-PLAN.md).

## Documents

| | |
|---|---|
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Accounts, environment variables, publishing, domains, installing on phones |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Data model, roles and security, offline sync and conflict handling |
| [docs/ENGINE.md](docs/ENGINE.md) | How the money rules were ported and verified |
| [docs/DESKTOP-SYNC-PLAN.md](docs/DESKTOP-SYNC-PLAN.md) | What connecting the desktop app would take (not done) |
| [docs/STATUS.md](docs/STATUS.md) | Decisions, test results, limitations |

Accounting rules are the desktop's `docs/ACCOUNTING.md`, unchanged.

## Developing

Requirements: Node 22 or later.

```bash
npm install
# Terminal 1 — a local Convex backend. Without an account:
CONVEX_AGENT_MODE=anonymous npx convex dev     # or: npx convex dev  (after npx convex login)
# once, on that development deployment:
npx convex env set BETTER_AUTH_SECRET "$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
npx convex env set SITE_URL http://localhost:5173
npx convex env set AUTH_LOG_EMAIL_LINKS true   # dev only: verification links go to the Convex log
# Terminal 2
npm run dev                                    # http://localhost:5173
```

Checks:

```bash
npm test             # engine, Rust oracle, backend (convex-test) and offline outbox tests
npm run typecheck    # app + Convex functions
npm run build        # typecheck + production build with the service worker
npm run smoke:local -- <convex-dev-log>         # real sign-up → verify → sign-in → workflow (local only)
npm run screenshots:local -- <convex-dev-log> <out-dir>   # phone screenshots + offline round-trip (local only)
```

Use synthetic data only for development. The scripts refuse anything but a local deployment.

## Layout

```
shared/domain/   financial engine (money, dates, loans, ledger, installments, portfolio, records)
convex/          schema, auth, authorization, mutations/queries, late-fee job, HTTP routes, tests
src/state/       app state: session (also offline), business, live/cached records, outbox sync
src/offline/     IndexedDB store and the outbox (idempotent, ordered, never drops changes)
src/screens/     overview, clients, loans, payment, money, reports, history, sync, settings, auth
src/receipts/    payment and loan receipts (US Letter), custom wording
src/ui/          kit (buttons, cards, sheets…), inputs, icons, chart
public/_headers  security headers (CSP) for Cloudflare
wrangler.jsonc   Cloudflare Workers static assets (SPA fallback)
```

## Licenses

Inter typeface: SIL Open Font License 1.1 (`public/fonts/Inter-LICENSE.txt`). Icons: Lucide shapes (ISC).
