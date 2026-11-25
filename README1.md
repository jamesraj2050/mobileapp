# README1 — Travel Expenses: Architecture, Changes & Commands

Updated: 30 Sep 2026  
Purpose: Hand-off document for the **implemented** local-first + Google Auth + Cloudflare Worker API architecture, including Gemini receipt extraction.

**Product priority:** ~15-second receipt/expense capture · offline-tolerant · cloud sync in background · AI prefill when possible.

---

## 0. Architecture (current)

```
MOBILE APP (Expo)
  ├─ Google sign-in (expo-auth-session ID token)
  ├─ Secure session (expo-secure-store)
  ├─ Local-first trips/expenses (AsyncStorage, per userId)
  ├─ Place memory (per-user From/To suggestions)
  ├─ Instant UI save
  └─ Background sync engine
           │
           ▼  Authorization: Bearer <Google ID token>
CLOUDFLARE WORKER  (receipt-upload.jamesraj2050.workers.dev)
  ├─ Verify JWT (jose + Google JWKS)
  ├─ users upsert by google_sub → users.id
  ├─ User-scoped Turso SQL
  ├─ Authenticated R2 put/get
  └─ POST /receipts/extract → Gemini (type, from, to, date, amount)
           │
     ┌─────┼─────────┐
     ▼     ▼         ▼
   TURSO  R2      Gemini API
 metadata receipts  (server-side key only)
```

**Hard rules**

- Mobile must **not** contain Turso URL/token, R2 secrets, or `GEMINI_API_KEY`.
- Cloud sync / AI extract must **not** block SAVE.
- Every API/DB/R2 operation is scoped to the authenticated `users.id`.
- Legacy Turso rows without `user_id` are preserved, not auto-assigned.

---

## 1. Project structure (after changes)

```
my-first-app/
├── app.json
├── package.json
├── eas.json
├── .env                          # gitignored
├── .env.example
├── README1.md                    # this file
├── src/
│   ├── app/
│   │   ├── _layout.tsx           # AuthProvider → TripProvider → TaxWorkProvider → Stack
│   │   ├── index.tsx             # Login + My Trips (+ next to title)
│   │   ├── create-trip.tsx       # Auto trip name + place memory / suggestions
│   │   ├── tax-work/              # Year list, capture, year detail, receipt edit
│   │   └── trip/[id]/
│   │       ├── index.tsx         # ADD EXPENSE, list, receipt view (no Close Trip)
│   │       ├── add.tsx           # Receipt first → AI fill → type details → save
│   │       ├── receipt.tsx       # Legacy quick confirm + AI amount
│   │       └── review.tsx        # Finish Trip (marks finished)
│   ├── auth/
│   │   └── session.ts
│   ├── context/
│   │   ├── auth-context.tsx
│   │   ├── trip-context.tsx
│   │   └── tax-work-context.tsx
│   ├── db/
│   │   └── turso.ts              # Stub — no direct Turso from app
│   ├── services/
│   │   ├── api.ts                # Worker client + extractReceiptFields
│   │   ├── sync.ts
│   │   ├── tax-work-sync.ts
│   │   └── receipt-upload.ts     # Deprecated stub
│   ├── storage/
│   │   ├── local-store.ts
│   │   ├── tax-work-store.ts
│   │   ├── places.ts             # Per-user remembered From/To places
│   │   └── trips.ts
│   ├── types/expense.ts
│   ├── constants/expense-types.ts
│   └── utils/format.ts           # generateTripName, formatPlaceName, …
└── workers/receipt-upload/
    ├── wrangler.toml
    ├── .dev.vars.example
    ├── README.md
    └── src/
        ├── index.ts              # API router (+ /receipts/extract)
        ├── auth.ts
        ├── gemini.ts             # Vision extract + PDF Files API
        ├── schema.ts
        └── turso.ts
```

---

## 2. Files created

| File | Role |
|---|---|
| `src/auth/session.ts` | Persist Google ID token + user in SecureStore |
| `src/context/auth-context.tsx` | Google OAuth + session |
| `src/services/api.ts` | Authenticated Worker client; receipt extract/upload/view |
| `src/services/sync.ts` | Metadata sync → R2 upload → receipt_key sync |
| `src/storage/local-store.ts` | `local_trips_v2:{userId}` store |
| `src/storage/places.ts` | Place memory + best-guess From/To |
| `workers/receipt-upload/src/auth.ts` | JWT verify + `getOrCreateUser` |
| `workers/receipt-upload/src/schema.ts` | Turso migrations |
| `workers/receipt-upload/src/turso.ts` | Server Turso HTTP client |
| `workers/receipt-upload/src/gemini.ts` | Gemini extract (type/from/to/date/amount) |
| `workers/receipt-upload/.dev.vars.example` | Local Worker secrets template |
| `eas.json` | EAS project config |

