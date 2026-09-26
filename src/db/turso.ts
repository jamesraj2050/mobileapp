type PipelineResult = {
  results?: Array<{
    type: string;
    response?: {
      type: string;
      result?: {
        cols?: Array<{ name: string }>;
        rows?: Array<Array<{ type: string; value?: string | number | null }>>;
        affected_row_count?: number;
      };
    };
    error?: { message?: string };
  }>;
};

function requireEnv(name: 'EXPO_PUBLIC_TURSO_DATABASE_URL' | 'EXPO_PUBLIC_TURSO_AUTH_TOKEN'): string {
  const value =
    name === 'EXPO_PUBLIC_TURSO_DATABASE_URL'
      ? process.env.EXPO_PUBLIC_TURSO_DATABASE_URL
      : process.env.EXPO_PUBLIC_TURSO_AUTH_TOKEN;

  if (!value) {
    throw new Error(
      `Missing ${name}. Add it to .env and restart with: npx expo start --clear`
    );
  }
  return value;
}

function apiBaseUrl(): string {
  return requireEnv('EXPO_PUBLIC_TURSO_DATABASE_URL').replace(/^libsql:\/\//, 'https://');
}

function authHeader(): string {
  return `Bearer ${requireEnv('EXPO_PUBLIC_TURSO_AUTH_TOKEN')}`;
}

export type SqlValue = string | number | null;

export type QueryResult = {
  columns: string[];
  rows: Record<string, SqlValue>[];
};

function decodeCell(cell: { type: string; value?: string | number | null } | null): SqlValue {
  if (!cell || cell.type === 'null') return null;
  if (cell.type === 'integer' || cell.type === 'float') {
    return cell.value == null ? null : Number(cell.value);
  }
  return cell.value == null ? null : String(cell.value);
}

async function pipeline(
  requests: Array<
    | { type: 'execute'; stmt: { sql: string; args?: Array<{ type: string; value: string | number }> } }
    | { type: 'close' }
  >
): Promise<PipelineResult> {
  const response = await fetch(`${apiBaseUrl()}/v2/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Turso HTTP ${response.status}: ${text.slice(0, 180)}`);
  }

  return (await response.json()) as PipelineResult;
}

function toArgs(args: SqlValue[] = []) {
  return args.map((value) => {
    if (value == null) return { type: 'null' as const, value: 'null' };
    if (typeof value === 'number') {
      return Number.isInteger(value)
        ? { type: 'integer' as const, value: String(value) }
        : { type: 'float' as const, value: value };
    }
    return { type: 'text' as const, value: String(value) };
  });
}

export async function execute(sql: string, args: SqlValue[] = []): Promise<QueryResult> {
  const payload = await pipeline([
    {
      type: 'execute',
      stmt: {
        sql,
        args: toArgs(args),
      },
    },
    { type: 'close' },
  ]);

  const first = payload.results?.[0];
  if (first?.type === 'error') {
    throw new Error(first.error?.message ?? 'Turso query failed');
  }

  const result = first?.response?.result;
  const columns = (result?.cols ?? []).map((c) => c.name);
  const rows = (result?.rows ?? []).map((row) => {
    const obj: Record<string, SqlValue> = {};
    row.forEach((cell, index) => {
      obj[columns[index] ?? String(index)] = decodeCell(cell);
    });
    return obj;
  });

  return { columns, rows };
}

export async function executeBatch(statements: Array<{ sql: string; args?: SqlValue[] }>): Promise<void> {
  const requests = [
    ...statements.map((statement) => ({
      type: 'execute' as const,
      stmt: {
        sql: statement.sql,
        args: toArgs(statement.args ?? []),
      },
    })),
    { type: 'close' as const },
  ];

  const payload = await pipeline(requests);
  for (const item of payload.results ?? []) {
    if (item.type === 'error') {
      throw new Error(item.error?.message ?? 'Turso batch failed');
    }
  }
}

let schemaReady: Promise<void> | null = null;

export async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = executeBatch([
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
    ]);
  }
  await schemaReady;
}
