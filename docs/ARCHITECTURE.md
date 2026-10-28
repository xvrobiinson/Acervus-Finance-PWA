# Architecture: data, security, offline sync

## Data model (`convex/schema.ts`)

Every business record carries `businessId`.

- **Money** is whole cents (integers; products are computed in BigInt).
- **Rates** are parts per million.
- **Dates** are ISO days in the business's time zone.

| Table | Holds |
|---|---|
| `businesses` | Name, IANA time zone (defines "today" for due dates and late fees), record counter |
| `members` | User ↔ business with a role (`admin` / `collector` / `viewer`) |
| `invites` | Email, role, **SHA-256 of** a single-use 256-bit token, 7-day expiry |
| `settings` | Receipt details and toggles, wording (desktop's keys and encoding), currency and formats, defaults, logo |
| `clients` | Contact details, notes, archive flag, `photoId` (Convex storage) |
| `loans` | Terms, the stored schedule (edited or proposed), status |
| `loanStatusEvents` | Dated status history |
| `payments` | Amount, date, how to apply it (auto / installment / spread / custom), the engine's split (totals and per installment), offline flag |
| `lateFees` | One per overdue installment, with base, rate, amount and waiver |
| `capitalTxs`, `cashEntries` | Capital in and out; expenses, income, transfers, adjustments |
| `changeLog` | Every create, update and delete: fields old → new, reason, who, when, offline operation id |
| `operations` | Applied offline/online operation ids (idempotency) and loan versions |
| `rateLimits` | Fixed-window counters for app-level limits |

`recordNo` (per business, increasing) gives every record a human number (receipt No., loan #) and breaks ties between payments on the same date, just as the desktop's row ids did. Every record has a `version` that increases on each change.

### Mapping from the desktop (SQLite)

The desktop's tables map one to one:

- `loan_installments` → `loans.schedule`
- `payment_allocations` and `installment_allocations` → `payments.{principal,interest,fee,applied}`
- `payment_targets` → `payments.targets`
- `client_photos` → Convex storage
- `app_assets` (logo) → Convex storage
- `app_settings` → `settings`

Reversed payments from very old desktop versions have no counterpart. A migration would carry them as deleted records with a change-log entry.

## Financial correctness

- Every split, late fee, paid-off status and cash check is worked out **inside the mutation** with `shared/domain`, and the whole ledger is re-checked before commit.
- A change that would overpay, put a payment before the loan, or leave an account below zero at any point is **refused, and nothing is saved** (Convex mutations are transactions).
- The device runs the same engine for previews and offline display. The server never trusts a split sent by the device.
- An hourly job (`convex/crons.ts`) records late fees as they fall due, per business time zone. The figures on screen don't depend on it: the engine derives fees on the fly.

## Authentication and authorization

- Better Auth through `@convex-dev/better-auth` 0.12.6 / `better-auth` 1.6.33, set up as in the official React SPA guide (`crossDomain` and `convex` plugins).
- Passwordless email codes (`emailOTP` plugin): 6 digits, valid 10 minutes, 3 tries per code, stored hashed, single use. The first sign-in with an address creates the account; entering the code proves the address. Without Resend the code goes to the Convex log (`convex/lib/email.ts`). Sessions last 14 days; the Convex JWT lives 15 minutes.
- **Rate limits:**
  - Per account (email), always: code checks 10 / 15 min, code requests 10 / h (`convex/auth.ts`).
  - Per IP: only when the request carries a client IP header.

  *Verified on the local backend:* Convex HTTP actions did not pass a client IP. Better Auth's default would then put every user in one shared bucket per path, which would let one person lock everyone out. The per-IP rules therefore return `false` (skip) when no IP is present.
- App limits: 3 new businesses per user per day; 30 invitations per business per day; invitation acceptance 20 / h per user.
- **Every** query and mutation calls `requireMember(ctx, businessId, need)`:

  | Need | Roles | Covers |
  |---|---|---|
  | `read` | all roles | |
  | `record` | admin, collector | new clients, payments, expenses, income |
  | `manage` | admin | loans, capital, transfers, adjustments, edits, deletes, waivers, defaults, settings, members, ID photos |

  Records are checked to belong to the caller's business (`ownRecord`), and the error is the same whether a business is missing or simply not yours. Hiding buttons is only a convenience.
- **Initial admin:** whoever creates a business becomes its only admin. There is no default account, hard-coded password or public admin route. A business can never lose its last admin.
- ID photos are stored in Convex storage and served **only** through `GET /client-photo` on the HTTP actions URL. It requires the admin's JWT, answers `Cache-Control: no-store`, and is never a public storage URL. Photos are never cached offline, exported or printed.
- Browser: a strict CSP in `public/_headers`:
  - no inline scripts;
  - `connect-src` limited to Convex;
  - `frame-ancestors 'none'`;
  - HSTS, `nosniff`, `no-referrer`.

  The session token is kept in `localStorage` (that is how the official cross-domain plugin works), so the CSP is the main protection against token theft. Sign-out clears it, together with the offline copy of the business.

## Offline: what works and how it is kept safe

| Category | Where | Notes |
|---|---|---|
| 1. App files | Service worker precache (Workbox) | Whole app, fonts and icons; updates are offered, never forced |
| 2. Previously loaded data | IndexedDB `snapshots`, per user and business | The last live copy; screens say "Offline · copy from <time>" |
| 3. New changes made offline | IndexedDB `outbox` | Status **pending** |
| 4. Changes the server applied | `outbox` status **synced** | Kept 14 days as a visible receipt, then pruned |
| 5. Changes refused or in conflict | `outbox` status **needs review** | Shown in Sync and in a banner; never retried or dropped on their own |

**Allowed offline** (your choice): new clients, payments, expenses, income. **Online only:** new loans (they move money between accounts), every edit and deletion, settings, late-fee waivers, defaults, members and ID photos. The UI disables these offline, and the server would refuse a stale edit anyway.

### The outbox (`src/offline/outbox.ts`)
- Each change gets a device-generated UUID (`opId`) and an increasing sequence number, and is written to IndexedDB **before** anything is sent. Ops are sent in order, one at a time, under a cross-tab lock (`navigator.locks`).
- **Idempotent:** the server stores every applied `opId` (`operations`) and answers a repeat with the first result. A lost reply or a double tap can never record a payment, expense or income twice.
- Network failure or timeout: stays pending and is retried when the connection returns, when the app comes to the front, and every 30 s.
- Session expired: stays pending; a banner asks to sign in; it is sent afterwards. Ops belong to the user who made them and are only sent under that user.
- Refused by a rule (overpayment, insufficient cash, role changed, record gone…): **needs review**. The person can fix and retry, or discard. A discard is journaled on the device.
- Sign-out with unsynced changes asks first, and the changes stay on the device for that user's next sign-in.
- Online saves go through the same path. A refusal while the person is still on the form is shown inline and not queued.

### Conflicts between devices
- **Payments entered against an out-of-date loan.** A payment carries the loan `version` the person saw. If the loan changed since (typically another collector recorded a payment), the server answers **stale** with the latest payments. The person reviews the loan and either confirms ("Record anyway", sent with `confirmedStale`) or discards. Your own earlier queued payment on the same loan doesn't count as a conflict: the device carries the version forward (`loanVersionBefore/After`).
- **Edits** (online only) name the `version` they started from. If it no longer matches, the edit is refused (**conflict**) and the person sees the current values. Last-writer-wins never happens silently.
- **Splits and balances** are always recomputed by the server from all payments in date order. A payment synced late can change how *later* payments split (as on the desktop when a backdated payment is added). The change log records it.
- **Clients** created offline on two devices for the same person become two clients. An admin can merge them by moving loans and deleting the duplicate.

### Things offline mode deliberately doesn't do
- Figures shown offline come from the last copy; queued payments are listed as pending and **not** added into balances until the server accepts them.
- A receipt can't be printed for a payment until it has synced, because the receipt number and split come from the server.
- Late fees that fall due while offline appear once the app is online.