---

## 3. Notable app UX (current)

| Area | Behaviour |
|---|---|
| **Create Trip** | Placeholders `eg:Brisbane` / `eg:Perth`; auto-fills best-guess places; suggestion chips; trip name auto from From+To+Start until manually edited; place names Title Case |
| **Trip screen** | **+ ADD EXPENSE** only. Finish via **Review → Finish Trip** (Close Trip removed from this screen) |
| **Add Expense** | Receipt **first** (Scan / Photo \| PDF). AI selects **Type** and fills fields; then editable form |
| **AI fill — travel** (flight/car/taxi/bus/train) | Type, From, To, Date, Amount |
| **AI fill — meal / accommodation / parking** | Type, Date, Amount (+ hotel/merchant when found) |
| **Travel time** | Removed (not captured) |

---

## 4. Packages

**App (`npx expo install …`)**

| Package | Purpose |
|---|---|
| `expo-auth-session` | Google OAuth |
| `expo-crypto` | Device UUIDs |
| `expo-secure-store` | Session storage |
| `expo-file-system` | Local receipt persistence |
| (already present) `expo-web-browser`, `expo-document-picker`, `expo-image-picker`, AsyncStorage | — |

**Removed from app:** `@libsql/client` (no direct Turso from mobile).

**Worker:** `jose` (Google ID token verify). Gemini called via REST (no SDK).

---

## 5. Database schema (Turso via Worker)

```sql
users (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT,
  name TEXT,
  created_at TEXT,
  updated_at TEXT
)

trips.user_id, trips.updated_at
expenses.user_id, expenses.updated_at
expenses.receipt_key
expenses.receipt_detected_amount
expenses.local_receipt_uri
expenses.details_json          -- type-specific fields JSON

INDEX idx_trips_user_created ON trips(user_id, created_at)
INDEX idx_expenses_user_trip ON expenses(user_id, trip_id)
```

Legacy rows without `user_id` are left unassigned (not auto-claimed).

---

## 6. API endpoints (Worker)

| Method | Path | Auth |
|---|---|---|
| GET | `/health` | no |
| GET | `/me` | Bearer Google ID token |
| GET / POST | `/trips` | yes |
| GET / PATCH / DELETE | `/trips/:tripId` | yes |
| POST | `/trips/:tripId/expenses` | yes |
| PATCH / DELETE | `/trips/:tripId/expenses/:expenseId` | yes |
| POST | `/sync` | yes (batch upsert) |
| POST | `/receipts/extract` | yes (raw image/PDF body → Gemini JSON) |
| POST | `/receipts/upload` | yes + `X-Trip-Id`, `X-Expense-Id` |
| GET | `/receipts/:key` | yes (owner only) |

Deployed URL: `https://receipt-upload.jamesraj2050.workers.dev`

### Receipt AI (`POST /receipts/extract`)

1. Authenticate user (same Google JWT).
2. Sniff MIME from magic bytes (`%PDF`, JPEG, PNG, …) — avoids treating PDFs as JPEG when the client sends `octet-stream`.
3. PDFs: upload via Gemini **Files API**, then `generateContent`.
4. Images: inline base64 (with model fallbacks if a model is retired).
5. Returns `{ extraction: { type, amount, date, from, to, merchant } }`.
6. Failure never blocks save — app shows a short hint; fields stay editable.

Default model: `gemini-2.5-flash` (fallbacks: `gemini-3.1-flash-lite`, `gemini-3.5-flash`, `gemini-flash-latest`).

---

## 7. Local storage & sync

### Local keys

- Trips: `local_trips_v2:{userId}`
- Places: `place_memory_v1:{userId}`
- Legacy `local_trips_v1` cleared on load
- Receipts: `documentDirectory/receipts/{userId}/{expenseId}.{ext}`

### Sync order

1. Upsert trip/expense metadata (`POST /sync`)  
2. Upload pending receipt binaries to R2  
3. Upsert again so `receipt_key` is stored  

Statuses: `pending` → `syncing` → `synced` | `failed` (glyphs ✓ / ↻ / ⚠).  
Client UUIDs make sync idempotent.

### Retention policy

- Business Travel and Tax / Work records have a three-year minimum retention policy.
- Records remain available beyond three years until the user explicitly deletes them.
- There is no scheduled age-based deletion job.
- Deleting a Business Travel trip permanently removes its expenses and R2 receipts.
- Tax years can be hidden, restored, or permanently deleted with confirmation.

---

## 8. Authentication

### Mobile

1. **Continue with Google** → ID token  
2. `GET /me` creates/loads `users` row  
3. Session in SecureStore (`auth_session_v1`)

### Worker

