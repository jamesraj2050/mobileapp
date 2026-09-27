# README1 — Technical Assessment & Google Auth Plan

Assessment date: 27 Sep 2026  
Purpose: Hand-off document for a later agent to implement Google authentication without breaking existing Turso or Cloudflare R2 integrations.

**Status at assessment time:** App is already developed. Do not treat this as a greenfield project.

---

## 0. Already implemented (do not replace)

| Layer | Status |
|---|---|
| React Native | Implemented |
| Expo | Implemented (SDK ~57) |
| Expo Router | Implemented |
| TypeScript | Implemented |
| Turso database | Implemented |
| Cloudflare R2 (via Worker) | Implemented |

**Rules for follow-up work**

- Prefer additive changes (migrations, new screens, wrappers).
- Do not rip out Turso or R2.
- Do not put R2 Access Key / Secret Access Key into Expo `.env`.
- Auth should happen **before** Create Trip / Save Expense / Upload Receipt (required for paid multi-user).

---

## 1. Current project structure

```
my-first-app/
├── app.json
├── package.json
├── tsconfig.json
├── .env                          # local secrets (gitignored)
├── .env.example
├── AGENTS.md
├── README.md
├── README1.md                    # this file
├── assets/
├── scripts/
│   └── reset-project.js
├── src/
│   ├── app/                      # Expo Router screens
│   │   ├── _layout.tsx
│   │   ├── index.tsx             # My Trips
│   │   ├── create-trip.tsx
│   │   └── trip/[id]/
│   │       ├── index.tsx         # Trip expenses
│   │       ├── add.tsx           # Add expense
│   │       ├── receipt.tsx       # Confirm + upload
│   │       └── review.tsx        # Review / finish
│   ├── components/
│   ├── constants/
│   ├── context/
│   │   └── trip-context.tsx
│   ├── db/
│   │   └── turso.ts              # Turso HTTP pipeline + schema
│   ├── hooks/
│   ├── services/
│   │   └── receipt-upload.ts     # Client → Worker upload
│   ├── storage/
│   │   └── trips.ts              # Trip/expense CRUD
│   ├── types/
│   │   └── expense.ts
│   └── utils/
└── workers/
    └── receipt-upload/           # Cloudflare Worker → R2
        ├── wrangler.toml
        ├── package.json
        ├── README.md
        └── src/index.ts
```

---

## 2. Versions

| Package | Version |
|---|---|
| Expo SDK | `~57.0.25` |
| React Native | `0.86.3` |
| React | `19.2.3` |
| Expo Router | `~57.0.23` |
| TypeScript | `~6.0.3` |
| `@libsql/client` | `^0.18.0` (dependency present; runtime queries use custom HTTP in `turso.ts`) |
| `expo-image-picker` | `~57.0.20` |
| `expo-document-picker` | `~57.0.2` |

Useful commands:

```bash
cd "/Users/apple/Documents/AI Business related/mobileapp/my-first-app"
npx expo start
npx expo start --clear
npx expo start --web
npx tsc --noEmit
npx expo lint
npx expo-doctor
```

---

## 3. Expo Router structure

Root layout: `src/app/_layout.tsx`

- Wraps app in `TripProvider`
- Uses a single **Stack** navigator (no tabs)

| File | Screen | Notes |
|---|---|---|
| `src/app/index.tsx` | My Trips | Home; create via `+` |
| `src/app/create-trip.tsx` | Create Trip | Modal presentation |
| `src/app/trip/[id]/index.tsx` | Trip Expenses | Total, list, add |
| `src/app/trip/[id]/add.tsx` | Add Expense | Type/date/amount/receipt |
| `src/app/trip/[id]/receipt.tsx` | Receipt Confirm | Edit amount; upload to R2 |
| `src/app/trip/[id]/review.tsx` | Review Trip | Finish trip (local status only) |

Deep link scheme: `myfirstapp` (`app.json`).

---

## 4. Turso integration

### How it works

