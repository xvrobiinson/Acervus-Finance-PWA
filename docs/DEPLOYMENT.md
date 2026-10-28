# Deploying Acervus Finance PWA

Nothing in this repository has been deployed. Every step below is for you to run, from your accounts.

## Architecture in one picture

```
Phone / browser ──HTTPS──▶ Cloudflare Workers static assets   (the app: HTML, JS, service worker)
       │
       ├──WebSocket──▶ https://<deployment>.convex.cloud      (queries, mutations: the database)
       └──HTTPS─────▶ https://<deployment>.convex.site        (Better Auth endpoints, ID-photo endpoint)
```

No Worker code runs on Cloudflare: Convex is the backend. Workers static assets is Cloudflare's current recommended way to host a Vite single-page app. It is free for static assets, and unknown paths fall back to `index.html` (`wrangler.jsonc`). The default `*.workers.dev` URL is HTTPS, which installing the PWA requires.

## Accounts you need

| Service | What for | Cost (check current pricing) |
|---|---|---|
| Convex | Database, functions, auth endpoints, file storage | Free tier is enough to start |
| Cloudflare | Hosting the app over HTTPS | Static assets are free |
| Resend (or another provider; see `convex/lib/email.ts`) | Verification, password-reset and invitation emails | Free tier available |
| Google Cloud (optional) | "Continue with Google" | Free |
| GitHub | The `Acervus-Finance-PWA` repository | Free (private repo) |

Never paste keys or passwords into chats. Type them only into the CLI prompts or dashboards below.

## Environment variables

**Server-only (Convex deployment):** set with `npx convex env set NAME value` (add `--prod` for production). They are never in the app bundle.

| Name | Required | Value |
|---|---|---|
| `BETTER_AUTH_SECRET` | yes | 32+ random bytes, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. A different value per deployment. |
| `SITE_URL` | yes | The app's public URL, e.g. `https://acervus-finance-pwa.<you>.workers.dev` (no trailing slash) |
| `RESEND_API_KEY` | yes in production | From Resend |
| `EMAIL_FROM` | yes in production | e.g. `Acervus Finance <no-reply@yourdomain.com>` (a domain verified in Resend) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | From Google Cloud |
| `AUTH_LOG_EMAIL_LINKS` | **development only** | `true` writes email links to the Convex log. Never set it in production. |

**Public build-time (Vite):** these are visible to everyone.

| Name | Value |
|---|---|
| `VITE_CONVEX_URL` | `https://<deployment>.convex.cloud`. Set automatically by `npx convex dev` (dev) and `npx convex deploy` (prod). |
| `VITE_CONVEX_SITE_URL` | Optional. Derived from `VITE_CONVEX_URL` (`.convex.cloud` → `.convex.site`). |
| `VITE_GOOGLE_SIGN_IN` | `true` to show the Google button |

## Development vs production

- Each Convex project has a **development** deployment (used by `npx convex dev`) and a **production** deployment (used by `npx convex deploy`). They have separate data and separate environment variables.
- Cloudflare: the top-level Worker `acervus-finance-pwa` is production, and `--env staging` deploys a separate `acervus-finance-pwa-staging` Worker.
- Use synthetic data in development. Don't import real client data without a separate decision (see DESKTOP-SYNC-PLAN.md).

## First production deployment

1. **Convex project**
   ```bash
   npx convex login          # opens the browser
   npx convex dev --once --configure new   # creates the project and its cloud dev deployment
   ```
   (Development so far used a local, account-less deployment; `--configure new` replaces it in `.env.local`.)
2. **Production secrets.** Pick the app URL first: `https://acervus-finance-pwa.<your-subdomain>.workers.dev`. Your workers.dev subdomain appears in the Cloudflare dashboard under Workers & Pages.
   ```bash
   npx convex env set --prod BETTER_AUTH_SECRET "<random>"
   npx convex env set --prod SITE_URL https://acervus-finance-pwa.<your-subdomain>.workers.dev
   npx convex env set --prod RESEND_API_KEY <key>
   npx convex env set --prod EMAIL_FROM "Acervus Finance <no-reply@yourdomain.com>"
   ```
3. **Deploy the backend and build the app against it**
   ```bash
   npm run deploy:backend    # npx convex deploy --cmd "npm run build" --cmd-url-env-var-name VITE_CONVEX_URL
   ```
   This pushes the schema and functions to production, then builds `dist/` with the production URL.
4. **Tighten the CSP** (recommended). In `public/_headers`, replace `*.convex.cloud` and `*.convex.site` with your deployment's exact host names. Then run step 3 again.
5. **Publish the app**
   ```bash
   npx wrangler login
   npm run deploy:frontend   # wrangler deploy --env=""
   ```
   Wrangler prints the HTTPS URL. If it differs from `SITE_URL`, set `SITE_URL` again and redeploy.
6. **Google sign-in (optional).** In Google Cloud, create an OAuth client of type "Web application":
   - authorized JavaScript origin: your app URL;
   - redirect URI: `https://<deployment>.convex.site/api/auth/callback/google`.

   Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` with `--prod`, build with `VITE_GOOGLE_SIGN_IN=true`, and publish again.
7. **First admin.** Open the app, create an account, confirm the email, then **Create your business**: you are its admin. Invite others from Settings › People. No account is pre-created, and there is no registration shortcut.

### Custom domain (optional)
In the Cloudflare dashboard, open the Worker › Settings › Domains & Routes › Add custom domain (the domain must be on Cloudflare; the certificate is automatic). Then update `SITE_URL` and, if Google is on, its authorized origin. DNS changes are made by you in Cloudflare.

### Updating
Run `npm run deploy:backend && npm run deploy:frontend`. Installed apps show "A new version is ready" with an Update button. Changes queued offline are kept across updates (they live in IndexedDB).

## Installing on phones

- **Android (Chrome):** open the URL › menu ⋮ › **Install app**.
- **iPhone/iPad (Safari):** open the URL › Share › **Add to Home Screen**. Install it: iOS can clear offline data of sites that are only visited in the browser.
- The app must be opened online once on each device (to sign in and load the business) before it works offline.
- Receipts: tap **Print / PDF**. Android: choose "Save as PDF". iPhone: in the print preview, Share › Save to Files.

## Backups
Convex keeps the data. You can also use Settings › Data › Export CSV/JSON (admins), and the Convex dashboard offers snapshot export/import for full backups.
