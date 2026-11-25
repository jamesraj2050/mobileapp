import { expenseTypeMeta } from '@/constants/expense-types';
import type { Trip } from '@/types/expense';
import { formatDate, formatMoney } from '@/utils/format';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function expenseStatementFileName(trip: Trip): string {
  const tripName = (trip.name || `${trip.from}-${trip.to}`)
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `Trip-Report-${tripName || trip.id.slice(0, 8)}`;
}

export function buildExpenseStatementHtml(trip: Trip): string {
  const expenses = [...trip.expenses].sort((a, b) => a.date.localeCompare(b.date));
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const rows =
    expenses.length > 0
      ? expenses
          .map((expense, index) => {
            const type = expenseTypeMeta(expense.type).label;
            return `
              <tr>
                <td class="serial">${index + 1}</td>
                <td>${escapeHtml(formatDate(expense.date))}</td>
                <td>${escapeHtml(type)}</td>
                <td class="amount">${escapeHtml(formatMoney(expense.amount))}</td>
                <td class="receipt">${expense.receiptStatus === 'attached' ? 'Yes' : 'No'}</td>
              </tr>`;
          })
          .join('')
      : '<tr><td colspan="5" class="empty">No expenses recorded</td></tr>';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      @page { margin: 24px; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #000; font-family: Arial, Helvetica, sans-serif; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td { border: 1px solid #000; padding: 7px 6px; vertical-align: middle; }
      .meta th { width: 110px; text-align: left; font-weight: 700; }
      .meta td { font-weight: 600; }
      .report { margin-top: 12px; }
      .report thead th { background: #FFF200; text-align: left; font-weight: 700; }
      .report th:nth-child(1), .report td:nth-child(1) { width: 55px; }
      .report th:nth-child(2), .report td:nth-child(2) { width: 105px; }
      .report th:nth-child(4), .report td:nth-child(4) { width: 95px; }
      .report th:nth-child(5), .report td:nth-child(5) { width: 150px; }
      .serial, .receipt { text-align: center; }
      .amount { text-align: right; white-space: nowrap; }
      .empty { height: 80px; text-align: center; }
      .total-label { text-align: right; font-weight: 700; }
      .total-amount { background: #FFF200; font-weight: 800; }
    </style>
  </head>
  <body>
    <table class="meta">
      <tbody>
        <tr><th>Trip Name</th><td>${escapeHtml(trip.name || `${trip.from} to ${trip.to}`)}</td></tr>
        <tr><th>Start Date</th><td>${escapeHtml(formatDate(trip.startDate))}</td></tr>
        <tr><th>End Date</th><td>${escapeHtml(formatDate(trip.endDate))}</td></tr>
      </tbody>
    </table>
    <table class="report">
      <thead>
        <tr>
          <th>SL No</th>
          <th>Date</th>
          <th>Type of expense</th>
          <th>Amount</th>
          <th>Receipt attached (Yes/No)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" class="total-label">Total</td>
          <td class="amount total-amount">${escapeHtml(formatMoney(total))}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  </body>
</html>`;
}
