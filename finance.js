// Pure calculation logic for the finance tracker.
// Works in the browser (window.Finance) and in Node (module.exports) for tests.
(function (root) {
  'use strict';

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  /** "YYYY-MM" for a "YYYY-MM-DD" date string. */
  const monthKey = (date) => String(date).slice(0, 7);

  /** Last `count` month keys ending at `endMonth` (inclusive), oldest first. */
  function lastMonths(endMonth, count) {
    let [y, m] = endMonth.split('-').map(Number);
    const out = [];
    for (let i = 0; i < count; i++) {
      out.unshift(`${y}-${String(m).padStart(2, '0')}`);
      m -= 1;
      if (m === 0) { m = 12; y -= 1; }
    }
    return out;
  }

  /**
   * Balance of every account, keyed by id.
   * Assets are positive when you hold money; liabilities are reported as the
   * amount owed (positive = you owe).
   */
  function accountBalances(accounts, transactions) {
    const raw = {};
    for (const a of accounts) {
      const opening = Number(a.openingBalance) || 0;
      raw[a.id] = a.type === 'liability' ? -opening : opening;
    }
    for (const t of transactions) {
      const amt = Number(t.amount) || 0;
      if (t.type === 'income' && t.accountId in raw) raw[t.accountId] += amt;
      else if (t.type === 'expense' && t.accountId in raw) raw[t.accountId] -= amt;
      else if (t.type === 'transfer') {
        if (t.accountId in raw) raw[t.accountId] -= amt;
        if (t.toAccountId in raw) raw[t.toAccountId] += amt;
      }
    }
    const out = {};
    for (const a of accounts) {
      out[a.id] = round2(a.type === 'liability' ? -raw[a.id] : raw[a.id]);
    }
    return out;
  }

  function netWorth(accounts, transactions) {
    const bal = accountBalances(accounts, transactions);
    let assets = 0, liabilities = 0;
    for (const a of accounts) {
      if (a.type === 'liability') liabilities += bal[a.id];
      else assets += bal[a.id];
    }
    return { assets: round2(assets), liabilities: round2(liabilities), net: round2(assets - liabilities) };
  }

  /** Income, expenses, net and savings rate for one month. */
  function monthSummary(transactions, month) {
    let income = 0, expenses = 0;
    for (const t of transactions) {
      if (monthKey(t.date) !== month) continue;
      if (t.type === 'income') income += Number(t.amount) || 0;
      else if (t.type === 'expense') expenses += Number(t.amount) || 0;
    }
    const net = income - expenses;
    return {
      income: round2(income),
      expenses: round2(expenses),
      net: round2(net),
      savingsRate: income > 0 ? net / income : null,
    };
  }

  /** Expense totals by category for one month, largest first. */
  function spendingByCategory(transactions, month) {
    const totals = {};
    for (const t of transactions) {
      if (t.type !== 'expense' || monthKey(t.date) !== month) continue;
      const c = t.category || 'Uncategorized';
      totals[c] = (totals[c] || 0) + (Number(t.amount) || 0);
    }
    return Object.entries(totals)
      .map(([category, total]) => ({ category, total: round2(total) }))
      .sort((a, b) => b.total - a.total);
  }

  /** Budget vs. actual for each budgeted category in a month. */
  function budgetStatus(budgets, transactions, month) {
    const spent = Object.fromEntries(spendingByCategory(transactions, month).map((s) => [s.category, s.total]));
    return Object.entries(budgets)
      .filter(([, limit]) => Number(limit) > 0)
      .map(([category, limit]) => {
        const s = spent[category] || 0;
        return { category, limit: Number(limit), spent: s, remaining: round2(limit - s), ratio: s / limit };
      })
      .sort((a, b) => b.ratio - a.ratio);
  }

  // ---- CSV -------------------------------------------------------------

  function csvEscape(v) {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  const CSV_COLUMNS = ['date', 'description', 'type', 'category', 'amount', 'account', 'toAccount'];

  function transactionsToCsv(transactions, accounts) {
    const name = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
    const lines = [CSV_COLUMNS.join(',')];
    for (const t of transactions) {
      lines.push([t.date, t.description, t.type, t.category, t.amount, name[t.accountId] || '', name[t.toAccountId] || '']
        .map(csvEscape).join(','));
    }
    return lines.join('\n');
  }

  /**
   * Parse CSV into transaction drafts. Accepts this app's export format, or any
   * CSV with date/description/amount columns (negative amount = expense).
   * Returns { rows, errors }. Account names are returned unresolved.
   */
  function csvToTransactions(text) {
    const table = parseCsv(text);
    if (!table.length) return { rows: [], errors: ['File is empty'] };
    const header = table[0].map((h) => h.trim().toLowerCase());
    const col = (n) => header.indexOf(n.toLowerCase());
    const idx = {
      date: col('date'), description: col('description'), type: col('type'), category: col('category'),
      amount: col('amount'), account: col('account'), toAccount: col('toaccount'),
    };
    if (idx.date < 0 || idx.amount < 0) return { rows: [], errors: ['CSV needs at least "date" and "amount" columns'] };

    const rows = [], errors = [];
    table.slice(1).forEach((r, i) => {
      const get = (k) => (idx[k] >= 0 ? (r[idx[k]] || '').trim() : '');
      const date = get('date');
      let amount = Number(get('amount').replace(/[^0-9.\-]/g, ''));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push(`Row ${i + 2}: date must be YYYY-MM-DD`); return; }
      if (!Number.isFinite(amount) || get('amount') === '') { errors.push(`Row ${i + 2}: invalid amount`); return; }
      let type = get('type').toLowerCase();
      if (!['income', 'expense', 'transfer'].includes(type)) type = amount < 0 ? 'expense' : 'income';
      rows.push({
        date, type, amount: round2(Math.abs(amount)),
        description: get('description'), category: get('category'),
        account: get('account'), toAccount: get('toAccount'),
      });
    });
    return { rows, errors };
  }

  const api = {
    round2, monthKey, lastMonths, accountBalances, netWorth, monthSummary,
    spendingByCategory, budgetStatus, parseCsv, transactionsToCsv, csvToTransactions,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = api;
})(typeof window !== 'undefined' ? window : globalThis);
