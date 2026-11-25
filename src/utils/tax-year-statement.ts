import { expenseTypeMeta } from '@/constants/expense-types';
import type { TaxWorkExpense } from '@/types/expense';
import { formatCurrency } from '@/utils/currency';
import { formatDate } from '@/utils/format';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function taxWorkTypeLabel(expense: TaxWorkExpense): string {
  if (expense.type !== 'other') return expenseTypeMeta(expense.type).label;
  if (expense.otherType === 'house_rent') return 'House Rent Receipt';
  return expense.otherDescription || 'Custom';
}

export function taxWorkDescription(expense: TaxWorkExpense): string {
  const description = (expense.description || '').trim();
  if (description) return description;
  if (expense.type === 'meal') return 'Meal';
  return '—';
}

export function taxYearStatementFileName(year: string): string {
  return `Tax-Year-Report-${year}`;
}

export function sortTaxYearExpenses(expenses: TaxWorkExpense[]): TaxWorkExpense[] {
  return [...expenses].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)
  );
}

export function taxYearTotals(expenses: TaxWorkExpense[]): [string, number][] {
  const grouped = new Map<string, number>();
  for (const expense of expenses) {
    grouped.set(expense.currency, (grouped.get(expense.currency) ?? 0) + expense.amount);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function buildTaxYearStatementHtml(year: string, expenses: TaxWorkExpense[]): string {
  const rows = sortTaxYearExpenses(expenses);
  const totals = taxYearTotals(rows);
  const body =
    rows.length > 0
      ? rows
          .map(
            (expense) => `
              <tr>
                <td>${escapeHtml(formatDate(expense.date))}</td>
                <td>${escapeHtml(taxWorkTypeLabel(expense))}</td>
                <td>${escapeHtml(taxWorkDescription(expense))}</td>
                <td class="amount">${escapeHtml(formatCurrency(expense.amount, expense.currency))}</td>
              </tr>`
          )
          .join('')
      : '<tr><td colspan="4" class="empty">No expenses recorded</td></tr>';
  const totalRows =
    totals.length > 0
      ? totals
          .map(
            ([currency, amount], index) => `
              <tr>
                <td colspan="3" class="total-label">${index === 0 ? 'Total' : ''}</td>
                <td class="amount total-amount">${escapeHtml(formatCurrency(amount, currency))}</td>
              </tr>`
          )
          .join('')
      : `
              <tr>
                <td colspan="3" class="total-label">Total</td>
                <td class="amount total-amount">—</td>
              </tr>`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(taxYearStatementFileName(year))}</title>
    <style>
      @page { margin: 24px; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #000; font-family: Arial, Helvetica, sans-serif; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td { border: 1px solid #000; padding: 7px 6px; vertical-align: middle; }
      .meta th { width: 140px; text-align: left; font-weight: 700; }
      .meta td { font-weight: 600; }
      .report { margin-top: 12px; }
      .report thead th { background: #FFF200; text-align: left; font-weight: 700; }
      .report th:nth-child(1), .report td:nth-child(1) { width: 110px; }
      .report th:nth-child(2), .report td:nth-child(2) { width: 130px; }
      .report th:nth-child(4), .report td:nth-child(4) { width: 130px; }
      .amount { text-align: right; white-space: nowrap; }
      .empty { height: 80px; text-align: center; }
      .total-label { text-align: right; font-weight: 700; }
      .total-amount { background: #FFF200; font-weight: 800; }
    </style>
  </head>
  <body>
    <table class="meta">
      <tbody>
        <tr><th>Tax Year</th><td>${escapeHtml(year)}</td></tr>
        <tr><th>Receipts</th><td>${rows.length}</td></tr>
      </tbody>
    </table>
    <table class="report">
      <thead>
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Description</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
      <tfoot>${totalRows}</tfoot>
    </table>
  </body>
</html>`;
}
