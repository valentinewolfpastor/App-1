// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./finance.js');

const accounts = [
  { id: 'chk', name: 'Checking', type: 'asset', openingBalance: 1000 },
  { id: 'cc', name: 'Card', type: 'liability', openingBalance: 200 },
];
const tx = [
  { date: '2026-10-01', type: 'income', amount: 3000, accountId: 'chk', category: 'Salary' },
  { date: '2026-10-03', type: 'expense', amount: 150, accountId: 'cc', category: 'Groceries' },
  { date: '2026-10-04', type: 'expense', amount: 50.5, accountId: 'chk', category: 'Groceries' },
  { date: '2026-10-10', type: 'transfer', amount: 300, accountId: 'chk', toAccountId: 'cc' },
  { date: '2026-11-02', type: 'expense', amount: 80, accountId: 'chk', category: 'Dining out' },
];

test('account balances handle income, expenses, transfers and liabilities', () => {
  const b = F.accountBalances(accounts, tx);
  assert.equal(b.chk, 1000 + 3000 - 50.5 - 300 - 80);
  assert.equal(b.cc, 200 + 150 - 300); // owed
});

test('net worth = assets - liabilities', () => {
  const nw = F.netWorth(accounts, tx);
  assert.equal(nw.assets, 3569.5);
  assert.equal(nw.liabilities, 50);
  assert.equal(nw.net, 3519.5);
});

test('month summary excludes transfers', () => {
  const s = F.monthSummary(tx, '2026-10');
  assert.equal(s.income, 3000);
  assert.equal(s.expenses, 200.5);
  assert.equal(s.net, 2799.5);
  assert.ok(Math.abs(s.savingsRate - 2799.5 / 3000) < 1e-9);
  assert.equal(F.monthSummary(tx, '2026-09').savingsRate, null);
});

test('spending by category and budgets', () => {
  assert.deepEqual(F.spendingByCategory(tx, '2026-10'), [{ category: 'Groceries', total: 200.5 }]);
  const [g] = F.budgetStatus({ Groceries: 200, Unused: 0 }, tx, '2026-10');
  assert.equal(g.category, 'Groceries');
  assert.equal(g.remaining, -0.5);
  assert.ok(g.ratio > 1);
});

test('lastMonths wraps across years', () => {
  assert.deepEqual(F.lastMonths('2026-02', 4), ['2025-11', '2025-12', '2026-01', '2026-02']);
});

test('CSV round trip with quotes and commas', () => {
  const rows = [{ date: '2026-10-05', type: 'expense', amount: 12.34, description: 'Coffee, "large"', category: 'Dining out', accountId: 'chk' }];
  const csv = F.transactionsToCsv(rows, accounts);
  const { rows: parsed, errors } = F.csvToTransactions(csv);
  assert.deepEqual(errors, []);
  assert.equal(parsed[0].description, 'Coffee, "large"');
  assert.equal(parsed[0].account, 'Checking');
  assert.equal(parsed[0].amount, 12.34);
});

test('bank-style CSV: negative amounts become expenses, bad rows reported', () => {
  const csv = 'Date,Description,Amount\r\n2026-10-01,Pay,2500\r\n2026-10-02,Shop,-$45.10\r\n10/03/2026,Bad,5\r\n';
  const { rows, errors } = F.csvToTransactions(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, 'income');
  assert.equal(rows[1].type, 'expense');
  assert.equal(rows[1].amount, 45.1);
  assert.equal(errors.length, 1);
});