1. `src/db/turso.ts` talks to Turso over HTTPS (`/v2/pipeline`).
2. Converts `libsql://` → `https://`.
3. Sends `Authorization: Bearer <EXPO_PUBLIC_TURSO_AUTH_TOKEN>`.
4. `ensureSchema()` creates tables if missing.
5. `src/storage/trips.ts` performs load/insert/update.
6. `src/context/trip-context.tsx` owns in-memory state + pending receipt handoff.

### Where connection is configured

| Location | Role |
|---|---|
| `.env` | `EXPO_PUBLIC_TURSO_DATABASE_URL`, `EXPO_PUBLIC_TURSO_AUTH_TOKEN` |
| `src/db/turso.ts` | Reads env, builds pipeline requests |
| `src/storage/trips.ts` | SQL CRUD |
| `src/context/trip-context.tsx` | App-facing API |

### Current schema / relationships

```sql
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY NOT NULL,
  from_city TEXT NOT NULL,
  to_city TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,          -- 'active' | 'finished'
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY NOT NULL,
  trip_id TEXT NOT NULL,         -- logical FK → trips.id
  type TEXT NOT NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  receipt_uri TEXT,
  receipt_status TEXT NOT NULL,  -- 'attached' | 'missing'
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_trip_id ON expenses(trip_id);
```

**Relationship:** `expenses.trip_id` → `trips.id`  
**Missing for multi-user:** no `user_id` / accounts table.  
**Current load:** `SELECT * FROM trips` / `SELECT * FROM expenses` (global, not scoped).

### Turso commands (ops / verification)

```bash
# From project root — smoke test without printing secrets
node -e "
const fs=require('fs');
const env=Object.fromEntries(fs.readFileSync('.env','utf8').split(/\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()] }));
const { createClient } = require('@libsql/client');
(async()=>{
  const c=createClient({url:env.EXPO_PUBLIC_TURSO_DATABASE_URL, authToken:env.EXPO_PUBLIC_TURSO_AUTH_TOKEN});
  const t=await c.execute('SELECT count(*) as n FROM trips');
  const e=await c.execute('SELECT count(*) as n FROM expenses');
  console.log('trips', t.rows[0].n, 'expenses', e.rows[0].n);
})();
"
```

---

## 5. Cloudflare R2 integration

### How it works

- Expo app does **not** use R2 S3 Access Key / Secret.
- `workers/receipt-upload` Cloudflare Worker binds R2 bucket `first-mobile-app` as `RECEIPTS`.
- Client uploads via shared header secret `X-Upload-Secret`.

### Where config is stored

| Secret / config | Where |
|---|---|
| R2 bucket binding | `workers/receipt-upload/wrangler.toml` → `bucket_name = "first-mobile-app"` |
| `UPLOAD_SECRET` | Cloudflare Worker secret (`wrangler secret put`) |
| Worker public URL | Expo `.env` → `EXPO_PUBLIC_RECEIPT_UPLOAD_URL` |
| Same secret mirrored for client | Expo `.env` → `EXPO_PUBLIC_RECEIPT_UPLOAD_SECRET` |

**Important:** R2 Access Key ID / Secret Access Key / S3 endpoint are **not** required in Expo `.env` for the current design.

### Worker endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/upload` | Upload image or PDF body; returns `{ key, url }` |
| `GET` | `/receipts/<key>` | Serve stored object |
| `GET` | `/` | Health / endpoint list JSON |
| `OPTIONS` | `*` | CORS |

Accepts: `image/*`, `application/pdf`, `application/octet-stream`.

### Receipt upload flow (app)

1. Camera (`expo-image-picker`) **or** document picker (`expo-document-picker`, images + PDF).
2. Navigate to `trip/[id]/receipt`.
3. User confirms amount.
4. `uploadReceiptToR2()` in `src/services/receipt-upload.ts` POSTs file to Worker.
5. Remote URL stored via `setPendingReceipt` in context.
6. Add Expense screen applies pending receipt → `receiptUri` / `receiptStatus: 'attached'`.
7. Save expense writes `receipt_uri` to Turso.

### Worker commands

