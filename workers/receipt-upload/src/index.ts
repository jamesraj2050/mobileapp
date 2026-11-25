/**
 * Cloudflare Worker API: auth, trips, expenses, receipts, sync + R2.
 *
 * Secrets (wrangler secret put):
 *   TURSO_DATABASE_URL
 *   TURSO_AUTH_TOKEN
 *   GOOGLE_CLIENT_IDS   (comma-separated iOS/Android/Web client IDs)
 *   GEMINI_API_KEY      (Google AI Studio key for receipt extraction)
 *
 * Optional vars:
 *   GEMINI_MODEL        (default gemini-2.0-flash)
 *
 * Deploy:
 *   npx wrangler deploy
 */

import {
  AuthError,
  authenticateAppSession,
  bearerToken,
  createAppSession,
  getOrCreateUser,
  refreshAppSession,
  revokeAppSession,
  verifyGoogleIdToken,
  type AuthUser,
} from './auth';
import { extractReceiptWithGemini, sniffReceiptMime } from './gemini';
import { ensureSchema } from './schema';
import { execute, type SqlValue } from './turso';

export interface Env {
  RECEIPTS: R2Bucket;
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  GOOGLE_CLIENT_IDS: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  /** Deprecated shared secret — ignored for authenticated routes. */
  UPLOAD_SECRET?: string;
}

const MAX_RECEIPT_BYTES = 12 * 1024 * 1024;

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Trip-Id, X-Expense-Id',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}

function errorResponse(status: number, message: string): Response {
  return json({ error: message }, status);
}

function requireTurso(env: Env): void {
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) {
    throw new AuthError(500, 'Server misconfigured: Turso credentials missing');
  }
}

async function authenticate(request: Request, env: Env): Promise<AuthUser> {
  requireTurso(env);
  const token = bearerToken(request);
  if (!token) {
    throw new AuthError(401, 'Missing Authorization bearer token');
  }

  await ensureSchema(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
  const appUser = await authenticateAppSession(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    token
  );
  if (appUser) return appUser;
  if (token.startsWith('app_access_')) {
    throw new AuthError(401, 'Session expired');
  }
  const claims = await verifyGoogleIdToken(token, env.GOOGLE_CLIENT_IDS);
  return getOrCreateUser(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN, claims);
}

function mapExpense(row: Record<string, SqlValue>) {
  let details: Record<string, unknown> = {};
  if (typeof row.details_json === 'string' && row.details_json) {
    try {
      details = JSON.parse(row.details_json) as Record<string, unknown>;
    } catch {
      details = {};
    }
  }
  return {
    id: String(row.id),
    tripId: String(row.trip_id),
    type: String(row.type),
    date: String(row.date),
    amount: Number(row.amount),
    description: String(row.description ?? ''),
    details,
    receiptUri: row.receipt_uri == null ? null : String(row.receipt_uri),
    receiptKey: row.receipt_key == null ? null : String(row.receipt_key),
    receiptStatus: String(row.receipt_status),
    receiptDetectedAmount:
      row.receipt_detected_amount == null ? null : Number(row.receipt_detected_amount),
    createdAt: String(row.created_at),
    updatedAt: row.updated_at == null ? String(row.created_at) : String(row.updated_at),
  };
}

function mapTrip(row: Record<string, SqlValue>, expenses: ReturnType<typeof mapExpense>[]) {
  return {
    id: String(row.id),
    from: String(row.from_city),
    to: String(row.to_city),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    name: String(row.name),
    status: String(row.status),
    expenses,
    createdAt: String(row.created_at),
    updatedAt: row.updated_at == null ? String(row.created_at) : String(row.updated_at),
  };
}

async function loadUserTrips(env: Env, userId: string) {
  const tripsResult = await execute(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    `SELECT * FROM trips
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [userId]
  );

  if (tripsResult.rows.length === 0) return [];

  const expensesResult = await execute(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    `SELECT * FROM expenses WHERE user_id = ? ORDER BY created_at DESC`,
    [userId]
  );

  const byTrip = new Map<string, ReturnType<typeof mapExpense>[]>();
  for (const row of expensesResult.rows) {
    const tripId = String(row.trip_id);
    const list = byTrip.get(tripId) ?? [];
    list.push(mapExpense(row));
    byTrip.set(tripId, list);
  }

  return tripsResult.rows.map((row) => mapTrip(row, byTrip.get(String(row.id)) ?? []));
}

async function getOwnedTrip(env: Env, userId: string, tripId: string) {
  const result = await execute(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    `SELECT * FROM trips
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [tripId, userId]
  );
  return result.rows[0] ?? null;
}

async function getOwnedExpense(env: Env, userId: string, tripId: string, expenseId: string) {
  const result = await execute(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    `SELECT expenses.*
     FROM expenses
     INNER JOIN trips ON trips.id = expenses.trip_id AND trips.user_id = expenses.user_id
     WHERE expenses.id = ? AND expenses.trip_id = ? AND expenses.user_id = ?
     LIMIT 1`,
    [expenseId, tripId, userId]
  );
  return result.rows[0] ?? null;
}

async function deleteR2Prefix(bucket: R2Bucket, prefix: string): Promise<number> {
  let deleted = 0;
  while (true) {
    const listed = await bucket.list({ prefix, limit: 1000 });
    const keys = listed.objects.map((object) => object.key);
    if (keys.length === 0) return deleted;
    await bucket.delete(keys);
    deleted += keys.length;
    if (!listed.truncated) return deleted;
  }
}

async function deleteTripData(
  env: Env,
  userId: string,
  tripId: string
): Promise<{ receiptsDeleted: number }> {
  const receiptsDeleted = await deleteR2Prefix(
    env.RECEIPTS,
    `receipts/${userId}/${tripId}/`
  );
  await execute(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    `DELETE FROM expenses WHERE trip_id = ? AND user_id = ?`,
    [tripId, userId]
  );
  await execute(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    `DELETE FROM trips WHERE id = ? AND user_id = ?`,
    [tripId, userId]
  );
  return { receiptsDeleted };
}

function extensionForContentType(contentType: string): string {
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('heic')) return 'heic';
  return 'jpg';
}

