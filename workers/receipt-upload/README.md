# Travel Expenses API (Cloudflare Worker)

Authenticated API for trips, expenses, receipt upload (R2), and batch sync.
Turso credentials stay server-side. Mobile never talks to Turso or R2 directly.

## Secrets

```bash
cd workers/receipt-upload
npx wrangler secret put TURSO_DATABASE_URL
npx wrangler secret put TURSO_AUTH_TOKEN
npx wrangler secret put GOOGLE_CLIENT_IDS
npx wrangler secret put GEMINI_API_KEY
```

`GOOGLE_CLIENT_IDS` is a comma-separated list of Google OAuth client IDs
(iOS, Android, and/or Web) whose ID tokens this Worker will accept.

`GEMINI_API_KEY` comes from [Google AI Studio](https://aistudio.google.com/apikey)
(free tier). Used only server-side for receipt field extraction.

Optional: set `GEMINI_MODEL` (default `gemini-2.0-flash`) via wrangler vars or `.dev.vars`.

## Deploy

```bash
npx wrangler deploy
```

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/health` | no |
| GET | `/me` | Bearer Google ID token |
| GET/POST | `/trips` | yes |
| GET/PATCH/DELETE | `/trips/:tripId` | yes |
| POST | `/trips/:tripId/expenses` | yes |
| PATCH/DELETE | `/trips/:tripId/expenses/:expenseId` | yes |
| POST | `/sync` | yes (batch upsert) |
| POST | `/receipts/extract` | yes (raw image/PDF body → Gemini: amount, date, from, to) |
| POST | `/receipts/upload` | yes (+ `X-Trip-Id`, `X-Expense-Id`) |
| GET | `/receipts/:key` | yes (owner only) |
| GET/POST | `/tax-work/expenses` | yes |
| PATCH/DELETE | `/tax-work/expenses/:expenseId` | yes |
| POST | `/tax-work/sync` | yes (batch upsert) |
| POST | `/tax-work/receipts/upload` | yes (+ `X-Expense-Id`) |
| GET | `/tax-work/years/hidden` | yes |
| PUT/DELETE | `/tax-work/years/:year/hidden` | yes (hide/restore) |
| DELETE | `/tax-work/years/:year` | yes (permanent year deletion) |

R2 binding: `RECEIPTS` → bucket `first-mobile-app`.

## Retention

- Business Travel and Tax / Work data have a minimum three-year retention policy.
- There is no scheduled age-based deletion job.
- Data remains available until the authenticated user explicitly deletes it.
- Manual trip deletion removes the trip's Turso rows and R2 prefix.
- Tax years may be hidden and restored; permanent year deletion removes every
  expense row and R2 receipt for that user and year.