```bash
cd "/Users/apple/Documents/AI Business related/mobileapp/my-first-app/workers/receipt-upload"
npm install
npx wrangler login
npx wrangler whoami
npx wrangler secret put UPLOAD_SECRET
npx wrangler deploy
```

Deployed URL (as of assessment):

```text
https://receipt-upload.jamesraj2050.workers.dev
```

After changing Worker code:

```bash
cd workers/receipt-upload && npx wrangler deploy
```

After changing Expo `.env`:

```bash
cd "/Users/apple/Documents/AI Business related/mobileapp/my-first-app"
npx expo start --clear
```

---

## 6. Data models (`src/types/expense.ts`)

### Trip

- `id: string`
- `from`, `to: string`
- `startDate`, `endDate: string` (YYYY-MM-DD)
- `name: string`
- `status: 'active' | 'finished'`
- `expenses: Expense[]`
- `createdAt: string`

### Expense

- `id: string`
- `type: ExpenseType` (flight, car, taxi, meal, lunch, dinner, bus, parking, other)
- `date: string`
- `amount: number`
- `description: string`
- `receiptUri: string | null`
- `receiptStatus: 'attached' | 'missing'`
- `createdAt: string`

### Pending receipt (context only)

- `tripId`, `receiptUri`, `amount` — handoff after R2 upload; not persisted alone.

---

## 7. Authentication & user concept (current)

| Question | Answer |
|---|---|
| Google auth? | **No** |
| Login / session? | **No** |
| `user_id` on trips/expenses? | **No** |
| Accounts table? | **No** |
| Subscription / billing? | **No** |

Only “auth” today:

- Turso DB token (client-embedded `EXPO_PUBLIC_…`)
- Shared Worker upload secret (also `EXPO_PUBLIC_…`)

---

## 8. API / server-side routes

| Surface | Routes |
|---|---|
| Expo Router app | Screen routes only — **no** API route handlers |
| Cloudflare Worker | `POST /upload`, `GET /receipts/<key>` |
| Turso | Remote SQL over HTTP from the **client** |

---

## 9. Environment variables (names only — never commit values)

### Expo `.env`

- `EXPO_PUBLIC_TURSO_DATABASE_URL`
- `EXPO_PUBLIC_TURSO_AUTH_TOKEN`
- `EXPO_PUBLIC_RECEIPT_UPLOAD_URL`
- `EXPO_PUBLIC_RECEIPT_UPLOAD_SECRET`

### Worker (Cloudflare)

- `UPLOAD_SECRET` (Wrangler secret)
- R2 binding `RECEIPTS` → bucket `first-mobile-app`

### Correct receipt URL shape

```bash
# Correct (base URL only — app appends /upload)
EXPO_PUBLIC_RECEIPT_UPLOAD_URL=https://receipt-upload.jamesraj2050.workers.dev

# Wrong (placeholder / path)
EXPO_PUBLIC_RECEIPT_UPLOAD_URL=https://your-worker.workers.dev/upload-url
```

---

## 10. Product / commercial context (for auth design)

Planned subscription:

- **$4 / month** billed monthly, or
- **$2 / month** equivalent if paid annually

Implication: identity must exist **before** durable writes and uploads.

**Recommended UX:** Google sign-in first (or immediately before first write), not “fill form then auth at save”.

---

## 11. What must change for safe Google authentication

### Risks if auth is bolted on naively

1. Shared Turso token in the client can read/write **all** trips.
2. No per-user filtering (`SELECT * FROM trips`).
3. Shared upload secret allows anyone with the app build to upload.
4. Receipt GET URLs are weakly protected (URL knowledge ≈ access).
5. Subscription cannot attach to an anonymous device.

### Files likely affected (implementation later)

**Auth / navigation**

- `src/app/_layout.tsx`
- New: `src/app/(auth)/login.tsx` (or similar)
- New: `src/context/auth-context.tsx` (or provider from Clerk/Supabase/Firebase)
- `app.json` (scheme, Google/OAuth plugin config)

**Turso**

- `src/db/turso.ts` (schema migration: `user_id`)
- `src/storage/trips.ts` (scoped queries)
- `src/types/expense.ts` (`userId` on Trip / Expense)
- `src/context/trip-context.tsx` (pass user into CRUD)

