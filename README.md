This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Auth & Database (Milestone 5)

Compass now has real accounts, persistent profiles/activity, and
transactional email — see below for what changed and how to run it.

### Setup

```bash
# 1. install dependencies
npm install

# 2. create your local env file
cp .env.example .env.local
# fill in DATABASE_URL (default file:./dev.db is fine), AUTH_SECRET
# (openssl rand -base64 32), GOOGLE_CLIENT_ID/SECRET, RESEND_API_KEY,
# RESEND_FROM_EMAIL, RESEND_FROM_NAME — plus the existing DEEPSEEK_/
# EBAY_ keys from earlier milestones.

# 3. configure Google OAuth
# console.cloud.google.com -> APIs & Services -> Credentials -> OAuth
# client ID (Web application). Authorized redirect URI:
#   http://localhost:3000/api/auth/callback/google

# 4. configure Resend
# resend.com -> API Keys -> create key -> RESEND_API_KEY
# resend.com -> Domains -> verify a sending domain -> RESEND_FROM_EMAIL

# 5. initialize SQLite + 6. run migrations (one command)
npm run db:migrate

# optional: seed a demo user + profile
npm run db:seed

# 7. start the development server
npm run dev
```

Inspect the local database any time with `npm run db:studio` (Drizzle
Studio).

### Why Drizzle instead of Prisma

The original spec for this milestone asked for Prisma. Prisma's CLI and
client fetch prebuilt query/schema-engine binaries from
`binaries.prisma.sh` on `generate`/`migrate`, which is unreachable from
this project's CI/dev-container network policy in the environment this
milestone was built in (only npm/GitHub registries are reachable — see
the same class of constraint as the eBay Sandbox/DeepSeek egress notes
elsewhere in this README). **Drizzle ORM + better-sqlite3** satisfies
every requirement in the spec without needing an external binary
download: pure npm packages, a typed SQL schema, generated SQL
migrations (`npm run db:generate`), and a repository layer
(`src/lib/db/repositories/`) that keeps every UI/API caller from
touching the ORM directly — so a future move to Postgres (or even back
to Prisma) only touches `src/lib/db/`, not the rest of the app. If your
own environment can reach `binaries.prisma.sh`, Prisma remains a
reasonable swap; nothing else in the app depends on which ORM sits
behind the repository layer.

### Database schema summary

- **Auth.js tables** (`src/lib/db/schema/auth.ts`): `user`, `account`,
  `session`, `verificationToken` — shaped to match
  `@auth/drizzle-adapter`'s expectations exactly, plus `createdAt`/
  `updatedAt`/`lastLoginAt` on `user`.
- **`style_profile`**: one row per user, field-for-field the same shape
  as the existing `UserStyleProfile` type.
- **`viewed_product` / `saved_product` / `saved_look` /
  `preference_signal` / `event`**: user activity — the persisted twins
  of the existing localStorage-backed providers.
- **`seller`** and **`product`**: a persistent cache of real
  marketplace listings/sellers actually encountered by the app, unique
  on `(provider, providerSellerId)` / `(provider, providerItemId)`.
- **`look` / `look_product`**: generated looks and their real
  components — a look component with no resolvable product is never
  inserted (see `createLook` in
  `src/lib/db/repositories/look.ts`).

### Authentication flow

- **Google**: OAuth via Auth.js's Google provider. Google verifies
  email ownership before returning an id_token, so a Google sign-in
  automatically links to an existing account with the same email
  instead of erroring as a duplicate (`allowDangerousEmailAccountLinking:
  true` in `src/auth.ts` — safe specifically because Google's emails
  are pre-verified).
- **Email**: passwordless magic links via Auth.js's Resend provider.
  Links are single-use (the verification-token row is deleted on
  consumption) and expire after 15 minutes.
- **Sessions**: database-backed (not JWT) — required for the email
  provider anyway, and gives real, revocable session rows via
  Auth.js's own secure, httpOnly cookie handling.
- Every mutating API route derives the user id from `auth()`
  (`src/lib/auth/session.ts`) — a client can never supply its own
  `userId`.

### Resend email flow

