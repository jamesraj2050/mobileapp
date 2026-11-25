import { execute, executeBatch } from './turso';

let schemaReady: Promise<void> | null = null;

async function addColumnIfMissing(
  databaseUrl: string,
  authToken: string,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  try {
    await execute(databaseUrl, authToken, `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (!message.includes('duplicate column')) {
      throw error;
    }
  }
}

export async function ensureSchema(databaseUrl: string, authToken: string): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await executeBatch(databaseUrl, authToken, [
        {
          sql: `CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY NOT NULL,
            google_sub TEXT UNIQUE NOT NULL,
            email TEXT,
            name TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )`,
        },
        {
          sql: `CREATE TABLE IF NOT EXISTS trips (
            id TEXT PRIMARY KEY NOT NULL,
            from_city TEXT NOT NULL,
            to_city TEXT NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            name TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL
          )`,
        },
        {
          sql: `CREATE TABLE IF NOT EXISTS expenses (
            id TEXT PRIMARY KEY NOT NULL,
            trip_id TEXT NOT NULL,
            type TEXT NOT NULL,
            date TEXT NOT NULL,
            amount REAL NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            receipt_uri TEXT,
            receipt_status TEXT NOT NULL,
            created_at TEXT NOT NULL
          )`,
        },
        {
          sql: `CREATE INDEX IF NOT EXISTS idx_expenses_trip_id ON expenses(trip_id)`,
        },
        {
          sql: `CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub)`,
        },
        {
          sql: `CREATE TABLE IF NOT EXISTS tax_work_expenses (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL,
            type TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            currency TEXT NOT NULL DEFAULT 'AUD',
            other_type TEXT,
            other_description TEXT NOT NULL DEFAULT '',
            date TEXT NOT NULL,
            amount REAL NOT NULL,
            receipt_detected_amount REAL,
            receipt_uri TEXT,
            receipt_key TEXT,
            receipt_status TEXT NOT NULL,
            retention_policy TEXT NOT NULL DEFAULT 'tax_work_3_year_minimum',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )`,
        },
        {
          sql: `CREATE INDEX IF NOT EXISTS idx_tax_work_user_date
            ON tax_work_expenses(user_id, date DESC)`,
        },
        {
          sql: `CREATE INDEX IF NOT EXISTS idx_tax_work_user_updated
            ON tax_work_expenses(user_id, updated_at)`,
        },
        {
          sql: `CREATE INDEX IF NOT EXISTS idx_tax_work_receipt_key
            ON tax_work_expenses(receipt_key)`,
        },
        {
          sql: `CREATE TABLE IF NOT EXISTS tax_work_year_preferences (
            user_id TEXT NOT NULL,
            year INTEGER NOT NULL,
            hidden_at TEXT NOT NULL,
            PRIMARY KEY (user_id, year)
          )`,
        },
        {
          sql: `CREATE TABLE IF NOT EXISTS app_sessions (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL,
            access_token_hash TEXT UNIQUE NOT NULL,
            refresh_token_hash TEXT UNIQUE NOT NULL,
            access_expires_at TEXT NOT NULL,
            refresh_expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_used_at TEXT NOT NULL
          )`,
        },
        {
          sql: `CREATE INDEX IF NOT EXISTS idx_app_sessions_user
            ON app_sessions(user_id)`,
        },
        {
          sql: `CREATE INDEX IF NOT EXISTS idx_app_sessions_access
            ON app_sessions(access_token_hash)`,
        },
        {
          sql: `CREATE INDEX IF NOT EXISTS idx_app_sessions_refresh
            ON app_sessions(refresh_token_hash)`,
        },
      ]);

      await addColumnIfMissing(databaseUrl, authToken, 'trips', 'user_id', 'TEXT');
      await addColumnIfMissing(databaseUrl, authToken, 'trips', 'updated_at', 'TEXT');
      await addColumnIfMissing(
        databaseUrl,
        authToken,
        'trips',
        'retention_policy',
        "TEXT NOT NULL DEFAULT 'business_travel_3_year_minimum'"
      );
      await addColumnIfMissing(databaseUrl, authToken, 'expenses', 'user_id', 'TEXT');
      await addColumnIfMissing(databaseUrl, authToken, 'expenses', 'updated_at', 'TEXT');
      await addColumnIfMissing(databaseUrl, authToken, 'expenses', 'receipt_key', 'TEXT');
      await addColumnIfMissing(databaseUrl, authToken, 'expenses', 'receipt_detected_amount', 'REAL');
      await addColumnIfMissing(databaseUrl, authToken, 'expenses', 'local_receipt_uri', 'TEXT');
      await addColumnIfMissing(databaseUrl, authToken, 'expenses', 'details_json', 'TEXT');
      await addColumnIfMissing(
        databaseUrl,
        authToken,
        'tax_work_expenses',
        'description',
        "TEXT NOT NULL DEFAULT ''"
      );
      await addColumnIfMissing(
        databaseUrl,
        authToken,
        'tax_work_expenses',
        'currency',
        "TEXT NOT NULL DEFAULT 'AUD'"
      );

      await executeBatch(databaseUrl, authToken, [
        {
          sql: `CREATE INDEX IF NOT EXISTS idx_trips_user_created ON trips(user_id, created_at)`,
        },
        {
          sql: `CREATE INDEX IF NOT EXISTS idx_trips_user_start ON trips(user_id, start_date)`,
        },
        {
          sql: `CREATE INDEX IF NOT EXISTS idx_expenses_user_trip ON expenses(user_id, trip_id)`,
        },
        {
          sql: `CREATE INDEX IF NOT EXISTS idx_expenses_receipt_key ON expenses(receipt_key)`,
        },
      ]);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  await schemaReady;
}
