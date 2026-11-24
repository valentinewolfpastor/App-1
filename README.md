# Finance Tracker

A personal finance tracker that runs entirely in your browser. There is nothing to install and no account to create, and your data never leaves your device.

## Features

Built to need just a few minutes a month, with no daily expense logging.

- **Overview**: this month's review progress, net worth (split into cash, investments and retirement), your monthly plan (income − bills − card limit − saving − investing = left over), credit card limit and paid-in-full tracking, goal progress with on-track projections, what's coming up, and spending.
- **Monthly review**: a checklist for a ~30 minute routine at the start of each month (pay & confirm, update, reflect). Enter your card bill against your limit, write a note, and see past months. Steps are editable, and you can add a monthly calendar reminder.
- **Check-in**: once a month, type in each account's balance (bank, savings, investments, credit cards, loans). Last month's values are filled in, so you only change what moved.
- **Bills**: rent, utilities, insurance and subscriptions, each with how often it's paid. Shows your monthly and yearly totals, what's due next, and a breakdown by category.
- **Investments**: for investment accounts, the check-in asks how much you put in since last time (pre-filled from your automatic transfers) and shows what each account actually earned: change in balance minus money put in, per month and since tracking started. Add your cost basis for an all-time figure.
- **Recurring**: income (with start/end months, e.g. a raise), bills, and automatic saving and investing into specific accounts.
- **Goals**: a short- and long-term goals checklist with deadlines and notes, plus savings goals that can track several accounts. They count automatic transfers and expected one-off amounts (like a bonus) to tell you whether you're on track. A safety net goal shows how many months of costs it covers.
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
