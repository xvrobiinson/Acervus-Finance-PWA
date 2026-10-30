# Hosting Acervus Finance on Convex and Cloudflare

**Finish line:** the app is live at `https://acervus-finance-pwa.<your-subdomain>.workers.dev`, and every push to `main` deploys it automatically.

**Time:** about 45 minutes the first time. After that, deploying means pushing to `main`.

Do the parts in order. Each step is one action.

| Part | What you do | Where | Time |
|---|---|---|---|
| 1 | Learn where settings live | This page | 5 min |
| 2 | Run the app on your computer | Terminal and Convex dashboard | 10 min |
| 3 | Prepare Cloudflare | Cloudflare dashboard | 10 min |
| 4 | Prepare Convex production | Convex dashboard | 5 min |
| 5 | Give GitHub the keys | GitHub | 5 min |
| 6 | First deploy | GitHub and the browser | 5 min |

Never paste keys into chats, issues or files. Copy each one straight from the dashboard that shows it into the place that needs it.

---

## How it fits together

```
Phone / browser ──HTTPS──▶ Cloudflare Workers                  (the app: HTML, JS, service worker)
       │
       ├──WebSocket──▶ https://<deployment>.convex.cloud      (queries and changes: the database)
       └──HTTPS─────▶ https://<deployment>.convex.site        (sign-in endpoints, ID photos)
```

The pipeline (`.github/workflows/deploy.yml`) runs on every push to `main`:

```
push to main ─▶ Typecheck and test ─▶ Convex deploy + app build ─▶ Cloudflare publish
                      │
                      └─ a failure stops here: the live site keeps the last good version
```

- Only `main` deploys. Other branches never deploy, and Cloudflare preview URLs are off (`"preview_urls": false` in `wrangler.jsonc`).
- Convex goes first, so the new app never talks to an old backend.
- Two deploys never run at the same time: a second push waits for the first one to finish.

---

## Part 1: Where settings live (read once, 5 min)

Settings live in four places. Each place has one job.

| Place | Holds | Secret? | Read by |
|---|---|---|---|
| `.env.local` (your computer) | Which Convex deployment your computer talks to | No, but it is never committed | `npm run dev`, `npx convex dev` |
| Convex dashboard › Environment Variables | Server secrets: `BETTER_AUTH_SECRET`, `SITE_URL`, `RESEND_API_KEY` | Yes | Convex functions |
| GitHub › Secrets and variables | The keys the pipeline uses to deploy | Yes | GitHub Actions |
| `.env.example` | A template listing the names, with no real values | No, committed | People |

### The `.env.local` file

- **Where:** in the project folder, next to `package.json`: `Acervus-Finance-PWA/.env.local`. The name starts with a dot, so file browsers hide it. In the terminal use `ls -a`. In VS Code it shows in the file explorer.
- **Who writes it:** `npx convex dev`. It creates and updates the file. You don't edit it by hand.
- **Is it safe:** git ignores it (`.env.*` in `.gitignore`), so it never reaches GitHub.

A correct file looks like this. Your deployment name will be different from `happy-otter-123`.

```
# Deployment used by `npx convex dev`
CONVEX_DEPLOYMENT=dev:happy-otter-123
VITE_CONVEX_URL=https://happy-otter-123.convex.cloud
VITE_CONVEX_SITE_URL=https://happy-otter-123.convex.site
```

| Line | Meaning |
|---|---|
| `CONVEX_DEPLOYMENT` | The deployment `npx convex dev` pushes your code to. The part before the colon tells you which kind it is (see the next table). |
| `VITE_CONVEX_URL` | Where the app in your browser sends its queries. Public: it ends up in the app's JavaScript. |
| `VITE_CONVEX_SITE_URL` | The same deployment, used for sign-in and photos. It ends in `.convex.site` instead of `.convex.cloud`. |

| `CONVEX_DEPLOYMENT` starts with | What it means | What to do |
|---|---|---|
| `dev:` | Your cloud development deployment | Correct. Nothing to do. |
| `anonymous:` or `local:` | A backend that only runs on this computer, left over from testing | Replace it: part 2, step 3. |
| `prod:` | Production | Wrong. Run part 2, step 3 again. Production values never belong in this file. |

Three rules:
1. The same deployment name appears in all three lines.
2. Production values never go in `.env.local`. The pipeline gives the production URL to the app build by itself.
3. If the file looks wrong, don't edit it. Run `npx convex dev --configure` and choose the right project.

### Development and production are separate

Each Convex project has two deployments: **Development** (your computer) and **Production** (the live app). They have separate data **and separate environment variables**. A switch at the top of the Convex dashboard selects which one you are looking at.