type SyncTripInput = {
  id: string;
  from: string;
  to: string;
  startDate: string;
  endDate: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
};

type SyncExpenseInput = {
  id: string;
  tripId: string;
  type: string;
  date: string;
  amount: number;
  description?: string;
  details?: Record<string, unknown>;
  receiptUri?: string | null;
  receiptKey?: string | null;
  receiptStatus: string;
  receiptDetectedAmount?: number | null;
  createdAt: string;
  updatedAt?: string;
};

type SyncTaxWorkExpenseInput = {
  id: string;
  type: string;
  description?: string;
  currency?: string;
  otherType?: 'house_rent' | 'custom' | null;
  otherDescription?: string;
  date: string;
  amount: number;
  receiptDetectedAmount?: number | null;
  receiptUri?: string | null;
  receiptKey?: string | null;
  receiptStatus: string;
  retentionPolicy?: 'tax_work_3_year_minimum';
  createdAt: string;
  updatedAt?: string;
};

const TAX_WORK_TYPES = new Set(['flight', 'car', 'bus', 'taxi', 'train', 'meal', 'other']);

function mapTaxWorkExpense(row: Record<string, SqlValue>) {
  return {
    id: String(row.id),
    type: String(row.type),
    date: String(row.date),
    amount: Number(row.amount),
    description: String(row.description ?? ''),
    currency: String(row.currency ?? 'AUD'),
    details: {},
    receiptUri: row.receipt_uri == null ? null : String(row.receipt_uri),
    receiptKey: row.receipt_key == null ? null : String(row.receipt_key),
    receiptStatus: String(row.receipt_status),
    receiptDetectedAmount:
      row.receipt_detected_amount == null ? null : Number(row.receipt_detected_amount),
    expenseCategory: 'tax_work',
    otherType: row.other_type == null ? null : String(row.other_type),
    otherDescription: String(row.other_description ?? ''),
    retentionPolicy: 'tax_work_3_year_minimum',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  };
}

async function loadUserTaxWorkExpenses(env: Env, userId: string) {
  const result = await execute(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    `SELECT * FROM tax_work_expenses
     WHERE user_id = ?
     ORDER BY date DESC, created_at DESC`,
    [userId]
  );
  return result.rows.map(mapTaxWorkExpense);
}

function parseTaxYear(value: string): number {
  const year = Number(value);
  if (!/^\d{4}$/.test(value) || !Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new AuthError(400, 'Invalid year');
  }
  return year;
}

async function loadHiddenTaxWorkYears(env: Env, userId: string): Promise<number[]> {
  const result = await execute(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    `SELECT year FROM tax_work_year_preferences
     WHERE user_id = ?
     ORDER BY year DESC`,
    [userId]
  );
  return result.rows.map((row) => Number(row.year)).filter(Number.isFinite);
}

async function permanentlyDeleteTaxWorkYear(
  env: Env,
  userId: string,
  year: number
): Promise<{ expensesDeleted: number; receiptsDeleted: number }> {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;
  const result = await execute(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    `SELECT id FROM tax_work_expenses
     WHERE user_id = ? AND date >= ? AND date <= ?`,
    [userId, startDate, endDate]
  );

  let receiptsDeleted = 0;
  for (const row of result.rows) {
    receiptsDeleted += await deleteR2Prefix(
      env.RECEIPTS,
      `receipts/${userId}/tax-work/${String(row.id)}/`
    );
  }
  await execute(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    `DELETE FROM tax_work_expenses
     WHERE user_id = ? AND date >= ? AND date <= ?`,
    [userId, startDate, endDate]
  );
  await execute(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    `DELETE FROM tax_work_year_preferences WHERE user_id = ? AND year = ?`,
    [userId, year]
  );
  return { expensesDeleted: result.rows.length, receiptsDeleted };
}

