import type { AuthSession, Expense, TaxWorkExpense, Trip } from '@/types/expense';
import {
  clearAuthSession,
  loadAuthSession,
  saveAuthSession,
} from '@/auth/session';

function apiBaseUrl(): string {
  const base = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
  if (!base) {
    throw new Error(
      'Missing EXPO_PUBLIC_API_URL. Deploy the Worker and add the workers.dev URL to .env'
    );
  }
  return base;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type SessionResponse = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  user: AuthSession['user'];
};

function mapSession(payload: SessionResponse): AuthSession {
  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    accessExpiresAt: Date.parse(payload.accessExpiresAt),
    refreshExpiresAt: Date.parse(payload.refreshExpiresAt),
    user: payload.user,
  };
}

export async function createApplicationSession(googleIdToken: string): Promise<AuthSession> {
  const response = await fetch(`${apiBaseUrl()}/auth/session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${googleIdToken}` },
  });
  const payload = (await response.json().catch(() => null)) as
    | (SessionResponse & { error?: string })
    | { error?: string }
    | null;
  if (!response.ok || !payload || !('accessToken' in payload)) {
    throw new ApiError(
      response.status,
      payload?.error || `Could not create session (${response.status})`
    );
  }
  const session = mapSession(payload);
  await saveAuthSession(session);
  return session;
}

let refreshInFlight: Promise<AuthSession> | null = null;

async function refreshStoredSession(session: AuthSession): Promise<AuthSession> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const response = await fetch(`${apiBaseUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    const payload = (await response.json().catch(() => null)) as
      | (SessionResponse & { error?: string })
      | { error?: string }
      | null;
    if (!response.ok || !payload || !('accessToken' in payload)) {
      await clearAuthSession();
      throw new ApiError(401, payload?.error || 'Session expired');
    }
    const refreshed = mapSession(payload);
    await saveAuthSession(refreshed);
    return refreshed;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function revokeApplicationSession(refreshToken: string): Promise<void> {
  await fetch(`${apiBaseUrl()}/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  }).catch(() => undefined);
}