Setting a variable on Development does not set it on Production. This is the most common mistake. Before you add a variable, check the switch.

---

## Part 2: Run the app on your computer (10 min)

You need Node 22 or later, and a terminal open in the `Acervus-Finance-PWA` folder.

1. Create a free account at https://dashboard.convex.dev. Signing in with GitHub works.
2. Run `npm install`.
3. Run `npx convex login`. A browser tab opens. Approve it.
4. Run `npx convex dev --configure new`. When asked, pick your team and name the project `acervus-finance`. Wait for `Convex functions ready!`, then leave this terminal running.
5. Open `.env.local`. Check that `CONVEX_DEPLOYMENT` starts with `dev:` and that the same name appears in both URLs.
6. In the Convex dashboard, open `acervus-finance` and set the top switch to **Development**. Go to **Settings › URL & Deploy Key**. The Deployment URL shown there must be exactly `VITE_CONVEX_URL` from your `.env.local`.
7. On the same Settings screen, open **Environment Variables** and add these two. Then click **Save**.

   | Name | Value |
   |---|---|
   | `SITE_URL` | `http://localhost:5173` |
   | `BETTER_AUTH_SECRET` | The output of `openssl rand -base64 32` in a terminal |

8. Open a second terminal in the same folder and run `npm run dev`.
9. Open http://localhost:5173, type your email and click **Send code**.
10. Find the code in the first terminal: the line starts with `[email not sent: no RESEND_API_KEY]` and contains `CODE: 123456`. It is also under **Logs** in the dashboard. Type it into the app.

You're in. Every time after this, steps 4 and 8 are all you need: `npx convex dev` in one terminal and `npm run dev` in the other.

---

## Part 3: Prepare Cloudflare (10 min, dashboard only)

This part produces three things: your **app URL**, your **Account ID**, and an **API token**.

1. Sign in at https://dash.cloudflare.com.
2. In the left menu open **Compute (Workers) › Workers & Pages**.
3. In the **Account details** panel on the right, copy the **Account ID** into a temporary note. You'll need it in part 5.
4. In the same panel, find **Subdomain**. If none is set, click **Change** (or **Set up**) and choose one, for example `acervus`.
5. Write down your app URL: `https://acervus-finance-pwa.<subdomain>.workers.dev`. With the example above, that's `https://acervus-finance-pwa.acervus.workers.dev`.
6. Click your profile icon (top right), then **Profile › API Tokens › Create Token**.
7. Next to the **Edit Cloudflare Workers** template, click **Use template**.
8. Under **Account Resources**, select **Include** and your account. Under **Zone Resources**, select **All zones**. Click **Continue to summary**, then **Create Token**.
9. Copy the token. Cloudflare shows it only once. Keep that tab open until part 5.

Don't click **Connect to Git** or **Import a repository** in Workers & Pages. GitHub Actions does the deploying, and connecting both would deploy every push twice.

The Worker itself doesn't exist yet. The first deploy (part 6) creates it.

---

## Part 4: Prepare Convex production (5 min, dashboard only)

1. In the Convex dashboard, open `acervus-finance` and set the top switch to **Production**.
2. Go to **Settings › Environment Variables** and add these two. Then click **Save**.

   | Name | Value |
   |---|---|
   | `SITE_URL` | Your app URL from part 3, step 5. It starts with `https://` and has **no slash at the end**. |
   | `BETTER_AUTH_SECRET` | A **new** output of `openssl rand -base64 32`. Don't reuse the development one. |

3. Go to **Settings › URL & Deploy Key** and click **Generate Production Deploy Key**. Name it `github-actions` and copy it. Keep that tab open until part 5.