async function getOwnedTaxWorkExpense(env: Env, userId: string, expenseId: string) {
  const result = await execute(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    `SELECT * FROM tax_work_expenses WHERE id = ? AND user_id = ? LIMIT 1`,
    [expenseId, userId]
  );
  return result.rows[0] ?? null;
}

function validateTaxWorkExpense(expense: SyncTaxWorkExpenseInput): void {
  if (
    !expense.id ||
    !TAX_WORK_TYPES.has(expense.type) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(expense.date) ||
    !Number.isFinite(expense.amount) ||
    expense.amount < 0 ||
    (expense.currency != null && !/^[A-Z]{3}$/.test(expense.currency)) ||
    !expense.receiptStatus ||
    !expense.createdAt
  ) {
    throw new AuthError(400, 'Invalid Tax / Work receipt payload');
  }
  if (
    expense.type === 'other' &&
    expense.otherType !== 'house_rent' &&
    expense.otherType !== 'custom'
  ) {
    throw new AuthError(400, 'Other receipts require House Rent Receipt or Custom');
  }
}

async function upsertTaxWorkExpense(
  env: Env,
  userId: string,
  expense: SyncTaxWorkExpenseInput
): Promise<void> {
  validateTaxWorkExpense(expense);
  const existing = await execute(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    `SELECT user_id FROM tax_work_expenses WHERE id = ? LIMIT 1`,
    [expense.id]
  );
  if (existing.rows[0] && String(existing.rows[0].user_id) !== userId) {
    throw new AuthError(403, 'Forbidden');
  }

  const now = expense.updatedAt ?? new Date().toISOString();
  if (existing.rows[0]) {
    await execute(
      env.TURSO_DATABASE_URL,
      env.TURSO_AUTH_TOKEN,
      `UPDATE tax_work_expenses
       SET type = ?, description = ?, currency = ?, other_type = ?, other_description = ?, date = ?, amount = ?,
           receipt_detected_amount = ?, receipt_uri = ?, receipt_key = ?,
           receipt_status = ?, retention_policy = 'tax_work_3_year_minimum', updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [
        expense.type,
        expense.description?.trim() ?? '',
        expense.currency ?? 'AUD',
        expense.type === 'other' ? expense.otherType ?? null : null,
        expense.type === 'other' ? expense.otherDescription?.trim() ?? '' : '',
        expense.date,
        expense.amount,
        expense.receiptDetectedAmount ?? null,
        expense.receiptUri ?? null,
        expense.receiptKey ?? null,
        expense.receiptStatus,
        now,
        expense.id,
        userId,
      ]
    );
    return;
  }

  await execute(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    `INSERT INTO tax_work_expenses
     (id, user_id, type, description, currency, other_type, other_description, date, amount,
      receipt_detected_amount, receipt_uri, receipt_key, receipt_status,
      retention_policy, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tax_work_3_year_minimum', ?, ?)`,
    [
      expense.id,
      userId,
      expense.type,
      expense.description?.trim() ?? '',
      expense.currency ?? 'AUD',
      expense.type === 'other' ? expense.otherType ?? null : null,
      expense.type === 'other' ? expense.otherDescription?.trim() ?? '' : '',
      expense.date,
      expense.amount,
      expense.receiptDetectedAmount ?? null,
      expense.receiptUri ?? null,
      expense.receiptKey ?? null,
      expense.receiptStatus,
      expense.createdAt,
      now,
    ]
  );
}

async function upsertTrip(env: Env, userId: string, trip: SyncTripInput): Promise<void> {
  const existing = await execute(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    `SELECT id, user_id FROM trips WHERE id = ? LIMIT 1`,
    [trip.id]
  );

  if (existing.rows[0]) {
    if (String(existing.rows[0].user_id) !== userId) {
      throw new AuthError(403, 'Forbidden');
    }
    await execute(
      env.TURSO_DATABASE_URL,
      env.TURSO_AUTH_TOKEN,
      `UPDATE trips
       SET from_city = ?, to_city = ?, start_date = ?, end_date = ?, name = ?, status = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [
        trip.from,
        trip.to,
        trip.startDate,
        trip.endDate,
        trip.name,
        trip.status,
        trip.updatedAt ?? new Date().toISOString(),
        trip.id,
        userId,
      ]
    );
    return;
  }

  await execute(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    `INSERT INTO trips
     (id, from_city, to_city, start_date, end_date, name, status, created_at, user_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      trip.id,
      trip.from,
      trip.to,
      trip.startDate,
      trip.endDate,
      trip.name,
      trip.status,
      trip.createdAt,
      userId,
      trip.updatedAt ?? trip.createdAt,
    ]
  );
}

async function upsertExpense(env: Env, userId: string, expense: SyncExpenseInput): Promise<void> {
  const trip = await getOwnedTrip(env, userId, expense.tripId);
  if (!trip) {
    throw new AuthError(404, 'Trip not found');
  }

  const existing = await execute(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    `SELECT id, user_id FROM expenses WHERE id = ? LIMIT 1`,
    [expense.id]
  );

  if (existing.rows[0]) {
    if (String(existing.rows[0].user_id) !== userId) {
      throw new AuthError(403, 'Forbidden');
    }
    await execute(
      env.TURSO_DATABASE_URL,
      env.TURSO_AUTH_TOKEN,
      `UPDATE expenses
       SET trip_id = ?, type = ?, date = ?, amount = ?, description = ?,
           receipt_uri = ?, receipt_key = ?, receipt_status = ?,
           receipt_detected_amount = ?, details_json = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [
        expense.tripId,
        expense.type,
        expense.date,
        expense.amount,
        expense.description ?? '',
        expense.receiptUri ?? null,
        expense.receiptKey ?? null,
        expense.receiptStatus,
        expense.receiptDetectedAmount ?? null,
        JSON.stringify(expense.details ?? {}),
        expense.updatedAt ?? new Date().toISOString(),
        expense.id,
        userId,
      ]
    );
    return;
  }

  await execute(
    env.TURSO_DATABASE_URL,
    env.TURSO_AUTH_TOKEN,
    `INSERT INTO expenses
     (id, trip_id, type, date, amount, description, receipt_uri, receipt_status,
      created_at, user_id, updated_at, receipt_key, receipt_detected_amount, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      expense.id,
      expense.tripId,
      expense.type,
      expense.date,
      expense.amount,
      expense.description ?? '',
      expense.receiptUri ?? null,
      expense.receiptStatus,
      expense.createdAt,
      userId,
      expense.updatedAt ?? expense.createdAt,
      expense.receiptKey ?? null,
      expense.receiptDetectedAmount ?? null,
      JSON.stringify(expense.details ?? {}),
    ]
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (request.method === 'GET' && (path === '/' || path === '/health')) {
        return json({
          ok: true,
          service: 'travel-expenses-api',
          endpoints: [
            'GET /health',
            'POST /auth/session',
            'POST /auth/refresh',
            'POST /auth/logout',
            'GET /me',
            'GET|POST /trips',
            'GET|PATCH|DELETE /trips/:tripId',
            'POST /trips/:tripId/expenses',
            'PATCH|DELETE /trips/:tripId/expenses/:expenseId',
            'POST /receipts/upload',
            'POST /receipts/extract',
            'GET /receipts/:key',
            'POST /sync',
            'GET|POST /tax-work/expenses',
            'PATCH|DELETE /tax-work/expenses/:expenseId',
            'POST /tax-work/sync',
            'POST /tax-work/receipts/upload',
            'GET /tax-work/years/hidden',
            'PUT|DELETE /tax-work/years/:year/hidden',
            'DELETE /tax-work/years/:year',
          ],
        });
      }

      if (request.method === 'POST' && path === '/auth/session') {
        requireTurso(env);
        await ensureSchema(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
        const googleToken = bearerToken(request);
        if (!googleToken) return errorResponse(401, 'Missing Google ID token');
        const claims = await verifyGoogleIdToken(googleToken, env.GOOGLE_CLIENT_IDS);
        const user = await getOrCreateUser(
          env.TURSO_DATABASE_URL,
          env.TURSO_AUTH_TOKEN,
          claims
        );
        const tokens = await createAppSession(
          env.TURSO_DATABASE_URL,
          env.TURSO_AUTH_TOKEN,
          user
        );
        return json({
          ...tokens,
          user: { id: user.id, email: user.email, name: user.name },
        }, 201);
      }

      if (request.method === 'POST' && path === '/auth/refresh') {
        requireTurso(env);
        await ensureSchema(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
        const body = (await request.json()) as { refreshToken?: string };
        if (!body.refreshToken) return errorResponse(401, 'Missing refresh token');
        const refreshed = await refreshAppSession(
          env.TURSO_DATABASE_URL,
          env.TURSO_AUTH_TOKEN,
          body.refreshToken
        );
        return json({
          ...refreshed.tokens,
          user: {
            id: refreshed.user.id,
            email: refreshed.user.email,
            name: refreshed.user.name,
          },
        });
      }

      if (request.method === 'POST' && path === '/auth/logout') {
        requireTurso(env);
        await ensureSchema(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
        const body = (await request.json()) as { refreshToken?: string };
        if (body.refreshToken) {
          await revokeAppSession(
            env.TURSO_DATABASE_URL,
            env.TURSO_AUTH_TOKEN,
            body.refreshToken
          );
        }
        return json({ ok: true });
      }

      // ── Authenticated routes ──────────────────────────────────────────
      const user = await authenticate(request, env);

      if (request.method === 'GET' && path === '/me') {
        return json({
          id: user.id,
          email: user.email,
          name: user.name,
        });
      }

      if (request.method === 'GET' && path === '/trips') {
        const trips = await loadUserTrips(env, user.id);
        return json({ trips });
      }

      if (request.method === 'POST' && path === '/trips') {
        const body = (await request.json()) as Partial<SyncTripInput>;
        if (!body.id || !body.from || !body.to || !body.startDate || !body.endDate || !body.name) {
          return errorResponse(400, 'Invalid trip payload');
        }
        await upsertTrip(env, user.id, {
          id: body.id,
          from: body.from,
          to: body.to,
          startDate: body.startDate,
          endDate: body.endDate,
          name: body.name,
          status: body.status ?? 'active',
          createdAt: body.createdAt ?? new Date().toISOString(),
          updatedAt: body.updatedAt,
        });
        const trip = await getOwnedTrip(env, user.id, body.id);
        return json({ trip: mapTrip(trip!, []) }, 201);
      }

      const tripMatch = path.match(/^\/trips\/([^/]+)$/);
      if (tripMatch) {
        const tripId = decodeURIComponent(tripMatch[1]);

        if (request.method === 'GET') {
          const trip = await getOwnedTrip(env, user.id, tripId);
          if (!trip) return errorResponse(404, 'Not found');
          const expensesResult = await execute(
            env.TURSO_DATABASE_URL,
            env.TURSO_AUTH_TOKEN,
            `SELECT * FROM expenses WHERE trip_id = ? AND user_id = ? ORDER BY created_at DESC`,
            [tripId, user.id]
          );
          return json({
            trip: mapTrip(
              trip,
              expensesResult.rows.map((row) => mapExpense(row))
            ),
          });
        }

        if (request.method === 'PATCH') {
          const trip = await getOwnedTrip(env, user.id, tripId);
          if (!trip) return errorResponse(404, 'Not found');
          const body = (await request.json()) as Partial<SyncTripInput>;
          await upsertTrip(env, user.id, {
            id: tripId,
            from: body.from ?? String(trip.from_city),
            to: body.to ?? String(trip.to_city),
            startDate: body.startDate ?? String(trip.start_date),
            endDate: body.endDate ?? String(trip.end_date),
            name: body.name ?? String(trip.name),
            status: body.status ?? String(trip.status),
            createdAt: String(trip.created_at),
            updatedAt: body.updatedAt ?? new Date().toISOString(),
          });
          const updated = await getOwnedTrip(env, user.id, tripId);
          return json({ trip: mapTrip(updated!, []) });
        }

        if (request.method === 'DELETE') {
          const trip = await getOwnedTrip(env, user.id, tripId);
          if (!trip) return errorResponse(404, 'Not found');
          await deleteTripData(env, user.id, tripId);
          return json({ ok: true });
        }
      }

      const expensesCreateMatch = path.match(/^\/trips\/([^/]+)\/expenses$/);
      if (expensesCreateMatch && request.method === 'POST') {
        const tripId = decodeURIComponent(expensesCreateMatch[1]);
        const body = (await request.json()) as Partial<SyncExpenseInput>;
        if (!body.id || body.amount == null || !body.date || !body.type || !body.receiptStatus) {
          return errorResponse(400, 'Invalid expense payload');
        }
        await upsertExpense(env, user.id, {
          id: body.id,
          tripId,
          type: body.type,
          date: body.date,
          amount: Number(body.amount),
          description: body.description,
          details: body.details,
          receiptUri: body.receiptUri,
          receiptKey: body.receiptKey,
          receiptStatus: body.receiptStatus,
          receiptDetectedAmount: body.receiptDetectedAmount,
          createdAt: body.createdAt ?? new Date().toISOString(),
          updatedAt: body.updatedAt,
        });
        const expense = await getOwnedExpense(env, user.id, tripId, body.id);
        return json({ expense: mapExpense(expense!) }, 201);
      }

      const expenseMatch = path.match(/^\/trips\/([^/]+)\/expenses\/([^/]+)$/);
      if (expenseMatch) {
        const tripId = decodeURIComponent(expenseMatch[1]);
        const expenseId = decodeURIComponent(expenseMatch[2]);

        if (request.method === 'PATCH') {
          const existing = await getOwnedExpense(env, user.id, tripId, expenseId);
          if (!existing) return errorResponse(404, 'Not found');
          const body = (await request.json()) as Partial<SyncExpenseInput>;
          await upsertExpense(env, user.id, {
            id: expenseId,
            tripId,
            type: body.type ?? String(existing.type),
            date: body.date ?? String(existing.date),
            amount: body.amount == null ? Number(existing.amount) : Number(body.amount),
            description:
              body.description ?? (existing.description == null ? '' : String(existing.description)),
            details:
              body.details ??
              (typeof existing.details_json === 'string' && existing.details_json
                ? (JSON.parse(String(existing.details_json)) as Record<string, unknown>)
                : {}),
            receiptUri:
              body.receiptUri === undefined
                ? existing.receipt_uri == null
                  ? null
                  : String(existing.receipt_uri)
                : body.receiptUri,
            receiptKey:
              body.receiptKey === undefined
                ? existing.receipt_key == null
                  ? null
                  : String(existing.receipt_key)
                : body.receiptKey,
            receiptStatus: body.receiptStatus ?? String(existing.receipt_status),
            receiptDetectedAmount:
              body.receiptDetectedAmount === undefined
                ? existing.receipt_detected_amount == null
                  ? null
                  : Number(existing.receipt_detected_amount)
                : body.receiptDetectedAmount,
            createdAt: String(existing.created_at),
            updatedAt: body.updatedAt ?? new Date().toISOString(),
          });
          const expense = await getOwnedExpense(env, user.id, tripId, expenseId);
          return json({ expense: mapExpense(expense!) });
        }

        if (request.method === 'DELETE') {
          const existing = await getOwnedExpense(env, user.id, tripId, expenseId);
          if (!existing) return errorResponse(404, 'Not found');
          await deleteR2Prefix(
            env.RECEIPTS,
            `receipts/${user.id}/${tripId}/${expenseId}/`
          );
          await execute(
            env.TURSO_DATABASE_URL,
            env.TURSO_AUTH_TOKEN,
            `DELETE FROM expenses WHERE id = ? AND trip_id = ? AND user_id = ?`,
            [expenseId, tripId, user.id]
          );
          return json({ ok: true });
        }
      }

      if (request.method === 'POST' && path === '/sync') {
        const body = (await request.json()) as {
          trips?: SyncTripInput[];
          expenses?: SyncExpenseInput[];
        };

        const syncedTripIds: string[] = [];
        const syncedExpenseIds: string[] = [];

        for (const trip of body.trips ?? []) {
          if (!trip.id || !trip.from || !trip.to || !trip.startDate || !trip.endDate || !trip.name) {
            return errorResponse(400, 'Invalid trip in sync payload');
          }
          await upsertTrip(env, user.id, trip);
          syncedTripIds.push(trip.id);
        }

        for (const expense of body.expenses ?? []) {
          if (
            !expense.id ||
            !expense.tripId ||
            expense.amount == null ||
            !expense.date ||
            !expense.type ||
            !expense.receiptStatus
          ) {
            return errorResponse(400, 'Invalid expense in sync payload');
          }
          await upsertExpense(env, user.id, expense);
          syncedExpenseIds.push(expense.id);
        }

        const trips = await loadUserTrips(env, user.id);
        return json({
          syncedTripIds,
          syncedExpenseIds,
          trips,
        });
      }

      if (request.method === 'GET' && path === '/tax-work/years/hidden') {
        return json({ years: await loadHiddenTaxWorkYears(env, user.id) });
      }

      const hiddenTaxYearMatch = path.match(/^\/tax-work\/years\/(\d{4})\/hidden$/);
      if (hiddenTaxYearMatch) {
        const year = parseTaxYear(hiddenTaxYearMatch[1]);
        if (request.method === 'PUT') {
          await execute(
            env.TURSO_DATABASE_URL,
            env.TURSO_AUTH_TOKEN,
            `INSERT INTO tax_work_year_preferences (user_id, year, hidden_at)
             VALUES (?, ?, ?)
             ON CONFLICT(user_id, year) DO UPDATE SET hidden_at = excluded.hidden_at`,
            [user.id, year, new Date().toISOString()]
          );
          return json({ ok: true, year });
        }
        if (request.method === 'DELETE') {
          await execute(
            env.TURSO_DATABASE_URL,
            env.TURSO_AUTH_TOKEN,
            `DELETE FROM tax_work_year_preferences WHERE user_id = ? AND year = ?`,
            [user.id, year]
          );
          return json({ ok: true, year });
        }
      }

      const permanentTaxYearMatch = path.match(/^\/tax-work\/years\/(\d{4})$/);
      if (permanentTaxYearMatch && request.method === 'DELETE') {
        const year = parseTaxYear(permanentTaxYearMatch[1]);
        return json({
          ok: true,
          year,
          ...(await permanentlyDeleteTaxWorkYear(env, user.id, year)),
        });
      }

      if (request.method === 'GET' && path === '/tax-work/expenses') {
        return json({ expenses: await loadUserTaxWorkExpenses(env, user.id) });
      }

      if (request.method === 'POST' && path === '/tax-work/expenses') {
        const body = (await request.json()) as SyncTaxWorkExpenseInput;
        await upsertTaxWorkExpense(env, user.id, {
          ...body,
          createdAt: body.createdAt ?? new Date().toISOString(),
        });
        const expense = await getOwnedTaxWorkExpense(env, user.id, body.id);
        return json({ expense: mapTaxWorkExpense(expense!) }, 201);
      }

      const taxWorkExpenseMatch = path.match(/^\/tax-work\/expenses\/([^/]+)$/);
      if (taxWorkExpenseMatch) {
        const expenseId = decodeURIComponent(taxWorkExpenseMatch[1]);
        const existing = await getOwnedTaxWorkExpense(env, user.id, expenseId);
        if (!existing) return errorResponse(404, 'Not found');

        if (request.method === 'PATCH') {
          const body = (await request.json()) as Partial<SyncTaxWorkExpenseInput>;
          await upsertTaxWorkExpense(env, user.id, {
            id: expenseId,
            type: body.type ?? String(existing.type),
            description: body.description ?? String(existing.description ?? ''),
            currency: body.currency ?? String(existing.currency ?? 'AUD'),
            otherType:
              body.otherType === undefined
                ? existing.other_type == null
                  ? null
                  : (String(existing.other_type) as 'house_rent' | 'custom')
                : body.otherType,
            otherDescription:
              body.otherDescription ?? String(existing.other_description ?? ''),
            date: body.date ?? String(existing.date),
            amount: body.amount == null ? Number(existing.amount) : Number(body.amount),
            receiptDetectedAmount:
              body.receiptDetectedAmount === undefined
                ? existing.receipt_detected_amount == null
                  ? null
                  : Number(existing.receipt_detected_amount)
                : body.receiptDetectedAmount,
            receiptUri:
              body.receiptUri === undefined
                ? existing.receipt_uri == null
                  ? null
                  : String(existing.receipt_uri)
                : body.receiptUri,
            receiptKey:
              body.receiptKey === undefined
                ? existing.receipt_key == null
                  ? null
                  : String(existing.receipt_key)
                : body.receiptKey,
            receiptStatus: body.receiptStatus ?? String(existing.receipt_status),
            retentionPolicy: 'tax_work_3_year_minimum',
            createdAt: String(existing.created_at),
            updatedAt: body.updatedAt ?? new Date().toISOString(),
          });
          const expense = await getOwnedTaxWorkExpense(env, user.id, expenseId);
          return json({ expense: mapTaxWorkExpense(expense!) });
        }

        if (request.method === 'DELETE') {
          await deleteR2Prefix(
            env.RECEIPTS,
            `receipts/${user.id}/tax-work/${expenseId}/`
          );
          await execute(
            env.TURSO_DATABASE_URL,
            env.TURSO_AUTH_TOKEN,
            `DELETE FROM tax_work_expenses WHERE id = ? AND user_id = ?`,
            [expenseId, user.id]
          );
          return json({ ok: true });
        }
      }

      if (request.method === 'POST' && path === '/tax-work/sync') {
        const body = (await request.json()) as { expenses?: SyncTaxWorkExpenseInput[] };
        const syncedExpenseIds: string[] = [];
        for (const expense of body.expenses ?? []) {
          await upsertTaxWorkExpense(env, user.id, expense);
          syncedExpenseIds.push(expense.id);
        }
        return json({
          syncedExpenseIds,
          expenses: await loadUserTaxWorkExpenses(env, user.id),
        });
      }

      if (request.method === 'POST' && path === '/receipts/extract') {
        if (!env.GEMINI_API_KEY) {
          return errorResponse(503, 'Receipt AI is not configured (missing GEMINI_API_KEY)');
        }

        const contentTypeHeader = request.headers.get('Content-Type') || '';
        const normalized = contentTypeHeader.split(';')[0].trim().toLowerCase() || 'image/jpeg';
        const allowed =
          normalized.startsWith('image/') ||
          normalized === 'application/pdf' ||
          normalized === 'application/octet-stream';
        if (!allowed) {
          return errorResponse(400, 'Only image or PDF bodies are allowed');
        }

        const bytes = await request.arrayBuffer();
        if (bytes.byteLength === 0) {
          return errorResponse(400, 'Empty receipt body');
        }
        if (bytes.byteLength > MAX_RECEIPT_BYTES) {
          return errorResponse(400, 'Receipt exceeds 12MB limit');
        }

        const mimeType = sniffReceiptMime(bytes, normalized);

        try {
          const extraction = await extractReceiptWithGemini({
            apiKey: env.GEMINI_API_KEY,
            model: env.GEMINI_MODEL,
            mimeType,
            bytes,
          });
          return json({ extraction });
        } catch (error) {
          console.error(
            'Gemini extract failed',
            error instanceof Error ? error.message : 'unknown',
            { bytes: bytes.byteLength, mimeType }
          );
          return errorResponse(
            502,
            error instanceof Error ? error.message : 'Receipt extraction failed'
          );
        }
      }

      if (request.method === 'POST' && path === '/tax-work/receipts/upload') {
        const contentTypeHeader = request.headers.get('Content-Type') || '';
        const expenseId = request.headers.get('X-Expense-Id');
        if (!expenseId) return errorResponse(400, 'X-Expense-Id header is required');

        const expense = await getOwnedTaxWorkExpense(env, user.id, expenseId);
        if (!expense) return errorResponse(404, 'Not found');

        const normalized = contentTypeHeader.split(';')[0].trim().toLowerCase() || 'image/jpeg';
        const allowed =
          normalized.startsWith('image/') ||
          normalized === 'application/pdf' ||
          normalized === 'application/octet-stream';
        if (!allowed) return errorResponse(400, 'Only image or PDF uploads are allowed');

        const bytes = await request.arrayBuffer();
        if (bytes.byteLength === 0) return errorResponse(400, 'Empty upload body');
        if (bytes.byteLength > MAX_RECEIPT_BYTES) {
          return errorResponse(400, 'Receipt exceeds 12MB limit');
        }

        const ext = extensionForContentType(normalized);
        const key = `receipts/${user.id}/tax-work/${expenseId}/${crypto.randomUUID()}.${ext}`;
        const storedType = normalized === 'application/octet-stream' ? 'image/jpeg' : normalized;
        await env.RECEIPTS.put(key, bytes, {
          httpMetadata: { contentType: storedType },
          customMetadata: {
            userId: user.id,
            expenseId,
            expenseCategory: 'tax_work',
          },
        });

        await execute(
          env.TURSO_DATABASE_URL,
          env.TURSO_AUTH_TOKEN,
          `UPDATE tax_work_expenses
           SET receipt_key = ?, receipt_status = 'attached', updated_at = ?
           WHERE id = ? AND user_id = ?`,
          [key, new Date().toISOString(), expenseId, user.id]
        );
        return json({ key, receiptStatus: 'attached' }, 201);
      }

      if (request.method === 'POST' && path === '/receipts/upload') {
        const contentTypeHeader = request.headers.get('Content-Type') || '';
        const tripId = request.headers.get('X-Trip-Id');
        const expenseId = request.headers.get('X-Expense-Id');

        if (!tripId || !expenseId) {
          return errorResponse(400, 'X-Trip-Id and X-Expense-Id headers are required');
        }

        const trip = await getOwnedTrip(env, user.id, tripId);
        if (!trip) return errorResponse(404, 'Not found');

        const expense = await getOwnedExpense(env, user.id, tripId, expenseId);
        if (!expense) return errorResponse(404, 'Not found');

        const normalized = contentTypeHeader.split(';')[0].trim().toLowerCase() || 'image/jpeg';
        const allowed =
          normalized.startsWith('image/') ||
          normalized === 'application/pdf' ||
          normalized === 'application/octet-stream';
        if (!allowed) {
          return errorResponse(400, 'Only image or PDF uploads are allowed');
        }

        const bytes = await request.arrayBuffer();
        if (bytes.byteLength === 0) {
          return errorResponse(400, 'Empty upload body');
        }
        if (bytes.byteLength > MAX_RECEIPT_BYTES) {
          return errorResponse(400, 'Receipt exceeds 12MB limit');
        }

        const ext = extensionForContentType(normalized);
        const key = `receipts/${user.id}/${tripId}/${expenseId}/${crypto.randomUUID()}.${ext}`;
        const storedType =
          normalized === 'application/octet-stream' ? 'image/jpeg' : normalized;

        await env.RECEIPTS.put(key, bytes, {
          httpMetadata: { contentType: storedType },
          customMetadata: {
            userId: user.id,
            tripId,
            expenseId,
          },
        });

        const now = new Date().toISOString();
        await execute(
          env.TURSO_DATABASE_URL,
          env.TURSO_AUTH_TOKEN,
          `UPDATE expenses
           SET receipt_key = ?, receipt_status = 'attached', updated_at = ?
           WHERE id = ? AND trip_id = ? AND user_id = ?`,
          [key, now, expenseId, tripId, user.id]
        );

        return json({ key, receiptStatus: 'attached' }, 201);
      }

      if (request.method === 'GET' && path.startsWith('/receipts/')) {
        const key = decodeURIComponent(path.replace(/^\/receipts\//, ''));
        if (!key || key.includes('..')) {
          return errorResponse(400, 'Invalid key');
        }

        // Ownership: receipt key must belong to an expense owned by this user.
        const owned = await execute(
          env.TURSO_DATABASE_URL,
          env.TURSO_AUTH_TOKEN,
          `SELECT expenses.id
           FROM expenses
           INNER JOIN trips ON trips.id = expenses.trip_id AND trips.user_id = expenses.user_id
           WHERE expenses.receipt_key = ? AND expenses.user_id = ?
           LIMIT 1`,
          [key, user.id]
        );
        let isOwned = Boolean(owned.rows[0]);
        if (!isOwned) {
          const taxWorkOwned = await execute(
            env.TURSO_DATABASE_URL,
            env.TURSO_AUTH_TOKEN,
            `SELECT id FROM tax_work_expenses
             WHERE receipt_key = ? AND user_id = ?
             LIMIT 1`,
            [key, user.id]
          );
          isOwned = Boolean(taxWorkOwned.rows[0]);
        }
        if (!isOwned) {
          return errorResponse(404, 'Not found');
        }

        const object = await env.RECEIPTS.get(key);
        if (!object) {
          return errorResponse(404, 'Not found');
        }

        const headers = new Headers(corsHeaders());
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Cache-Control', 'private, max-age=300');
        return new Response(object.body, { headers });
      }

      return errorResponse(404, 'Not found');
    } catch (error) {
      if (error instanceof AuthError) {
        return errorResponse(error.status, error.message);
      }
      console.error('Worker error', error instanceof Error ? error.message : 'unknown');
      return errorResponse(500, 'Server error');
    }
  },
};
