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

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Stage-1 OCR stub: suggests an amount the employee must confirm. */
export function suggestReceiptAmount(): number {
  // Demo suggestion matching PLD example; real OCR can replace this later.
  return 38.7;
}