Until Resend is connected (see [Later](#later)), sign-in codes go to the production **Logs**. Anyone who can open this Convex project can then sign in as any user, so keep its team members to the people who run the business.

---

## Part 5: Give GitHub the keys (5 min)

The repository owner (`xvrobiinson`) must do this part. GitHub only lets the owner manage secrets.

1. Open https://github.com/xvrobiinson/Acervus-Finance-PWA, then **Settings › Secrets and variables › Actions**.
2. On the **Secrets** tab, click **New repository secret** once for each row:

   | Name | Value |
   |---|---|
   | `CONVEX_DEPLOY_KEY` | The deploy key from part 4, step 3 |
   | `CLOUDFLARE_API_TOKEN` | The token from part 3, step 9 |
   | `CLOUDFLARE_ACCOUNT_ID` | The Account ID from part 3, step 3 |

3. On the **Variables** tab, click **New repository variable**: name `SITE_URL`, value your app URL. GitHub uses it to link each deployment to the live site.
4. Delete the temporary note from part 3 and close the Cloudflare and Convex tabs.

---

## Part 6: First deploy (5 min)

1. On GitHub, open **Actions › Deploy › Run workflow**, keep branch `main`, then click **Run workflow**.
2. Wait for both jobs to turn green: **Typecheck and test**, then **Deploy to Convex and Cloudflare**. It takes about 4 minutes.
3. Open your app URL.
4. Type your email and click **Send code**. The code is in the Convex dashboard › **Production** › **Logs**: search for `CODE`.
5. Click **Create your business**. You are now its admin. Invite other people from **Settings › People**.

Done. From now on, every push to `main` goes live in about 4 minutes.

---

## Everyday use

| You want to | Do this |
|---|---|
| Release a change | Push or merge to `main`. |
| See whether it worked | GitHub › **Actions**. Green means it's live. Red means nothing changed on the live site: open the run and read the red step. |
| Try a failed run again | Open the run › **Re-run jobs**. |
| Undo a release | `git revert <commit>` and push. The pipeline deploys the previous code to both Convex and Cloudflare. |
| Change a server setting | Convex dashboard › **Production** › Settings › Environment Variables. It takes effect without a redeploy. |

Installed phone apps show "A new version is ready" with an Update button. Changes made offline are kept across updates (they live in IndexedDB).

### When the pipeline fails

| The red step says | Cause | Fix |
|---|---|---|
| `Missing GitHub secrets: ...` | A secret from part 5 is missing or misspelled | Add it, then re-run the job. |
| An error in **Typecheck and test** | The code has a type error or a failing test | Fix the code and push again. Nothing was deployed. |
| An error in **Deploy Convex and build the app** | The deploy key is wrong or was revoked | Part 4, step 3: generate a new key and replace `CONVEX_DEPLOY_KEY`. |
| `Authentication error` in **Publish the app** | The token is wrong, or the template didn't include your account | Part 3, steps 6 to 9: create a new token and replace `CLOUDFLARE_API_TOKEN`. |
| `register a workers.dev subdomain` | The account has no subdomain yet | Part 3, step 4. |

If the site loads but sign-in fails, `SITE_URL` in Convex **Production** doesn't exactly match the address bar. Check for `https://` and that there's no slash at the end.

---

## Later

### Email with Resend (codes sent by email)

Resend needs a domain you own. Until you have one, codes stay in the Convex logs.

1. Create an account at https://resend.com and add your domain under **Domains**. If the domain is on Cloudflare, Resend can add the DNS records for you.
2. Under **API Keys**, create a key.
3. In Convex › **Production** › Environment Variables, add:
   - `RESEND_API_KEY`: the key from step 2;
   - `EMAIL_FROM`: `Acervus Finance <no-reply@yourdomain.com>`.

No code change and no redeploy are needed. The next code is sent by email instead of being logged.

### Custom domain

1. In Cloudflare, open **Workers & Pages › acervus-finance-pwa › Settings › Domains & Routes › Add › Custom domain**. The domain must be on Cloudflare. The certificate is automatic.
2. Change `SITE_URL` to the new address in Convex **Production** and in the GitHub variable.

### Google sign-in

1. In Google Cloud, create an OAuth client of type "Web application":
   - authorized JavaScript origin: your app URL;
   - redirect URI: `https://<deployment>.convex.site/api/auth/callback/google`.
2. In Convex **Production**, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
3. In GitHub › Variables, add `VITE_GOOGLE_SIGN_IN` = `true`. Then run the Deploy workflow again.

The desktop app uses the same client: it opens the browser, and Google returns through the server to `public/desktop-sign-in.html`, which hands the one-time token to the app waiting on `127.0.0.1`. Nothing else to set up; the page has to be deployed for it to work.

### Tighter security headers

In `public/_headers`, replace `*.convex.cloud` and `*.convex.site` with your production deployment's exact host names, then push.

---

## Installing on phones

- **Android (Chrome):** open the URL › menu ⋮ › **Install app**.
- **iPhone/iPad (Safari):** open the URL › Share › **Add to Home Screen**. Install it, because iOS can clear offline data of sites that are only visited in the browser.
- Open the app online once on each device (to sign in and load the business) before it works offline.
- Receipts: tap **Print / PDF**. Android: choose "Save as PDF". iPhone: in the print preview, Share › Save to Files.

## Backups

Convex keeps the data. Admins can also use Settings › Data › Export CSV/JSON, and the Convex dashboard offers snapshot export and import for full backups.