**R2 Worker**

- `workers/receipt-upload/src/index.ts` (JWT verify; path prefix `receipts/{userId}/…`)
- `workers/receipt-upload/wrangler.toml` (if new env/bindings)
- `src/services/receipt-upload.ts` (send Bearer token instead of shared secret)

**Env / docs**

- `.env.example`
- `workers/receipt-upload/README.md`
- Possibly this `README1.md` update after implementation

**Package.json** (when implementing — not done in assessment)

- Auth SDK (e.g. `@supabase/supabase-js`, Clerk, or Firebase)
- Expo auth helpers as needed (`expo-auth-session`, `expo-web-browser` already present)

---

## 12. Recommended implementation plan

Do **not** break existing Turso or R2. Extend them.

### Phase A — Identity

1. Choose provider (recommendation: **Supabase Auth** with Google; alternatives Clerk / Firebase).
2. Add Google OAuth client IDs (iOS / Android / Web as needed).
3. Add `AuthProvider` + login screen.
4. Gate app stack: signed-in required before My Trips writes (at minimum before Create Trip / Add Expense / Upload).
5. Persist session across relaunches.

### Phase B — Turso per-user isolation (additive)

1. Migration:

```sql
ALTER TABLE trips ADD COLUMN user_id TEXT;
-- backfill strategy for existing rows (assign owner or quarantine)
CREATE INDEX IF NOT EXISTS idx_trips_user_id ON trips(user_id);
```

2. Optionally add `user_id` on `expenses` (or rely on trip ownership).
3. Update:

```sql
SELECT * FROM trips WHERE user_id = ? ORDER BY created_at DESC;
INSERT INTO trips (..., user_id) VALUES (..., ?);
```

4. Longer-term (safer): move Turso writes behind an authenticated Worker/Edge API so the DB token is not embedded in the app. Short-term client Turso is acceptable only with strict `user_id` filtering and acceptance of token exposure risk.

### Phase C — R2 hardening (keep Worker + bucket)

1. Object keys: `receipts/{userId}/{uuid}.{ext}`.
2. Replace `X-Upload-Secret` with verified **Google/Supabase JWT** (`Authorization: Bearer …`).
3. Authorize `GET /receipts/...` the same way (or short-lived signed URLs).
4. Keep R2 **binding**; do not add R2 Access Key to Expo `.env`.

### Phase D — Subscription

1. After login, check entitlement (RevenueCat and/or Stripe).
2. Plans: `$4/mo` monthly or annual equivalent `$2/mo`.
3. Paywall before active use; bind entitlement to auth `user_id`.

### Safe order

```text
Google login
  → user_id on Turso
  → scoped R2 paths + JWT on Worker
  → subscription / paywall
```

---

## 13. Suggested commands checklist for the implementing agent

```bash
# App
cd "/Users/apple/Documents/AI Business related/mobileapp/my-first-app"
npx expo start --clear
npx tsc --noEmit
npx expo lint

# Worker
cd workers/receipt-upload
npx wrangler deploy
npx wrangler secret list

# Git (only if user requests commit)
git status
git diff
```

Install packages **only when implementing** (not during assessment). Example (Supabase path — confirm against current Expo SDK docs before installing):

```bash
npx expo install expo-auth-session expo-crypto
# plus provider SDK as chosen
```

Always re-check Expo SDK 57 docs before adding auth packages:

- https://docs.expo.dev/llms.txt
- https://docs.expo.dev/versions/v57.0.0/

---

## 14. Concise verdict

The Travel Expense Capture app is a working **single-tenant** Expo Router client that:

- Persists trips/expenses in **Turso** from the device.
- Stores receipts in **Cloudflare R2** via a dedicated Worker.
- Has **no** user accounts, Google login, or subscription gating yet.

To add Google authentication safely for a paid multi-user product: introduce identity first, then scope Turso rows and R2 objects by `user_id`, then harden the Worker to JWT auth, then add billing — without replacing Turso or R2.
