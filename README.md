# Acervus Finance PWA

The Acervus Finance lending book as an installable web app for phones and computers. You manage clients, loans (installments or interest only), payments, late fees, two cash accounts, expenses, income, reports and printable receipts.

It is built for several businesses, each with its own people and fully separate data. It keeps working without a connection.

- **Frontend:** Vite 8 + React 19 + TypeScript, an installable PWA (vite-plugin-pwa), hosted on **Cloudflare Workers static assets**.
- **Backend and database:** **Convex**, the single source of truth.
- **Authentication:** **Better Auth** on Convex (`@convex-dev/better-auth`): passwordless sign-in with a 6-digit code sent by email (the first sign-in creates the account), plus optional Google sign-in.
- **Financial engine:** `shared/domain/`, the desktop app's engine ported to TypeScript. The server and the device run the same code. It is verified figure for figure against the desktop's Rust engine (see [docs/ENGINE.md](docs/ENGINE.md)).

The original desktop app (`xvrobiinson/VZ-Finance`) is separate and was not changed. See [docs/DESKTOP-SYNC-PLAN.md](docs/DESKTOP-SYNC-PLAN.md).

## Documents

| | |
|---|---|
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Step-by-step hosting on Convex and Cloudflare, the env files explained, the CI/CD pipeline, phones |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Data model, roles and security, offline sync and conflict handling |
| [docs/ENGINE.md](docs/ENGINE.md) | How the money rules were ported and verified |
| [docs/DESKTOP-SYNC-PLAN.md](docs/DESKTOP-SYNC-PLAN.md) | What connecting the desktop app would take (not done) |
| [docs/STATUS.md](docs/STATUS.md) | Decisions, test results, limitations |

Accounting rules are the desktop's `docs/ACCOUNTING.md`, unchanged.

## Run it on your computer (10 min)

You need Node 22 or later. First time only:

1. `npm install`
2. `npx convex login` (opens the browser; approve it)
3. `npx convex dev --configure new`: create the project `acervus-finance`, wait for `Convex functions ready!`, and leave it running
4. In the [Convex dashboard](https://dashboard.convex.dev), with the switch on **Development**, open **Settings › Environment Variables** and add:
   - `SITE_URL` = `http://localhost:5173`
   - `BETTER_AUTH_SECRET` = the output of `openssl rand -base64 32`
5. In a second terminal, run `npm run dev` and open http://localhost:5173
6. Type your email and click **Send code**. The code is in the first terminal, on the line with `CODE: 123456`

Every day after that, all you need is:

```bash
npx convex dev    # terminal 1: the backend (also shows sign-in codes)
npm run dev       # terminal 2: the app at http://localhost:5173
```

`.env.local` tells your computer which Convex deployment to use. `npx convex dev` writes it, and it is never committed. [docs/DEPLOYMENT.md, part 1](docs/DEPLOYMENT.md#part-1-where-settings-live-read-once-5-min) explains each line and how to check it.

Without `RESEND_API_KEY` and `EMAIL_FROM`, no email is sent: the sign-in code is written to the Convex log instead.

### Checks

```bash
npm test             # engine, Rust oracle, backend (convex-test) and offline outbox tests
npm run typecheck    # app + Convex functions
npm run build        # typecheck + production build with the service worker
npm run smoke:local -- <convex-dev-log>                   # code request → wrong code → sign-in with the code → workflow (local only)
npm run screenshots:local -- <convex-dev-log> <out-dir>   # phone screenshots + offline round-trip (local only)
```

Browser flows for jev-qa are in `tests/qa/`. Run them with `QA_EMAIL` set to a fresh address.

Use synthetic data only for development. The scripts refuse anything but a local deployment.

## Put it online

**First time (about 45 min):** follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) from top to bottom. It sets up Convex, Cloudflare and GitHub using the dashboards, one action per step.

**After that, every push to `main` deploys automatically** (`.github/workflows/deploy.yml`):

```
push to main ─▶ typecheck and test ─▶ Convex (backend + app build) ─▶ Cloudflare Workers
```

- About 4 minutes from push to live. Follow it in GitHub › **Actions**.
- A failing test stops the deploy. The live site keeps the last good version.
- Only `main` deploys. There are no preview deployments.
- To undo a release: `git revert <commit>`, then push.

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
wrangler.jsonc   Cloudflare Workers static assets (SPA fallback, no preview URLs)
.github/         the deploy pipeline (main only)
```

## Licenses

Inter typeface: SIL Open Font License 1.1 (`public/fonts/Inter-LICENSE.txt`). Icons: Lucide shapes (ISC).
