/* global Finance */
(function () {
  'use strict';

  const STORAGE_KEY = 'finance-tracker:v1';
  const DEFAULT_CATEGORIES = [
    'Salary', 'Freelance', 'Interest', 'Gifts',
    'Rent / Mortgage', 'Utilities', 'Groceries', 'Dining out', 'Transport', 'Insurance',
    'Health', 'Shopping', 'Entertainment', 'Subscriptions', 'Travel', 'Education', 'Debt payment', 'Other',
  ];

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const today = () => new Date().toISOString().slice(0, 10);
  const thisMonth = () => today().slice(0, 7);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- State -----------------------------------------------------------

  const emptyState = () => ({ settings: { currency: 'USD' }, accounts: [], transactions: [], budgets: {} });

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...emptyState(), ...JSON.parse(raw) };
    } catch (e) { console.warn('Could not load saved data', e); }
    return emptyState();
  }

  let state = load();

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save — browser storage is unavailable or full'); }
    render();
  }

  // ---- Formatting ------------------------------------------------------

  let fmt;
  function updateFormatter() {
    fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency || 'USD' });
  }
  const money = (n) => fmt.format(n || 0);
  const monthLabel = (m) => new Date(m + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  const accountName = (id) => state.accounts.find((a) => a.id === id)?.name || '—';
  const categories = () => [...new Set([...DEFAULT_CATEGORIES, ...state.transactions.map((t) => t.category).filter(Boolean), ...Object.keys(state.budgets)])].sort();

  // ---- Navigation ------------------------------------------------------

  function showView(name) {
    $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
    try { sessionStorage.setItem('finance-tracker:view', name); } catch (e) { /* ignore */ }
  }
  $$('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

  // ---- Rendering -------------------------------------------------------

  function render() {
    updateFormatter();
    renderSelects();
    renderDashboard();
    renderTransactions();
    renderAccounts();
    renderBudgets();
    $('#settings-form').currency.value = state.settings.currency;
  }

  function renderSelects() {
    const opts = state.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
    const form = $('#tx-form');
    for (const sel of [form.accountId, form.toAccountId, $('#import-csv-account')]) {
      const prev = sel.value;
      sel.innerHTML = opts || '<option value="">Add an account first</option>';
      if (state.accounts.some((a) => a.id === prev)) sel.value = prev;
    }
    const filter = $('#tx-account-filter');
    const prevFilter = filter.value;
    filter.innerHTML = '<option value="">All accounts</option>' + opts;
    filter.value = prevFilter;
    $('#category-list').innerHTML = categories().map((c) => `<option value="${esc(c)}">`).join('');
  }

  function renderDashboard() {
    const month = $('#dash-month').value || thisMonth();
    const nw = Finance.netWorth(state.accounts, state.transactions);
    const ms = Finance.monthSummary(state.transactions, month);

    $('#stat-networth').textContent = money(nw.net);
    $('#stat-networth').className = 'value ' + (nw.net < 0 ? 'neg' : '');
    $('#stat-networth-sub').textContent = `${money(nw.assets)} assets · ${money(nw.liabilities)} debt`;
    $('#stat-income').textContent = money(ms.income);
    $('#stat-expenses').textContent = money(ms.expenses);
    $('#stat-net').textContent = money(ms.net);
    $('#stat-net').className = 'value ' + (ms.net < 0 ? 'neg' : 'pos');
    $('#stat-rate').textContent = ms.savingsRate == null ? 'No income this month' : `${Math.round(ms.savingsRate * 100)}% savings rate`;

    renderTrendChart(month);

    const cats = Finance.spendingByCategory(state.transactions, month);
    const max = cats[0]?.total || 1;
    $('#chart-categories').innerHTML = cats.length
      ? cats.slice(0, 8).map((c) => barRow(c.category, c.total / max, money(c.total))).join('')
      : '<p class="empty">No expenses this month.</p>';

    const bs = Finance.budgetStatus(state.budgets, state.transactions, month);
    $('#dash-budgets').innerHTML = bs.length
      ? bs.map((b) => barRow(b.category, b.ratio, `${money(b.spent)} / ${money(b.limit)}`, budgetClass(b.ratio))).join('')
      : '<p class="empty">No budgets set. Add some on the Budgets tab.</p>';
  }

  const budgetClass = (r) => (r > 1 ? 'over' : r > 0.85 ? 'warn' : '');

  function barRow(name, ratio, amount, cls = '') {
    const pct = Math.max(0, Math.min(1, ratio)) * 100;
    return `<div class="bar-row"><span class="name" title="${esc(name)}">${esc(name)}</span>
      <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct.toFixed(1)}%"></div></div>
      <span class="amt">${esc(amount)}</span></div>`;
  }

  function renderTrendChart(endMonth) {
    const months = Finance.lastMonths(endMonth, 6);
    const data = months.map((m) => ({ m, ...Finance.monthSummary(state.transactions, m) }));
    const max = Math.max(1, ...data.map((d) => Math.max(d.income, d.expenses)));
    const W = 480, H = 220, padL = 52, padB = 24, padT = 8;
    const plotH = H - padB - padT, plotW = W - padL;
    const groupW = plotW / months.length, barW = Math.min(22, groupW / 3);
    const y = (v) => padT + plotH - (v / max) * plotH;

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Income and expenses for the last six months">`;
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i, yy = y(v);
      svg += `<line class="grid" x1="${padL}" x2="${W}" y1="${yy}" y2="${yy}"/>`;
      svg += `<text x="${padL - 6}" y="${yy + 4}" text-anchor="end">${esc(compact(v))}</text>`;
    }
    data.forEach((d, i) => {
      const cx = padL + groupW * i + groupW / 2;
      svg += `<rect class="inc" x="${cx - barW - 1}" y="${y(d.income)}" width="${barW}" height="${padT + plotH - y(d.income)}" rx="2"><title>${esc(monthLabel(d.m))} income: ${esc(money(d.income))}</title></rect>`;
      svg += `<rect class="exp" x="${cx + 1}" y="${y(d.expenses)}" width="${barW}" height="${padT + plotH - y(d.expenses)}" rx="2"><title>${esc(monthLabel(d.m))} expenses: ${esc(money(d.expenses))}</title></rect>`;
      svg += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${esc(monthLabel(d.m))}</text>`;
    });
    svg += '</svg><div class="legend"><span class="l-inc">Income</span><span class="l-exp">Expenses</span></div>';
    $('#chart-trend').innerHTML = svg;
  }

  function compact(v) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency, notation: 'compact', maximumFractionDigits: 1 }).format(v);
  }

  function renderTransactions() {
    const q = $('#tx-search').value.trim().toLowerCase();
    const month = $('#tx-month').value;
    const type = $('#tx-type-filter').value;
    const acct = $('#tx-account-filter').value;

    const rows = state.transactions
      .filter((t) => !month || t.date.startsWith(month))
      .filter((t) => !type || t.type === type)
      .filter((t) => !acct || t.accountId === acct || t.toAccountId === acct)
      .filter((t) => !q || (t.description || '').toLowerCase().includes(q) || (t.category || '').toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));

    $('#tx-body').innerHTML = rows.length ? rows.map((t) => {
      const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
      const cls = t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : '';
      const acctCell = t.type === 'transfer' ? `${esc(accountName(t.accountId))} → ${esc(accountName(t.toAccountId))}` : esc(accountName(t.accountId));
      const cat = t.type === 'transfer' ? '<span class="pill">Transfer</span>' : esc(t.category || '');
      return `<tr>
        <td>${esc(t.date)}</td><td class="desc">${esc(t.description)}</td><td>${cat}</td><td>${acctCell}</td>
        <td class="num ${cls}">${sign}${esc(money(t.amount))}</td>
        <td><div class="row-actions">
          <button class="icon-btn" data-edit-tx="${t.id}">Edit</button>
          <button class="icon-btn" data-del-tx="${t.id}">Delete</button>
        </div></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty">No transactions match.</td></tr>';

    const inc = rows.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = rows.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    $('#tx-count').textContent = `${rows.length} transaction${rows.length === 1 ? '' : 's'} · ${money(inc)} in · ${money(exp)} out`;
  }

  function renderAccounts() {
    const bal = Finance.accountBalances(state.accounts, state.transactions);
    const nw = Finance.netWorth(state.accounts, state.transactions);
    const item = (a) => `<li><span>${esc(a.name)}</span>
      <span class="amt">${esc(money(bal[a.id]))}</span>
      <button class="icon-btn" data-edit-acct="${a.id}">Edit</button>
      <button class="icon-btn" data-del-acct="${a.id}">Delete</button></li>`;
    const assets = state.accounts.filter((a) => a.type !== 'liability');
    const liabs = state.accounts.filter((a) => a.type === 'liability');
    $('#assets-list').innerHTML = assets.map(item).join('') || '<li class="empty">No asset accounts yet.</li>';
    $('#liabs-list').innerHTML = liabs.map(item).join('') || '<li class="empty">No liabilities. Nice.</li>';
    $('#assets-total').textContent = money(nw.assets);
    $('#liabs-total').textContent = money(nw.liabilities);
  }

  function renderBudgets() {
    const month = $('#budget-month').value || thisMonth();
    const bs = Finance.budgetStatus(state.budgets, state.transactions, month);
    $('#budget-list').innerHTML = bs.length ? bs.map((b) => {
      const pct = Math.min(1, b.ratio) * 100;
      const left = b.remaining >= 0 ? `${money(b.remaining)} left` : `<span class="neg">${money(-b.remaining)} over</span>`;
      return `<div class="budget-row">
        <div class="budget-head"><strong>${esc(b.category)}</strong>
          <span class="amt">${esc(money(b.spent))} of ${esc(money(b.limit))} · ${left}</span>
          <button class="icon-btn" data-del-budget="${esc(b.category)}">Remove</button></div>
        <div class="bar-track"><div class="bar-fill ${budgetClass(b.ratio)}" style="width:${pct.toFixed(1)}%"></div></div>
      </div>`;
    }).join('') : '<p class="empty">No budgets yet. Set a monthly limit for a category above.</p>';
  }

  // ---- Transaction form ------------------------------------------------

  const txForm = $('#tx-form');

  function syncTxFormType() {
    const isTransfer = txForm.type.value === 'transfer';
    $('.to-field', txForm).hidden = !isTransfer;
    $('.cat-field', txForm).hidden = isTransfer;
  }
  txForm.type.addEventListener('change', syncTxFormType);

  function resetTxForm() {
    const keepAcct = txForm.accountId.value;
    txForm.reset();
    txForm.id.value = '';
    txForm.date.value = today();
    if (keepAcct) txForm.accountId.value = keepAcct;
    $('#tx-form-title').textContent = 'Add transaction';
    $('#tx-cancel').hidden = true;
    syncTxFormType();
  }

  txForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!state.accounts.length) { toast('Add an account first (Accounts tab)'); showView('accounts'); return; }
    const f = txForm;
    const tx = {
      id: f.id.value || uid(),
      type: f.type.value,
      date: f.date.value,
      amount: Finance.round2(Number(f.amount.value)),
      description: f.description.value.trim(),
      category: f.type.value === 'transfer' ? '' : f.category.value.trim(),
      accountId: f.accountId.value,
      toAccountId: f.type.value === 'transfer' ? f.toAccountId.value : '',
    };
    if (tx.type === 'transfer' && tx.accountId === tx.toAccountId) { toast('Pick two different accounts for a transfer'); return; }
    const i = state.transactions.findIndex((t) => t.id === tx.id);
    if (i >= 0) state.transactions[i] = { ...state.transactions[i], ...tx };
    else state.transactions.push({ ...tx, createdAt: Date.now() });
    resetTxForm();
    save();
    toast(i >= 0 ? 'Transaction updated' : 'Transaction added');
  });
  $('#tx-cancel').addEventListener('click', resetTxForm);

  $('#tx-body').addEventListener('click', (e) => {
    const editId = e.target.dataset.editTx, delId = e.target.dataset.delTx;
    if (editId) {
      const t = state.transactions.find((x) => x.id === editId);
      for (const k of ['id', 'type', 'date', 'amount', 'description', 'category', 'accountId', 'toAccountId']) txForm[k].value = t[k] ?? '';
      syncTxFormType();
      $('#tx-form-title').textContent = 'Edit transaction';
      $('#tx-cancel').hidden = false;
      txForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (delId && confirm('Delete this transaction?')) {
      state.transactions = state.transactions.filter((t) => t.id !== delId);
      save();
    }
  });

  for (const id of ['#tx-search', '#tx-month', '#tx-type-filter', '#tx-account-filter']) {
    $(id).addEventListener('input', renderTransactions);
  }

  // ---- Account form ----------------------------------------------------

  const acctForm = $('#acct-form');
  function resetAcctForm() {
    acctForm.reset();
    acctForm.id.value = '';
    $('#acct-form-title').textContent = 'Add account';
    $('#acct-cancel').hidden = true;
  }
  acctForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const a = {
      id: acctForm.id.value || uid(),
      name: acctForm.name.value.trim(),
      type: acctForm.type.value,
      openingBalance: Finance.round2(Number(acctForm.openingBalance.value) || 0),
    };
    const i = state.accounts.findIndex((x) => x.id === a.id);
    if (i >= 0) state.accounts[i] = a; else state.accounts.push(a);
    resetAcctForm();
    save();
    toast(i >= 0 ? 'Account updated' : 'Account added');
  });
  $('#acct-cancel').addEventListener('click', resetAcctForm);

  $('#view-accounts').addEventListener('click', (e) => {
    const editId = e.target.dataset.editAcct, delId = e.target.dataset.delAcct;
    if (editId) {
      const a = state.accounts.find((x) => x.id === editId);
      for (const k of ['id', 'name', 'type', 'openingBalance']) acctForm[k].value = a[k];
      $('#acct-form-title').textContent = 'Edit account';
      $('#acct-cancel').hidden = false;
      acctForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (delId) {
      const used = state.transactions.filter((t) => t.accountId === delId || t.toAccountId === delId).length;
      const msg = used ? `This account has ${used} transaction(s). Delete the account AND those transactions?` : 'Delete this account?';
      if (!confirm(msg)) return;
      state.accounts = state.accounts.filter((a) => a.id !== delId);
      state.transactions = state.transactions.filter((t) => t.accountId !== delId && t.toAccountId !== delId);
      save();
    }
  });

  // ---- Budgets ---------------------------------------------------------

  $('#budget-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    state.budgets[f.category.value.trim()] = Finance.round2(Number(f.limit.value));
    f.reset();
    save();
    toast('Budget saved');
  });
  $('#budget-list').addEventListener('click', (e) => {
    const cat = e.target.dataset.delBudget;
    if (cat != null) { delete state.budgets[cat]; save(); }
  });
  $('#budget-month').addEventListener('input', renderBudgets);
  $('#dash-month').addEventListener('input', renderDashboard);

  // ---- Settings & data -------------------------------------------------

  $('#settings-form').currency.addEventListener('change', (e) => { state.settings.currency = e.target.value; save(); });

  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const readFile = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = () => rej(r.error);
    r.readAsText(file);
  });

  $('#export-json').addEventListener('click', () => download(`finance-backup-${today()}.json`, JSON.stringify(state, null, 2), 'application/json'));

  $('#import-json').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await readFile(file));
      if (!Array.isArray(data.accounts) || !Array.isArray(data.transactions)) throw new Error('Not a finance tracker backup');
      if (!confirm('Replace all current data with this backup?')) return;
      state = { ...emptyState(), ...data };
      save();
      toast('Backup restored');
    } catch (err) { toast(`Could not restore: ${err.message}`); }
  });

  $('#export-csv').addEventListener('click', () => download(`transactions-${today()}.csv`, Finance.transactionsToCsv(state.transactions, state.accounts), 'text/csv'));

  $('#import-csv').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    const fallback = $('#import-csv-account').value;
    if (!fallback) { toast('Add an account first'); return; }
    const { rows, errors } = Finance.csvToTransactions(await readFile(file));
    const byName = Object.fromEntries(state.accounts.map((a) => [a.name.toLowerCase(), a.id]));
    let added = 0;
    for (const r of rows) {
      const accountId = byName[r.account.toLowerCase()] || fallback;
      const toAccountId = byName[r.toAccount.toLowerCase()] || '';
      const type = r.type === 'transfer' && (!toAccountId || toAccountId === accountId) ? 'expense' : r.type;
      state.transactions.push({
        id: uid(), createdAt: Date.now() + added, date: r.date, type, amount: r.amount,
        description: r.description, category: type === 'transfer' ? '' : r.category,
        accountId, toAccountId: type === 'transfer' ? toAccountId : '',
      });
      added++;
    }
    save();
    toast(`Imported ${added} transaction(s)` + (errors.length ? `, skipped ${errors.length} (${errors[0]}${errors.length > 1 ? '…' : ''})` : ''));
  });

  $('#reset-all').addEventListener('click', () => {
    if (!confirm('Erase ALL accounts, transactions and budgets? This cannot be undone. Consider downloading a backup first.')) return;
    state = emptyState();
    save();
    toast('All data erased');
  });

  $('#load-sample').addEventListener('click', () => {
    if ((state.accounts.length || state.transactions.length) && !confirm('Replace current data with sample data?')) return;
    state = sampleData();
    save();
    showView('dashboard');
    toast('Sample data loaded — erase it from the Data tab when you are ready to start');
  });

  function sampleData() {
    const s = emptyState();
    s.settings.currency = state.settings.currency;
    const chk = uid(), sav = uid(), cc = uid(), loan = uid();
    s.accounts = [
      { id: chk, name: 'Checking', type: 'asset', openingBalance: 2400 },
      { id: sav, name: 'Savings', type: 'asset', openingBalance: 8000 },
      { id: cc, name: 'Credit card', type: 'liability', openingBalance: 650 },
      { id: loan, name: 'Car loan', type: 'liability', openingBalance: 9200 },
    ];
    const months = Finance.lastMonths(thisMonth(), 6);
    const add = (date, type, amount, description, category, accountId, toAccountId = '') =>
      s.transactions.push({ id: uid(), createdAt: s.transactions.length, date, type, amount, description, category, accountId, toAccountId });
    months.forEach((m, i) => {
      const jitter = (base, spread) => Finance.round2(base + ((i * 37) % spread) - spread / 2);
      add(`${m}-01`, 'income', 4200, 'Paycheck', 'Salary', chk);
      add(`${m}-15`, 'income', 4200, 'Paycheck', 'Salary', chk);
      add(`${m}-02`, 'expense', 1650, 'Rent', 'Rent / Mortgage', chk);
      add(`${m}-05`, 'expense', jitter(140, 40), 'Electric & water', 'Utilities', chk);
      add(`${m}-06`, 'expense', jitter(210, 60), 'Supermarket', 'Groceries', cc);
      add(`${m}-19`, 'expense', jitter(190, 50), 'Supermarket', 'Groceries', cc);
      add(`${m}-09`, 'expense', jitter(95, 70), 'Restaurants', 'Dining out', cc);
      add(`${m}-11`, 'expense', 15.99, 'Streaming', 'Subscriptions', cc);
      add(`${m}-12`, 'expense', jitter(120, 50), 'Fuel', 'Transport', cc);
      add(`${m}-22`, 'expense', jitter(160, 120), 'Clothes & household', 'Shopping', cc);
      add(`${m}-25`, 'transfer', 700, 'Credit card payment', '', chk, cc);
      add(`${m}-26`, 'transfer', 320, 'Car loan payment', '', chk, loan);
      add(`${m}-27`, 'transfer', 800, 'Monthly savings', '', chk, sav);
    });
    s.budgets = { Groceries: 450, 'Dining out': 120, Shopping: 200, Transport: 150, Utilities: 160 };
    return s;
  }

  // ---- Init ------------------------------------------------------------

  $('#dash-month').value = thisMonth();
  $('#budget-month').value = thisMonth();
  resetTxForm();
  render();
  try {
    const v = sessionStorage.getItem('finance-tracker:view');
    if (v && $(`#view-${v}`)) showView(v);
  } catch (e) { /* ignore */ }
  if (!state.accounts.length) {
    toast('Welcome! Start by adding an account, or load sample data from the Data tab.');
    showView('accounts');
  }
})();