async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let session = await loadAuthSession();
  if (!session) throw new ApiError(401, 'Not signed in');
  if (Date.now() >= session.accessExpiresAt - 60_000) {
    session = await refreshStoredSession(session);
  }
  const perform = (accessToken: string) =>
    fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${accessToken}`,
      },
    });
  let response = await perform(session.accessToken);
  if (response.status === 401) {
    session = await refreshStoredSession(session);
    response = await perform(session.accessToken);
    if (response.status === 401) await clearAuthSession();
  }
  return response;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await authenticatedFetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';
    throw new ApiError(
      0,
      message === 'Failed to fetch' || message.includes('Network request failed')
        ? `Cannot reach API at ${apiBaseUrl()}. Check EXPO_PUBLIC_API_URL and that the Worker is deployed.`
        : message
    );
  }

  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string; id?: string; ok?: boolean; service?: string })
    | { error?: string; id?: string; ok?: boolean; service?: string }
    | null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      (payload && 'error' in payload && payload.error) || `Request failed (${response.status})`
    );
  }

  // Old Worker returns { ok: true, service: "receipt-upload" } for unknown routes.
  if (
    payload &&
    typeof payload === 'object' &&
    'ok' in payload &&
    payload.ok === true &&
    'service' in payload &&
    !('id' in payload)
  ) {
    throw new ApiError(
      503,
      'API Worker is outdated. Redeploy workers/receipt-upload with the authenticated API.'
    );
  }

  return payload as T;
}

export async function fetchMe(): Promise<{ id: string; email: string | null; name: string | null }> {
  return request('/me');
}

export async function fetchRemoteTrips(): Promise<Trip[]> {
  const data = await request<{ trips: RemoteTrip[] }>('/trips');
  return data.trips.map(mapRemoteTrip);
}

export async function deleteRemoteTrip(tripId: string): Promise<void> {
  await request<{ ok: true }>(`/trips/${encodeURIComponent(tripId)}`, {
    method: 'DELETE',
  });
}

type RemoteExpense = {
  id: string;
  tripId: string;
  type: string;
  date: string;
  amount: number;
  description: string;
  details?: Expense['details'];
  receiptUri: string | null;
  receiptKey: string | null;
  receiptStatus: string;
  receiptDetectedAmount: number | null;
  createdAt: string;
  updatedAt: string;
};

type RemoteTrip = {
  id: string;
  from: string;
  to: string;
  startDate: string;
  endDate: string;
  name: string;
  status: string;
  expenses: RemoteExpense[];
  createdAt: string;
  updatedAt: string;
};

function mapRemoteExpense(expense: RemoteExpense): Expense {
  return {
    id: expense.id,
    type: expense.type as Expense['type'],
    date: expense.date,
    amount: expense.amount,
    description: expense.description ?? '',
    details: expense.details ?? {},
    receiptUri: expense.receiptUri,
    localReceiptUri: null,
    receiptKey: expense.receiptKey,
    receiptStatus: expense.receiptStatus as Expense['receiptStatus'],
    receiptDetectedAmount: expense.receiptDetectedAmount,
    receiptUploadStatus: expense.receiptKey ? 'synced' : 'pending',
    syncStatus: 'synced',
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
  };
}

function mapRemoteTrip(trip: RemoteTrip): Trip {
  return {
    id: trip.id,
    from: trip.from,
    to: trip.to,
    startDate: trip.startDate,
    endDate: trip.endDate,
    name: trip.name,
    status: trip.status as Trip['status'],
    expenses: (trip.expenses ?? []).map(mapRemoteExpense),
    syncStatus: 'synced',
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
  };
}

type RemoteTaxWorkExpense = RemoteExpense & {
  expenseCategory: 'tax_work';
  currency: string;
  otherType: TaxWorkExpense['otherType'];
  otherDescription: string;
  retentionPolicy: TaxWorkExpense['retentionPolicy'];
};

function mapRemoteTaxWorkExpense(expense: RemoteTaxWorkExpense): TaxWorkExpense {
  return {
    ...mapRemoteExpense(expense),
    expenseCategory: 'tax_work',
    currency: expense.currency ?? 'AUD',
    otherType: expense.otherType ?? null,
    otherDescription: expense.otherDescription ?? '',
    retentionPolicy: 'tax_work_3_year_minimum',
  };
}

export async function fetchRemoteTaxWorkExpenses(): Promise<TaxWorkExpense[]> {
  const data = await request<{ expenses: RemoteTaxWorkExpense[] }>('/tax-work/expenses');
  return data.expenses.map(mapRemoteTaxWorkExpense);
}

export async function postTaxWorkSync(expenses: TaxWorkExpense[]): Promise<{
  syncedExpenseIds: string[];
  expenses: TaxWorkExpense[];
}> {
  const data = await request<{
    syncedExpenseIds: string[];
    expenses: RemoteTaxWorkExpense[];
  }>('/tax-work/sync', {
    method: 'POST',
    body: JSON.stringify({
      expenses: expenses.map((expense) => ({
        id: expense.id,
        type: expense.type,
        description: expense.description,
        currency: expense.currency,
        otherType: expense.otherType,
        otherDescription: expense.otherDescription,
        date: expense.date,
        amount: expense.amount,
        receiptDetectedAmount: expense.receiptDetectedAmount,
        // Device file paths are never useful on another device; R2 receiptKey is portable.
        receiptUri: null,
        receiptKey: expense.receiptKey,
        receiptStatus: expense.receiptStatus,
        retentionPolicy: expense.retentionPolicy,
        createdAt: expense.createdAt,
        updatedAt: expense.updatedAt,
      })),
    }),
  });
  return {
    syncedExpenseIds: data.syncedExpenseIds,
    expenses: data.expenses.map(mapRemoteTaxWorkExpense),
  };
}

export async function deleteRemoteTaxWorkExpense(expenseId: string): Promise<void> {
  await request<{ ok: true }>(`/tax-work/expenses/${encodeURIComponent(expenseId)}`, {
    method: 'DELETE',
  });
}

export async function fetchHiddenTaxWorkYears(): Promise<number[]> {
  const data = await request<{ years: number[] }>('/tax-work/years/hidden');
  return data.years;
}

export async function hideRemoteTaxWorkYear(year: number): Promise<void> {
  await request<{ ok: true }>(`/tax-work/years/${year}/hidden`, { method: 'PUT' });
}

export async function restoreRemoteTaxWorkYear(year: number): Promise<void> {
  await request<{ ok: true }>(`/tax-work/years/${year}/hidden`, { method: 'DELETE' });
}

export async function permanentlyDeleteRemoteTaxWorkYear(year: number): Promise<void> {
  await request<{ ok: true }>(`/tax-work/years/${year}`, { method: 'DELETE' });
}

export async function postSync(payload: {
  trips: {
    id: string;
    from: string;
    to: string;
    startDate: string;
    endDate: string;
    name: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }[];
  expenses: {
    id: string;
    tripId: string;
    type: string;
    date: string;
    amount: number;
    description: string;
    details?: Expense['details'];
    receiptUri: string | null;
    receiptKey: string | null;
    receiptStatus: string;
    receiptDetectedAmount: number | null;
    createdAt: string;
    updatedAt: string;
  }[];
}): Promise<{
  syncedTripIds: string[];
  syncedExpenseIds: string[];
  trips: Trip[];
}> {
  const data = await request<{
    syncedTripIds: string[];
    syncedExpenseIds: string[];
    trips: RemoteTrip[];
  }>('/sync', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return {
    syncedTripIds: data.syncedTripIds,
    syncedExpenseIds: data.syncedExpenseIds,
    trips: data.trips.map(mapRemoteTrip),
  };
}

export async function uploadReceiptAuthenticated(input: {
  localUri: string;
  mimeType: string;
  tripId: string;
  expenseId: string;
}): Promise<{ key: string }> {
  const fileResponse = await fetch(input.localUri);
  if (!fileResponse.ok) {
    throw new Error('Could not read the local receipt file');
  }
  const body = await fileResponse.blob();

  const response = await authenticatedFetch('/receipts/upload', {
    method: 'POST',
    headers: {
      'Content-Type': input.mimeType || 'image/jpeg',
      'X-Trip-Id': input.tripId,
      'X-Expense-Id': input.expenseId,
    },
    body,
  });

  const payload = (await response.json().catch(() => null)) as
    | { key?: string; error?: string }
    | null;

  if (!response.ok || !payload?.key) {
    throw new ApiError(
      response.status,
      payload?.error || `Receipt upload failed (${response.status})`
    );
  }

  return { key: payload.key };
}

export async function uploadTaxWorkReceiptAuthenticated(input: {
  localUri: string;
  mimeType: string;
  expenseId: string;
}): Promise<{ key: string }> {
  const fileResponse = await fetch(input.localUri);
  if (!fileResponse.ok) throw new Error('Could not read the local receipt file');
  const body = await fileResponse.blob();
  const response = await authenticatedFetch('/tax-work/receipts/upload', {
    method: 'POST',
    headers: {
      'Content-Type': input.mimeType || 'image/jpeg',
      'X-Expense-Id': input.expenseId,
    },
    body,
  });
  const payload = (await response.json().catch(() => null)) as
    | { key?: string; error?: string }
    | null;
  if (!response.ok || !payload?.key) {
    throw new ApiError(
      response.status,
      payload?.error || `Receipt upload failed (${response.status})`
    );
  }
  return { key: payload.key };
}

export type ReceiptExtraction = {
  type: 'flight' | 'car' | 'taxi' | 'bus' | 'train' | 'meal' | 'accommodation' | 'parking' | 'other' | null;
  amount: number | null;
  date: string | null;
  from: string | null;
  to: string | null;
  merchant: string | null;
};

export function normalizeReceiptMime(
  mimeType?: string | null,
  uriOrName?: string | null
): string {
  const lower = (mimeType || '').toLowerCase().split(';')[0].trim();
  if (lower === 'image/jpg') return 'image/jpeg';
  if (lower.startsWith('image/') || lower === 'application/pdf') return lower;
  const name = (uriOrName || '').toLowerCase();
  if (name.includes('.pdf')) return 'application/pdf';
  if (name.includes('.png')) return 'image/png';
  if (name.includes('.webp')) return 'image/webp';
  if (name.includes('.gif')) return 'image/gif';
  return 'image/jpeg';
}

/** Ask Worker + Gemini to read amount/date/from/to from a local receipt. Never required to save. */
export async function extractReceiptFields(input: {
  localUri: string;
  mimeType: string;
}): Promise<ReceiptExtraction> {
  const fileResponse = await fetch(input.localUri);
  if (!fileResponse.ok) {
    throw new Error('Could not read the local receipt file');
  }
  const buffer = await fileResponse.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new Error('Receipt file is empty');
  }

  // Prefer magic-byte detection — some PDFs arrive as octet-stream and were misfired as JPEG.
  const bytes = new Uint8Array(buffer);
  let mimeType = normalizeReceiptMime(input.mimeType, input.localUri);
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    mimeType = 'application/pdf';
  }

  const body = new Blob([bytes], { type: mimeType });

  let response: Response;
  try {
    response = await authenticatedFetch('/receipts/extract', {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
      },
      body,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';
    throw new ApiError(0, message);
  }

  const payload = (await response.json().catch(() => null)) as
    | { extraction?: ReceiptExtraction; error?: string }
    | null;

  if (!response.ok || !payload?.extraction) {
    throw new ApiError(
      response.status,
      payload?.error || `Receipt extraction failed (${response.status})`
    );
  }

  return payload.extraction;
}

export function isPdfMimeOrUri(mimeType?: string | null, uri?: string | null): boolean {
  if (mimeType?.toLowerCase().includes('pdf')) return true;
  if (uri?.toLowerCase().includes('.pdf')) return true;
  return false;
}

/**
 * Resolve a viewable local URI for a receipt.
 * Prefers on-device file; otherwise downloads via authenticated Worker API.
 */
export async function resolveReceiptViewUri(input: {
  localReceiptUri?: string | null;
  receiptUri?: string | null;
  receiptKey?: string | null;
}): Promise<{ uri: string; isPdf: boolean }> {
  const local = input.localReceiptUri || input.receiptUri;
  if (local && (local.startsWith('file:') || local.startsWith('content:') || local.startsWith('blob:'))) {
    return { uri: local, isPdf: isPdfMimeOrUri(null, local) };
  }

  if (!input.receiptKey) {
    throw new Error('No receipt available to view');
  }

  const response = await authenticatedFetch(
    `/receipts/${encodeURIComponent(input.receiptKey)}`
  );

  if (!response.ok) {
    throw new ApiError(response.status, 'Could not download receipt');
  }

  const contentType = response.headers.get('Content-Type') || 'image/jpeg';
  const isPdf = contentType.includes('pdf') || isPdfMimeOrUri(contentType, input.receiptKey);
  const FileSystem = await import('expo-file-system/legacy');
  const base = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!base) {
    // Web fallback: object URL
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    return { uri: objectUrl, isPdf };
  }

  const ext = isPdf ? 'pdf' : contentType.includes('png') ? 'png' : 'jpg';
  const dest = `${base}receipt-view-${Date.now()}.${ext}`;
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  // Avoid huge stack from apply; chunk base64
  const base64 = globalThis.btoa(binary);
  await FileSystem.writeAsStringAsync(dest, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return { uri: dest, isPdf };
}