- Verifies JWKS, issuer, audience (`GOOGLE_CLIENT_IDS`), expiry  
- Maps `google_sub` → `users.id`

### App IDs

| Platform | Identifier |
|---|---|
| iOS / Android | `com.arkconsultinggroup.travelexpenses` |
| URL scheme | `myfirstapp` |

---

## 9. Environment variables

### Mobile `.env` (public only)

```bash
EXPO_PUBLIC_API_URL=https://receipt-upload.jamesraj2050.workers.dev
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=....apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=....apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=....apps.googleusercontent.com
```

**Never in the app:** Turso URL/token, R2/upload secrets, `GEMINI_API_KEY`.

### Worker secrets

```bash
cd workers/receipt-upload
npx wrangler secret put TURSO_DATABASE_URL
npx wrangler secret put TURSO_AUTH_TOKEN
npx wrangler secret put GOOGLE_CLIENT_IDS   # comma-separated OAuth client IDs
npx wrangler secret put GEMINI_API_KEY      # from https://aistudio.google.com/apikey
```

Optional: `GEMINI_MODEL` (default `gemini-2.5-flash`).  
Local: copy `.dev.vars.example` → `.dev.vars`.

---

## 10. UX flows

### My Trips

- Google login gate · **+** beside title · Sign out · per-user list + sync glyph

### Trip screen

- **+ ADD EXPENSE**  
- Row: date · type · summary · amount · receipt icon · sync  
- Finish trip from **Review** (not a Close button on this screen)

### Add Expense

1. **Scan** or **Photo | PDF / File** (split control)  
2. AI reads receipt → selects Type + fills Date/Amount (and From/To for travel)  
3. User edits anything wrong  
4. **SAVE EXPENSE** — local first, background sync  

### Create Trip

1. From / To (auto-guess + chips) · Start / End dates  
2. Trip name auto: `Brisbane_to_Melbourne_29Sep2026` until manually edited  
3. Create → open trip  

---

## 11. Commands cheat-sheet

### App

```bash
cd "/Users/apple/Documents/AI Business related/mobileapp/my-first-app"

npx expo start --clear
npx expo start --web --port 8081

npx tsc --noEmit
npx expo lint
```

### Worker

```bash
cd workers/receipt-upload
npm install
npx wrangler secret put TURSO_DATABASE_URL
npx wrangler secret put TURSO_AUTH_TOKEN
npx wrangler secret put GOOGLE_CLIENT_IDS
npx wrangler secret put GEMINI_API_KEY
npx wrangler deploy

curl -s https://receipt-upload.jamesraj2050.workers.dev/health
```

### Git

```bash
git status
git add …   # never add .env or secrets
git commit -m "…"
# push only when asked
```

---

## 12. Cloudflare / R2 / Google / Gemini

| System | Config |
|---|---|
| Worker | `receipt-upload` |
| R2 | binding `RECEIPTS` → `first-mobile-app` |
| Secrets | `TURSO_*`, `GOOGLE_CLIENT_IDS`, `GEMINI_API_KEY` |
| Google OAuth | Web/iOS/Android clients; redirect URIs for each Expo web port (`8081`, `8082`, …) |
| Gemini | Free AI Studio key; server-side only |

---

## 13. Bugs fixed (recent)

| Issue | Cause | Fix |
|---|---|---|
| “Failed to fetch” after login | Old Worker / CORS | Redeploy; allow `Authorization` |
| Same trips for two Google users | Shared AsyncStorage | `local_trips_v2:{userId}` |
| Receipt upload stuck pending | Upload before expense in Turso | Sync metadata → R2 → keys |
| “Trip not found” after create | Sync race | Disk reconcile + deferred sync |
| Trip name not auto-filling | `nameTouched` on focus | Sync from autoName until real edit |
| Upload button did nothing (web) | `Alert.alert` chooser | Direct Photo \| PDF split control |
| AI failed (`gemini-2.0-flash`) | Model retired | `gemini-2.5-flash` + fallbacks |
| Some PDFs not extracted | `octet-stream` treated as JPEG | Magic-byte sniff + Gemini Files API for PDFs |
| Close Trip cluttered Add flow | Wrong placement | Removed from trip screen; finish via Review |

---

## 14. Subscription plan (agreed — implement after testing)

**Decision:** Entitlement + trial **first**; Apple/Google IAP **last**. Payments only after product testing is done.

### Model

```
ARK CONSULTING GROUP → Travel Expenses → ONE USER ACCOUNT
  ├─ iPhone: Apple IAP  $7/year (+ 3 months free)
  └─ Android: Google Play $7/year (+ 3 months free)
           ↓
     YOUR BACKEND (Worker) → ENTITLEMENT
           ↓
     iOS / Android / Web  →  Turso + R2
```

