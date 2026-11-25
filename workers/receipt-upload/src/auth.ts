import { createRemoteJWKSet, jwtVerify } from 'jose';

import { execute } from './turso';

const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const ACCESS_TOKEN_HOURS = 24;
const REFRESH_TOKEN_DAYS = 90;

export type AuthUser = {
  id: string;
  googleSub: string;
  email: string | null;
  name: string | null;
};

export type GoogleClaims = {
  sub: string;
  email?: string;
  name?: string;
  email_verified?: boolean | string;
};

export type AppSessionTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
};

function expiryIso(amount: number, unit: 'hours' | 'days'): string {
  const milliseconds = amount * (unit === 'hours' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000);
  return new Date(Date.now() + milliseconds).toISOString();
}

function randomToken(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
}

async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function mapAuthUser(row: Record<string, string | number | null>): AuthUser {
  return {
    id: String(row.id),
    googleSub: String(row.google_sub),
    email: row.email == null ? null : String(row.email),
    name: row.name == null ? null : String(row.name),
  };
}

async function issueTokens(
  databaseUrl: string,
  authToken: string,
  sessionId: string,
  userId: string,
  isNew: boolean
): Promise<AppSessionTokens> {
  const accessToken = randomToken('app_access');
  const refreshToken = randomToken('app_refresh');
  const accessExpiresAt = expiryIso(ACCESS_TOKEN_HOURS, 'hours');
  const refreshExpiresAt = expiryIso(REFRESH_TOKEN_DAYS, 'days');
  const now = new Date().toISOString();
  const values = [
    await hashToken(accessToken),
    await hashToken(refreshToken),
    accessExpiresAt,
    refreshExpiresAt,
    now,
  ];

  if (isNew) {
    await execute(
      databaseUrl,
      authToken,
      `INSERT INTO app_sessions
       (id, user_id, access_token_hash, refresh_token_hash, access_expires_at,
        refresh_expires_at, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, userId, ...values.slice(0, 4), now, now]
    );
  } else {
    await execute(
      databaseUrl,
      authToken,
      `UPDATE app_sessions
       SET access_token_hash = ?, refresh_token_hash = ?, access_expires_at = ?,
           refresh_expires_at = ?, last_used_at = ?
       WHERE id = ? AND user_id = ?`,
      [...values, sessionId, userId]
    );
  }
  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
}

export async function createAppSession(
  databaseUrl: string,
  authToken: string,
  user: AuthUser
): Promise<AppSessionTokens> {
  await execute(
    databaseUrl,
    authToken,
    `DELETE FROM app_sessions WHERE refresh_expires_at <= ?`,
    [new Date().toISOString()]
  );
  return issueTokens(databaseUrl, authToken, crypto.randomUUID(), user.id, true);
}

export async function authenticateAppSession(
  databaseUrl: string,
  authToken: string,
  accessToken: string
): Promise<AuthUser | null> {
  if (!accessToken.startsWith('app_access_')) return null;
  const result = await execute(
    databaseUrl,
    authToken,
    `SELECT users.id, users.google_sub, users.email, users.name
     FROM app_sessions
     INNER JOIN users ON users.id = app_sessions.user_id
     WHERE app_sessions.access_token_hash = ? AND app_sessions.access_expires_at > ?
     LIMIT 1`,
    [await hashToken(accessToken), new Date().toISOString()]
  );
  return result.rows[0] ? mapAuthUser(result.rows[0]) : null;
}

export async function refreshAppSession(
  databaseUrl: string,
  authToken: string,
  refreshToken: string
): Promise<{ user: AuthUser; tokens: AppSessionTokens }> {
  if (!refreshToken.startsWith('app_refresh_')) {
    throw new AuthError(401, 'Invalid refresh token');
  }
  const result = await execute(
    databaseUrl,
    authToken,
    `SELECT app_sessions.id AS session_id, app_sessions.user_id,
            users.id, users.google_sub, users.email, users.name
     FROM app_sessions
     INNER JOIN users ON users.id = app_sessions.user_id
     WHERE app_sessions.refresh_token_hash = ? AND app_sessions.refresh_expires_at > ?
     LIMIT 1`,
    [await hashToken(refreshToken), new Date().toISOString()]
  );
  const row = result.rows[0];
  if (!row) throw new AuthError(401, 'Session expired');
  const user = mapAuthUser(row);
  const tokens = await issueTokens(
    databaseUrl,
    authToken,
    String(row.session_id),
    String(row.user_id),
    false
  );
  return { user, tokens };
}

export async function revokeAppSession(
  databaseUrl: string,
  authToken: string,
  refreshToken: string
): Promise<void> {
  if (!refreshToken.startsWith('app_refresh_')) return;
  await execute(
    databaseUrl,
    authToken,
    `DELETE FROM app_sessions WHERE refresh_token_hash = ?`,
    [await hashToken(refreshToken)]
  );
}

function parseClientIds(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function verifyGoogleIdToken(
  token: string,
  googleClientIds: string | undefined
): Promise<GoogleClaims> {
  const audiences = parseClientIds(googleClientIds);
  if (audiences.length === 0) {
    throw new AuthError(500, 'Server misconfigured: GOOGLE_CLIENT_IDS missing');
  }

  const { payload } = await jwtVerify(token, googleJwks, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: audiences,
  });

  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub) {
    throw new AuthError(401, 'Invalid token: missing subject');
  }

  const emailVerified = payload.email_verified;
  if (emailVerified === false || emailVerified === 'false') {
    throw new AuthError(401, 'Google email is not verified');
  }

  return {
    sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    email_verified: emailVerified as boolean | string | undefined,
  };
}

export class AuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getOrCreateUser(
  databaseUrl: string,
  authToken: string,
  claims: GoogleClaims
): Promise<AuthUser> {
  const existing = await execute(
    databaseUrl,
    authToken,
    'SELECT id, google_sub, email, name FROM users WHERE google_sub = ? LIMIT 1',
    [claims.sub]
  );

  const now = new Date().toISOString();

  if (existing.rows[0]) {
    const row = existing.rows[0];
    const id = String(row.id);
    const email = claims.email ?? (row.email == null ? null : String(row.email));
    const name = claims.name ?? (row.name == null ? null : String(row.name));

    await execute(
      databaseUrl,
      authToken,
      'UPDATE users SET email = ?, name = ?, updated_at = ? WHERE id = ?',
      [email, name, now, id]
    );

    return {
      id,
      googleSub: String(row.google_sub),
      email,
      name,
    };
  }

  const id = crypto.randomUUID();
  await execute(
    databaseUrl,
    authToken,
    `INSERT INTO users (id, google_sub, email, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, claims.sub, claims.email ?? null, claims.name ?? null, now, now]
  );

  return {
    id,
    googleSub: claims.sub,
    email: claims.email ?? null,
    name: claims.name ?? null,
  };
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}
