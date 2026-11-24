# Finance Tracker

A personal finance tracker that runs entirely in your browser. There is nothing to install and no account to create, and your data never leaves your device.

## Features

Built to need just a few minutes a month, with no daily expense logging.

- **Overview**: net worth and how it changed since last month, a net worth chart, bills due in the next 30 days, goal progress, and this month's spending.
- **Check-in**: once a month, type in each account's balance (bank, savings, investments, credit cards, loans). Last month's values are filled in, so you only change what moved.
- **Bills**: rent, utilities, insurance and subscriptions, each with how often it's paid. Shows your monthly and yearly totals, what's due next, and a breakdown by category.
- **Goals**: savings goals with progress bars. Set a target date and it tells you how much to save each month.
- **Spending**: import the CSV file your bank lets you download. Columns, number formats and date formats are detected automatically, purchases are sorted into categories, and when you correct a category it's remembered for that shop. Duplicate rows are skipped, so re-importing a file is safe.
- **Data**: download a backup and restore it, change the currency, or load sample data to explore.

## Usage

Open `index.html` in any modern browser. Or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

1. Add your accounts and their current balances (Check-in tab).
2. Add your bills and subscriptions, and any savings goals.
3. Once a month: do the check-in and import your bank's CSV file.

### Install it as an app

Once the app is hosted at a web address (for example with GitHub Pages or Netlify), you can install it:

- **iPhone/iPad (Safari):** tap Share → *Add to Home Screen*.
- **Android (Chrome):** tap ⋮ → *Install app* (or *Add to Home screen*).
- **Mac/Windows (Chrome or Edge):** click the install icon in the address bar.

It opens in its own window with its own icon, and works offline.

Data is saved in your browser's `localStorage`. Clearing site data erases it, so **download a backup regularly** (Data tab).

## Development

- `finance.js`: pure calculation logic (net worth, bills, goals, bank file parsing, categories)
- `app.js`: UI and state
- `finance.test.js`: tests, run with `node --test`