- **Price:** USD/AUD **$7 per year** (confirm currency before store setup).
- **Trial:** first **3 months free** (start on first successful Google login — server-side).
- **Billing:** mobile only (Apple IAP + Google Play).
- **Web:** free for any user with active entitlement (no Stripe/web checkout in v1).
- **Source of truth:** Worker/`users` entitlement fields — never device-only.

### Phases (do in order)

| Phase | What | When |
|---|---|---|
| **A** | Entitlement fields + gate (`trialing` / `active` / `expired` / `grace`) on Worker; soft paywall in app | After testing; before IAP |
| **B** | Auto-start 3‑month trial on first login (no stores) | With Phase A |
| **C** | Apple + Google yearly product, verify receipts/webhooks, restore purchases | Last |
| **D** | Web only checks entitlement (already free if entitled) | With C |

### Notes

- Grace period (e.g. 3–7 days) after failed renewal before lockout.
- Restore Purchases on iOS/Android.
- Optional later: Stripe on web for non-mobile users — **not** in v1.
- Earlier draft prices (AUD $4 / $24) superseded by **$7/year** above.

**Status:** Plan agreed. User completing product testing before Phase A implementation.

---

## 15. Verification checklist

- [x] Google login + session persist  
- [x] Worker JWT → `users` row  
- [x] Local-first trips; background sync  
- [x] No Turso/R2/Gemini secrets in Expo  
- [x] User isolation (local + API)  
- [x] Receipt upload after expense sync; view via icon  
- [x] ADD EXPENSE type-specific form  
- [x] Finish trip via Review (not Close on trip screen)  
- [x] Gemini extract: type, date, amount, from/to for travel  
- [x] Place memory + Title Case place names  
- [ ] Full production E2E on physical iOS + Android store builds  
- [ ] Legacy `user_id` NULL ownership migration (manual if needed)  

---

## 16. Status

**Not claimed production-ready** until OAuth, multi-device E2E, and receipt AI are fully verified on store builds.

Delivered now:

1. Fast expense capture with type details  
2. Local-first data + background sync  
3. Secure multi-user cloud (Worker → Turso + R2)  
4. Gemini receipt prefill (Type / From / To / Date / Amount)  
5. Lean trip UX (add expenses; finish from Review)  

---

## 17. Tax / Work Receipts

Tax / Work Receipts is the second section of the same app and account. It is
year-based rather than trip-based and reuses Google authentication, Gemini OCR,
Turso, the Worker API and the existing R2 bucket.

### Flow

1. Home menu → **Tax / Work Receipts**
2. **Capture Receipt** → camera, photo or PDF; a local draft is saved automatically
3. Gemini selects the editable Type and fills editable Date and Amount
4. User enters Description and corrects any detected value before tapping Done
5. Metadata and receipt sync in the background
6. Browse most recently scanned receipts first; yearly count/total use final `amount`

Supported types: Flight, Car, Bus, Taxi / Auto, Train, Meal and Other.
Other supports House Rent Receipt or a user-entered Custom description. The app
organizes records and does not make tax-deductibility claims.

Each receipt stores its own ISO currency code. The capture screen defaults from
the device region and allows manual selection. Mixed-currency years show one
total per currency; amounts are never combined or converted across currencies.

### Storage and retention

- Local key: `local_tax_work_expenses_v1:{userId}`
- Turso table: `tax_work_expenses`
- R2 key: `receipts/{userId}/tax-work/{expenseId}/{uuid}.{ext}`
- Retention marker: `tax_work_3_year_minimum`
- No scheduled deletion applies to Tax / Work records.
- Hidden years are stored in `tax_work_year_preferences` and sync across devices.

The separate table is intentional: the existing Business Travel `expenses`
table requires `trip_id`, so changing it would risk existing trip data and
retention behavior. It remains the same Turso database and shared data layer.

### API

| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/tax-work/expenses` | List or create authenticated user's records |
| PATCH / DELETE | `/tax-work/expenses/:expenseId` | Edit or manually delete one record |
| POST | `/tax-work/sync` | Local-first batch upsert and user snapshot |
| POST | `/tax-work/receipts/upload` | R2 upload with `X-Expense-Id` |
| GET | `/tax-work/years/hidden` | List hidden years |
| PUT / DELETE | `/tax-work/years/:year/hidden` | Hide or restore a year |
| DELETE | `/tax-work/years/:year` | Permanently delete the year and its receipts |

`GET /receipts/:key` authorizes both Business Travel and Tax / Work ownership
from Turso before returning an R2 object. The client never supplies or controls
the database `user_id`.

### Migration and configuration

No manual SQL or new environment variable is required. The existing
`ensureSchema` migration creates the table and indexes on the next authenticated
API request after Worker deployment.
