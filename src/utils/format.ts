import { randomUUID } from 'expo-crypto';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Format ISO date as "20 Sep 2026" */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Short date for expense rows: "28 Sep" */
export function formatDateShort(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]}`;
}

/** Format range as "20 Sep – 23 Sep 2026" or "20 Sep 2026 – 2 Oct 2026" */
export function formatDateRange(startIso: string, endIso: string): string {
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const [ey, em, ed] = endIso.split('-').map(Number);
  if (!sy || !sm || !sd || !ey || !em || !ed) {
    return `${formatDate(startIso)} – ${formatDate(endIso)}`;
  }

  if (sy === ey && sm === em) {
    return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]} ${ey}`;
  }
  if (sy === ey) {
    return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]} ${ey}`;
  }
  return `${formatDate(startIso)} – ${formatDate(endIso)}`;
}

export function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Accept common unambiguous date formats and convert to stored YYYY-MM-DD. */
export function parseDateInput(value: string): string | null {
  const input = value.trim();
  const yearFirst = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(input);
  const dayFirst = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(input);
  const namedMonth = /^(\d{1,2})\s+([a-zA-Z]{3,9})\s+(\d{4})$/.exec(input);

  let day: number;
  let month: number;
  let year: number;
  if (yearFirst) {
    year = Number(yearFirst[1]);
    month = Number(yearFirst[2]);
    day = Number(yearFirst[3]);
  } else if (dayFirst) {
    day = Number(dayFirst[1]);
    month = Number(dayFirst[2]);
    year = Number(dayFirst[3]);
  } else if (namedMonth) {
    const monthIndex = MONTHS.findIndex(
      (monthName) => monthName.toLowerCase() === namedMonth[2].slice(0, 3).toLowerCase()
    );
    if (monthIndex < 0) return null;
    day = Number(namedMonth[1]);
    month = monthIndex + 1;
    year = Number(namedMonth[3]);
  } else {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "perth" → "Perth", "GOLD COAST" → "Gold Coast" */
export function formatPlaceName(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => {
      if (!word) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Brisbane_to_Melbourne_20Sep2026 */
export function generateTripName(from: string, to: string, startDate: string): string {
  const clean = (s: string) =>
    s
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '');
  const [y, m, d] = startDate.split('-').map(Number);
  const dayPart =
    y && m && d ? `${d}${MONTHS[m - 1]}${y}` : startDate.replace(/-/g, '');
  return `${clean(from)}_to_${clean(to)}_${dayPart}`;
}

/** Stable device-generated UUID for idempotent sync. */
export function createId(_prefix?: string): string {
  return randomUUID();
}

export function syncGlyph(status: string): string {
  if (status === 'synced') return '✓';
  if (status === 'syncing') return '↻';
  if (status === 'failed') return '⚠';
  return '⚠';
}