`src/lib/email/resend.ts` wraps the Resend SDK; nothing else in the
app touches `RESEND_API_KEY` directly. `sendVerificationRequest` in
`src/auth.ts` calls it to send a Compass-branded HTML/text magic-link
email (`src/lib/email/templates/magicLink.ts`) with a clear CTA,
15-minute expiry notice, and a fallback plain-text link.

### Anonymous → authenticated merge

On first sign-in, `MergeOnSignIn` (mounted once in the root layout)
reads whatever the anonymous session accumulated in localStorage
(style profile, viewed products, saved products/looks, likes/dislikes,
events) and POSTs it to `/api/merge`, which runs
`mergeAnonymousState` (`src/lib/db/repositories/merge.ts`): a
field-level profile merge that never lets a stale local value
overwrite a newer authenticated one, plus idempotent inserts for every
activity log (safe to re-run). A localStorage flag keyed on the
signed-in user id prevents re-merging on every page load.

### Environment variables required

See `.env.example` for the full list — `DATABASE_URL`, `AUTH_SECRET`,
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`,
`RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`, plus the existing
`DEEPSEEK_*`/`EBAY_*` keys.

### Tests performed

`npm run verify:auth` covers, against a real temporary SQLite database
(migrated fresh, not mocked): profile upsert + field-level anonymous-
merge precedence (existing non-empty fields win unless the incoming
profile is actually newer), product/seller dedup on their unique
constraints, look persistence skipping components with no real
product, and idempotency of repeated activity inserts. `npm run
verify` runs this alongside every earlier milestone's verify script;
`npm run build` was also run clean (see "Known sandbox limitations"
below for what couldn't be exercised end-to-end inside this dev
environment).

### Known sandbox limitations

Same category of limitation as the DeepSeek/eBay Sandbox notes
elsewhere in this README: this project's dev sandbox cannot reach
Google's OAuth endpoints or the Resend API, so the live Google
sign-in redirect and actual email delivery could not be exercised
end-to-end from inside chat — only the pure/repository-level logic
above, plus `next build`'s static analysis of every new route. Test
both against your own Google OAuth client and Resend account.

## Product feedback (👍/👎)

Persistent, per-product like/dislike feedback, built on the existing
`preference_signal` table rather than a new system.

### What changed in the schema

`preference_signal` gained an `updatedAt` column and a **partial
unique index** on `(userId, productId)` — enforced only when
`productId` is set, so look-scoped rows (`lookId` set, `productId`
null) are completely unaffected. Product-scoped rows are now current
state (one row per user+product, upserted) instead of an insert-only
log. The migration backfills `updatedAt` and deduplicates any
pre-existing conflicting rows (keeping the most recent) before the
index is created — see `drizzle/0001_amazing_tombstone.sql`.

### API

`POST /api/activity/signals` — `{ productId, signal: "like" |
"dislike" }`. Upserts; clicking the already-active signal again clears
it back to neutral. Returns `{ signal: "like" | "dislike" | null }`.
`GET /api/activity/signals?productIds=id1,id2,...` — batch restore,
one query regardless of how many ids are requested, returns only the
caller's own signals: `{ signals: { id1: "like", ... } }`.
`DELETE /api/activity/signals` — `{ productId }`, explicit reset.

### UI

Both existing 👍/👎 locations (`ExploreLookCard.tsx`'s look-level
buttons and `/look/page.tsx`'s per-component buttons) now show real
active state, disable while a request is in flight, use
`stopPropagation`, and roll back optimistically-applied state on
failure. The Explore look-level buttons apply the persisted/restorable
state to the look's *primary* component product (its click already
fanned out to every component for the AI-context log — see below —
this only changes what drives the button's own visual/toggle state).
Guests get full client-side toggle behavior with zero network calls
and nothing persisted.

### Recommendations

A genuine (non-toggle-off) like/dislike still feeds the existing
localStorage-backed `usePreferenceSignals()` log that the AI look
generator already reads from — no second recommendation mechanism was
introduced.

### Tests

`npm run verify:signals` (27 checks): pure toggle-decision logic,
request validation, and repository behavior against a real temporary
migrated SQLite database (duplicate-click dedup, like↔dislike updates,
cross-user isolation, batch-restore correctness, the actual DB
constraint holding, look-scoped rows unaffected).

## eBay environment (why searches came back empty)

The eBay **Sandbox** Browse catalogue is a tiny synthetic test set — real
queries like "vintage Nike sneakers under $150" match zero listings there, and
sandbox test items also disappear, which is why item pages 404'd.

Browse API search is read-only, so it works against Production with the same
client-credentials app keys:

```
EBAY_ENV=production        # sandbox (default) | production
# EBAY_MARKETPLACE_ID=EBAY_US
```

Search also now retries with progressively looser constraints (drop condition
filter, drop price ceiling, drop extra keywords) before reporting no results,
and item lookup falls back to `get_item_by_legacy_id` for numeric eBay ids.

## NOWPayments (crypto payments) — Step 1: config/connectivity foundation

**No subscription or checkout flow exists yet.** This step only adds
configuration, a connectivity check, and an inert IPN-signature utility
for a later milestone to build the actual payment flow on top of.
Nothing here is reachable from the app's UI or any API route.

### What this added

- `src/lib/payments/nowpayments/env.ts` — env resolution
  (`getApiKey`/`getIpnSecret`/`apiBaseUrl`), `NowPaymentsConfigError`,
  and `checkNowPaymentsConfig()` (presence-only, never reads/logs a
  secret's actual value).
- `src/lib/payments/nowpayments/client.ts` — a thin authenticated fetch
  wrapper (mirrors `lib/ebay/client.ts`/`lib/ai/deepseek.ts`'s
  pattern) with `getApiStatus()` and `getSupportedCurrencies()`.
- `src/lib/payments/nowpayments/ipn.ts` — `verifyIpnSignature()`, a
  pure HMAC-SHA512 webhook-signature check per NOWPayments' documented
  IPN scheme. Not wired into any route — ready for whichever milestone
  builds the actual webhook handler.
- `src/instrumentation.ts` — a one-time, local-only (no network call)
  startup log reporting whether NOWPayments is configured, and which
  vars are missing if not. Runs on every boot; never logs secret
  values.
- `scripts/verify-nowpayments-connection.ts` (`npm run
  check:nowpayments`) — a one-off **live** connectivity check (not
  part of the `npm run verify` chain, since that suite never needs
  real credentials or network access). Confirms the configured base
  URL is reachable and that the API key actually authenticates
  (`/v1/currencies` 401s on a bad key, so success here is real proof).

### Environment variables required

See `.env.example`. Server-side only — **never** `NEXT_PUBLIC_*`.

```
NOWPAYMENTS_API_KEY=        # from your NOWPayments account dashboard
NOWPAYMENTS_IPN_SECRET=     # webhook signature secret — unused until a
                             # webhook route exists, but validated as
                             # "configured" already
