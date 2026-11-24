// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./finance.js');

const accounts = [
  { id: 'chk', name: 'Checking', type: 'asset' },
  { id: 'sav', name: 'Savings', type: 'asset' },
  { id: 'cc', name: 'Card', type: 'liability' },
];
const snapshots = {
  '2026-08': { chk: 1000, sav: 5000, cc: 300 },
  '2026-10': { chk: 1500, cc: 100 }, // savings not updated -> carried forward
};

test('balances carry forward from the last check-in', () => {
  assert.deepEqual(F.balancesAt(accounts, snapshots, '2026-09'), { chk: 1000, sav: 5000, cc: 300 });
  assert.deepEqual(F.balancesAt(accounts, snapshots, '2026-11'), { chk: 1500, sav: 5000, cc: 100 });
  assert.deepEqual(F.balancesAt(accounts, snapshots, '2026-07'), {});
});

test('net worth and history', () => {
  assert.deepEqual(F.netWorthAt(accounts, snapshots, '2026-10'), { assets: 6500, liabilities: 100, net: 6400 });
  const h = F.netWorthHistory(accounts, snapshots, '2026-11');
  assert.deepEqual(h.map((x) => x.month), ['2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(h.map((x) => x.net), [5700, 5700, 6400, 6400]);
  assert.deepEqual(h.map((x) => x.checkedIn), [true, false, true, false]);
});

test('month helpers wrap across years', () => {
  assert.deepEqual(F.lastMonths('2026-02', 4), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.equal(F.addMonthsToKey('2026-01', -1), '2025-12');
  assert.equal(F.addMonthsToKey('2026-12', 1), '2027-01');
});

test('next due date for each frequency', () => {
  assert.equal(F.nextDueDate({ dueDate: '2026-01-31', frequency: 'monthly' }, '2026-02-10'), '2026-02-28');
  assert.equal(F.nextDueDate({ dueDate: '2026-01-31', frequency: 'monthly' }, '2026-03-01'), '2026-03-31');
  assert.equal(F.nextDueDate({ dueDate: '2026-01-15', frequency: 'monthly' }, '2026-11-15'), '2026-11-15');
  assert.equal(F.nextDueDate({ dueDate: '2025-03-01', frequency: 'yearly' }, '2026-11-24'), '2027-03-01');
  assert.equal(F.nextDueDate({ dueDate: '2026-01-10', frequency: 'quarterly' }, '2026-11-24'), '2027-01-10');
  assert.equal(F.nextDueDate({ dueDate: '2026-11-02', frequency: 'weekly' }, '2026-11-24'), '2026-11-30');
  assert.equal(F.nextDueDate({ dueDate: '2026-12-05', frequency: 'monthly' }, '2026-11-24'), '2026-12-05');
});

test('bill totals and upcoming', () => {
  const bills = [
    { name: 'Rent', amount: 1200, frequency: 'monthly', dueDate: '2026-01-01', category: 'Housing' },
    { name: 'Insurance', amount: 600, frequency: 'yearly', dueDate: '2026-12-01', category: 'Insurance' },
    { name: 'Gym', amount: 10, frequency: 'weekly', dueDate: '2026-11-23', category: 'Health' },
    { name: 'Old', amount: 99, frequency: 'monthly', dueDate: '2026-01-01', paused: true },
  ];
  const t = F.billTotals(bills);
  assert.equal(t.perMonth, F.round2(1200 + 50 + 10 * 52 / 12));
  assert.equal(t.byCategory[0].category, 'Housing');
  const up = F.upcomingBills(bills, '2026-11-24', 14);
  assert.deepEqual(up.map((u) => [u.bill.name, u.due]), [['Gym', '2026-11-30'], ['Rent', '2026-12-01'], ['Insurance', '2026-12-01'], ['Gym', '2026-12-07']].slice(0, 3));
});

test('bill totals are split by kind and skip varying amounts', () => {
  const bills = [
    { amount: 2700, frequency: 'monthly', kind: 'bill' },
    { amount: 0, frequency: 'monthly', kind: 'bill', variable: true },
    { amount: 1500, frequency: 'monthly', kind: 'saving' },
    { amount: 1500, frequency: 'monthly', kind: 'investing' },
    { amount: 100, frequency: 'monthly' }, // no kind = bill
  ];
  assert.equal(F.billTotals(bills).perMonth, 2800);
  assert.equal(F.billTotals(bills, 'saving').perMonth, 1500);
  assert.equal(F.billTotals(bills, 'investing').perMonth, 1500);
});

test('goal linked to an account follows its check-in balance', () => {
  const g = { target: 50000, saved: 1, accountId: 'sav' };
  assert.equal(F.goalSaved(g, accounts, snapshots, '2026-11'), 5000);
  assert.equal(F.goalSaved({ ...g, accountId: 'nope' }, accounts, snapshots, '2026-11'), 1);
  assert.equal(F.goalSaved({ target: 10, saved: 4 }, accounts, snapshots, '2026-11'), 4);
});

test('pay-in-full streak', () => {
  const p = { '2026-08': { cc: true }, '2026-09': { cc: true }, '2026-10': { cc: true }, '2026-11': {} };
  assert.equal(F.payInFullStreak(p, 'cc', '2026-11'), 3); // November not ticked yet: streak kept
  assert.equal(F.payInFullStreak({ ...p, '2026-11': { cc: true } }, 'cc', '2026-11'), 4);
  assert.equal(F.payInFullStreak({ ...p, '2026-09': {} }, 'cc', '2026-11'), 1);
  assert.equal(F.payInFullStreak({}, 'cc', '2026-11'), 0);
});

test('goal progress', () => {
  const g = F.goalProgress({ target: 5000, saved: 2000, targetDate: '2027-05-24' }, '2026-11-24');
  assert.equal(g.remaining, 3000);
  assert.equal(g.perMonth, 500);
  assert.equal(g.done, false);
  assert.equal(F.goalProgress({ target: 100, saved: 150 }, '2026-11-24').done, true);
  assert.equal(F.goalProgress({ target: 100, saved: 10, targetDate: '2026-01-01' }, '2026-11-24').overdue, true);
});

test('parseAmount handles many formats', () => {
  const cases = { '-45.10': -45.1, '1,234.56': 1234.56, '1.234,56': 1234.56, '-1.234,56 €': -1234.56, '(12.00)': -12,
    '12.00-': -12, '$ -3.5': -3.5, '45,1': 45.1, '1,000': 1000, '1.000': 1000, '': NaN, 'abc': NaN, '£2,500.00': 2500 };
  for (const [s, v] of Object.entries(cases)) {
    if (Number.isNaN(v)) assert.ok(Number.isNaN(F.parseAmount(s)), s);
    else assert.equal(F.parseAmount(s), v, s);
  }
});

test('parseDate and format guessing', () => {
  assert.equal(F.parseDate('2026-11-03', 'mdy'), '2026-11-03');
  assert.equal(F.parseDate('03/11/2026', 'dmy'), '2026-11-03');
  assert.equal(F.parseDate('03/11/2026', 'mdy'), '2026-03-11');
  assert.equal(F.parseDate('3.11.26', 'dmy'), '2026-11-03');
  assert.equal(F.parseDate('24 Nov 2026'), '2026-11-24');
  assert.equal(F.parseDate('Nov 24, 2026'), '2026-11-24');
  assert.equal(F.parseDate('31/02/2026', 'dmy'), null);
  assert.equal(F.guessDateFormat(['01/02/2026', '25/02/2026']), 'dmy');
  assert.equal(F.guessDateFormat(['02/01/2026', '02/25/2026']), 'mdy');
  assert.equal(F.guessDateFormat(['01/02/2026'], 'mdy'), 'mdy');
  assert.equal(F.guessDateFormat(['03.11.2026', '07.11.2026'], 'mdy'), 'dmy');
  assert.equal(F.guessDateFormat(['03/11/2026', '07/11/2026', '09/11/2026'], 'mdy'), 'dmy'); // Nov 3–9, not Mar–Sep
  assert.equal(F.guessDateFormat(['11/03/2026', '11/07/2026', '11/09/2026'], 'dmy'), 'mdy');
});

test('bank CSV: semicolons, preamble, signed amounts', () => {
  const csv = '﻿Account;12345\n\nBooking date;Description;Amount\n03.11.2026;"TESCO STORES 123";-45,10\n05.11.2026;Salary ACME;2.500,00\n06.11.2026;Junk;\n';
  const table = F.parseCsv(csv);
  const g = F.guessColumns(table);
  assert.equal(g.headerIndex, 1);
  assert.deepEqual(g.columns, { date: 0, description: 1, amount: 2, debit: -1, credit: -1 });
  const { rows, skipped } = F.mapRows(table, g.headerIndex, { ...g.columns, mode: 'signed', spendingSign: 'negative', dateFormat: 'dmy' });
  assert.equal(skipped, 1);
  assert.deepEqual(rows, [
    { date: '2026-11-03', description: 'TESCO STORES 123', amount: 45.1, kind: 'out' },
    { date: '2026-11-05', description: 'Salary ACME', amount: 2500, kind: 'in' },
  ]);
});

test('bank CSV: separate debit and credit columns', () => {
  const table = F.parseCsv('Date,Details,Money Out,Money In\n2026-11-01,Netflix,15.99,\n2026-11-02,Refund,,20\n');
  const g = F.guessColumns(table);
  assert.equal(g.columns.debit, 2);
  assert.equal(g.columns.credit, 3);
  const { rows } = F.mapRows(table, g.headerIndex, { ...g.columns, mode: 'split', dateFormat: 'dmy' });
  assert.deepEqual(rows.map((r) => [r.kind, r.amount]), [['out', 15.99], ['in', 20]]);
});

test('categorize uses remembered rules, then keywords', () => {
  assert.equal(F.categorize('TESCO STORES 3321', 'out', {}), 'Groceries');
  assert.equal(F.categorize('NETFLIX.COM 866', 'out', {}), 'Subscriptions');
  assert.equal(F.categorize('Mystery shop', 'out', {}), 'Other');
  assert.equal(F.categorize('Employer Ltd', 'in', {}), 'Income');
  const rules = { [F.merchantKey('Mystery shop 0042')]: 'Shopping' };
  assert.equal(F.categorize('MYSTERY SHOP 9911', 'out', rules), 'Shopping');
});

test('spending summary excludes transfers and separates income', () => {
  const entries = [
    { date: '2026-11-01', amount: 50, kind: 'out', category: 'Groceries' },
    { date: '2026-11-02', amount: 30, kind: 'out', category: 'Groceries' },
    { date: '2026-11-03', amount: 500, kind: 'out', category: F.EXCLUDED },
    { date: '2026-11-04', amount: 2000, kind: 'in', category: 'Income' },
    { date: '2026-10-04', amount: 99, kind: 'out', category: 'Other' },
  ];
  assert.deepEqual(F.spendingSummary(entries, '2026-11'), { spent: 80, income: 2000, byCategory: [{ category: 'Groceries', total: 80 }] });
});

// ---- Monthly plan, income, goal projections ----

const myBills = [
  { name: 'Paycheck 1st', kind: 'income', amount: 5000, frequency: 'monthly', dueDate: '2026-12-01', endMonth: '2026-12' },
  { name: 'Paycheck 15th', kind: 'income', amount: 5000, frequency: 'monthly', dueDate: '2026-12-15', endMonth: '2026-12' },
  { name: 'New paycheck 1st', kind: 'income', amount: 6000, frequency: 'monthly', dueDate: '2027-01-01', startMonth: '2027-01' },
  { name: 'New paycheck 15th', kind: 'income', amount: 6000, frequency: 'monthly', dueDate: '2027-01-15', startMonth: '2027-01' },
  { name: 'Rent', kind: 'bill', amount: 2700, frequency: 'monthly', dueDate: '2026-12-01' },
  { name: 'Card', kind: 'bill', variable: true, amount: 0, frequency: 'monthly', dueDate: '2026-12-01' },
  { name: 'To Cap One', kind: 'saving', amount: 1500, frequency: 'monthly', dueDate: '2026-12-15', toAccountId: 'capone' },
  { name: 'To Fidelity', kind: 'investing', amount: 1500, frequency: 'monthly', dueDate: '2026-12-15', toAccountId: 'fid' },
];
const myAccounts = [{ id: 'amex', type: 'liability', monthlyLimit: 3000 }, { id: 'capone', type: 'asset' }];

test('monthly plan uses income active in that month and the card limit', () => {
  const dec = F.monthlyPlan(myBills, myAccounts, '2026-12');
  assert.deepEqual([dec.income, dec.bills, dec.cardSpending, dec.saving, dec.investing, dec.left], [10000, 2700, 3000, 1500, 1500, 1300]);
  assert.equal(F.monthlyPlan(myBills, myAccounts, '2027-01').left, 3300);
});

test('upcoming list shows a future salary only from its start month', () => {
  const up = F.upcomingBills(myBills, '2026-11-24', 40).map((u) => `${u.bill.name}@${u.due}`);
  assert.ok(up.includes('Paycheck 1st@2026-12-01'));
  assert.ok(up.includes('New paycheck 1st@2027-01-01'));
  assert.ok(!up.some((x) => x.startsWith('New paycheck 15th')));
  assert.ok(!up.some((x) => x === 'Paycheck 1st@2027-01-01'));
});

test('occurrences between two dates', () => {
  assert.equal(F.occurrences(myBills[6], '2026-11-25', '2027-12-31').length, 13); // Dec 15 2026 .. Dec 15 2027
  assert.equal(F.occurrences(myBills[0], '2026-11-25', '2027-12-31').length, 1); // ends Dec 2026
});

test('apartment goal: savings + automatic transfers + expected amounts', () => {
  const goal = { target: 300000, targetDate: '2027-12-31', accountIds: ['capone', 'fid', 'citi'],
    expected: [{ label: 'Bonus', amount: 60000, date: '2027-12-15' }, { label: 'Old', amount: 999, date: '2026-01-01' }, { label: 'Done', amount: 5, date: '2027-06-01', received: true }] };
  const p = F.goalPlan(goal, 69000, myBills, '2026-11-24');
  assert.equal(p.autoPerMonth, 3000);
  assert.equal(p.auto, 39000);
  assert.equal(p.lumps, 60000);
  assert.equal(p.projected, 168000);
  assert.equal(p.onTrack, false);
  assert.equal(p.shortfall, 132000);
  assert.equal(p.monthsLeft, 13);
  const withTransfer = F.goalPlan({ ...goal, expected: [...goal.expected, { amount: 145000, date: '2026-12-31' }] }, 69000, myBills, '2026-11-24');
  assert.equal(withTransfer.projected, 313000);
  assert.equal(withTransfer.onTrack, true);
  assert.equal(withTransfer.surplus, 13000);
});

test('goal with several accounts adds their balances; goal without date estimates months', () => {
  const accts = [{ id: 'a', type: 'asset' }, { id: 'b', type: 'asset' }];
  const snaps = { '2026-11': { a: 100, b: 50 } };
  assert.equal(F.goalSaved({ accountIds: ['a', 'b'] }, accts, snaps, '2026-11'), 150);
  const p = F.goalPlan({ target: 50000, accountIds: ['hysa'] }, 33000, [{ kind: 'saving', amount: 1700, frequency: 'monthly', dueDate: '2026-12-01', toAccountId: 'hysa' }], '2026-11-24');
  assert.equal(p.monthsToReach, 10);
  assert.equal(F.goalPlan({ target: 50000, accountIds: ['hysa'] }, 33000, [], '2026-11-24').monthsToReach, null);
});

test('safety-net months, asset groups, card limit streak', () => {
  assert.equal(F.monthsCovered(33000, 5720), 5.8);
  const accts = [{ id: 'c', type: 'asset' }, { id: 'i', type: 'asset', group: 'investments' }, { id: 'r', type: 'asset', group: 'retirement' }, { id: 'x', type: 'liability' }];
  assert.deepEqual(F.assetGroups(accts, { c: 38000, i: 64000, r: 88000, x: 10000 }), { cash: 38000, investments: 64000, retirement: 88000 });
  const bills = { '2026-10': { amex: 2900 }, '2026-11': { amex: 2500 }, '2026-09': { amex: 4000 } };
  assert.equal(F.underLimitStreak(bills, 'amex', 3000, '2026-12'), 2);
  assert.equal(F.underLimitStreak({ ...bills, '2026-12': { amex: 3100 } }, 'amex', 3000, '2026-12'), 0);
});

test('investment returns: balance change minus money put in', () => {
  const snaps = {
    '2026-11': { voo: 23740.78 },
    '2026-12': { voo: 24600 },      // +859.22, nothing added yet
    '2027-01': { voo: 25300 },      // +700 with 500 added -> gain 200
    '2027-02': {},                  // not checked in
    '2027-03': { voo: 26000 },      // +700 with 1000 added (Feb + Mar) -> loss -300
  };
  const contrib = { '2027-01': { voo: 500 }, '2027-02': { voo: 500 }, '2027-03': { voo: 500 }, '2026-11': { voo: 9999 } };
  const r = F.investmentReturns('voo', snaps, contrib, '2027-03');
  assert.equal(r.startMonth, '2026-11');
  assert.equal(r.added, 1500); // Nov contribution is before tracking starts, so it's ignored
  assert.equal(r.gain, F.round2(26000 - 23740.78 - 1500));
  assert.deepEqual(r.periods.map((p) => [p.month, p.added, p.gain]), [['2026-12', 0, 859.22], ['2027-01', 500, 200], ['2027-03', 1000, -300]]);
  assert.ok(Math.abs(r.periods[1].pct - 200 / 25100) < 1e-9);
  const all = F.investmentReturns('voo', snaps, contrib, '2027-03', 20000);
  assert.equal(all.invested, 21500);
  assert.equal(all.allTimeGain, 4500);
  assert.equal(F.investmentReturns('nope', snaps, contrib, '2027-03'), null);
  assert.equal(F.investmentReturns('voo', snaps, contrib, '2026-11').periods.length, 0);
});
