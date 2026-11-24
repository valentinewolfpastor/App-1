# Finance Tracker

A personal finance tracker that runs entirely in your browser. There is nothing to install and no account to create, and your data never leaves your device.

## Features

- **Dashboard**: net worth, monthly income, expenses and savings rate, a 6-month income vs. expenses chart, spending by category, and budget progress.
- **Transactions**: record income, expenses and transfers between accounts. You can search and filter by month, type or account, and edit or delete entries.
- **Accounts**: track assets (checking, savings, cash, investments) and liabilities (credit cards, loans). Balances update automatically from your transactions.
- **Budgets**: set a monthly limit per category and see how much is left. Bars turn amber near the limit and red when you go over.
- **Data**: download a JSON backup and restore it later, or export and import transactions as CSV. Bank exports with `date, description, amount` columns work too. You can also load sample data to explore.

## Usage

Open `index.html` in any modern browser. Or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

1. Add your accounts with their current balances (Accounts tab).
2. Record transactions as they happen, or import a CSV from your bank.
3. Set budgets for the categories you want to control.

### Install it as an app

Once the app is hosted at a web address (for example with GitHub Pages or Netlify), you can install it:

- **iPhone/iPad (Safari):** tap Share → *Add to Home Screen*.
- **Android (Chrome):** tap ⋮ → *Install app* (or *Add to Home screen*).
- **Mac/Windows (Chrome or Edge):** click the install icon in the address bar.

It opens in its own window with its own icon, and works offline.

Data is saved in your browser's `localStorage`. Clearing site data erases it, so **download a backup regularly** (Data tab).

## Development

- `finance.js`: pure calculation logic (balances, net worth, summaries, budgets, CSV)
- `app.js`: UI and state
- `finance.test.js`: tests, run with `node --test`