# NOWPAYMENTS_API_URL=      # optional; defaults to the sandbox API.
                             # Set to https://api.nowpayments.io for
                             # production, paired with a production key.
```

### Sandbox vs. production

Sandbox (`https://api-sandbox.nowpayments.io`) and production
(`https://api.nowpayments.io`) are **separate NOWPayments accounts**
with separate API keys — not one key that works against both. Which
one you're pointed at is entirely determined by `NOWPAYMENTS_API_URL`
(mirrors `EBAY_API_BASE_URL`/`EBAY_ENV`'s pattern): unset defaults to
sandbox, so a deployment can never start hitting real payment
infrastructure just because this var was left unset. `apiBaseUrl()`
accepts the value either with or without a trailing `/v1` — NOWPayments'
own docs quote the base URL as `https://api.nowpayments.io/v1`, so
that form is normalized rather than rejected.

### NOWPayments API connection result

Verified live against the credentials configured for this deployment:
`GET /v1/status` returned `200 OK`, and `GET /v1/currencies`
authenticated successfully (234 currencies returned) — confirming the
configured `NOWPAYMENTS_API_KEY` is valid. The configured
`NOWPAYMENTS_API_URL` resolved to the **production** API
(`api.nowpayments.io`), not sandbox — worth confirming that's
intentional before building the actual payment flow against it.

### Explicitly not done in this step

No payment/checkout/subscription flow, no webhook route, no database
schema for payments/orders, no UI. `verifyIpnSignature()` exists but
has no caller. Auth, Notifications, Explore, Search, Overview, Profile,
eBay, Favorites, Saved, Recently Viewed, and referral logic were not
touched.
