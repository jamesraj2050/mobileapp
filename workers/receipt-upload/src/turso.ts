export type SqlValue = string | number | null;

export type QueryResult = {
  columns: string[];
  rows: Record<string, SqlValue>[];
};

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

function decodeCell(cell: { type: string; value?: string | number | null } | null): SqlValue {
  if (!cell || cell.type === 'null') return null;
  if (cell.type === 'integer' || cell.type === 'float') {
    return cell.value == null ? null : Number(cell.value);
  }
  return cell.value == null ? null : String(cell.value);
}

function apiBaseUrl(databaseUrl: string): string {
  return databaseUrl.replace(/^libsql:\/\//, 'https://');
}

async function pipeline(
  databaseUrl: string,
  authToken: string,
  requests: Array<
    | { type: 'execute'; stmt: { sql: string; args?: Array<{ type: string; value: string | number }> } }
    | { type: 'close' }
  >
): Promise<PipelineResult> {
  const response = await fetch(`${apiBaseUrl(databaseUrl)}/v2/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
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

export async function execute(
  databaseUrl: string,
  authToken: string,
  sql: string,
  args: SqlValue[] = []
): Promise<QueryResult> {
  const payload = await pipeline(databaseUrl, authToken, [
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

export async function executeBatch(
  databaseUrl: string,
  authToken: string,
  statements: Array<{ sql: string; args?: SqlValue[] }>
): Promise<void> {
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

  const payload = await pipeline(databaseUrl, authToken, requests);
  for (const item of payload.results ?? []) {
    if (item.type === 'error') {
      throw new Error(item.error?.message ?? 'Turso batch failed');
    }
  }
}
