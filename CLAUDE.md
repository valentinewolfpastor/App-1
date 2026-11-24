# Finance Tracker: notes for Claude

## What this is
A personal finance tracker that runs entirely in the browser (no build step, no server, no dependencies).
The owner is new to coding: explain things in plain language and give step-by-step instructions for anything they need to do themselves.
The app is installed on their iPhone home screen and served from GitHub Pages; pushes go live in a minute or two. Closing and reopening the home-screen app picks up the update.

## Files
- `index.html`: all screens (tabs: Overview, Monthly review, Check-in, Recurring, Goals, Spending, Data)
- `app.js`: UI and state (saved in `localStorage` under `finance-tracker:v2`)
- `finance.js`: pure calculation logic, shared by the browser and the tests
- `finance.test.js`: run with `node --test`
- `style.css`: light and dark theme
- `sw.js`, `manifest.json`, `icons/`: installable app and offline support. Bump the cache name in `sw.js` on each release.

## Data and privacy
- The user's data lives only in their browser. Claude can't see it unless they send a backup file (**Data → Download backup**).
- **Never commit personal financial data to this repo** (it may be public for GitHub Pages).
- To change their data (goals, accounts, recurring items…): ask for a fresh backup, edit the JSON in the scratchpad, verify it by loading it in Playwright, send it back with SendUserFile, and have them load it with **Data → Restore backup** (this replaces everything in the app).

## Main concepts in the data
- `accounts` (asset/liability; `group`: cash, investments or retirement; `joint`; cards: `payInFull`, `monthlyLimit`; investments: `holding`, `investedBefore`)
- `snapshots[month][accountId]`: monthly check-in balances. `snapshotDates[month]` holds the date each was saved.
- `contributions[month][accountId]`: money put into investment accounts since the previous check-in. Earned = balance change minus contributions.
- `bills`: recurring items. `kind` is income, bill, saving or investing; optional `startMonth`/`endMonth`; `toAccountId` for transfers; `variable` for card payoffs.
- `goals`: savings goals with `accountIds`, `targetDate`, `expected` one-off amounts (with a `received` flag), `milestones` and `isSafetyNet`.
- `todos`: the "My goals" checklist (`horizon` short or long, `dueDate`, `note`).
- `review`: monthly review checklist `items` plus per-month `months[m].done` and `note`. `cardBills[month][accountId]` stores the card bill entered in the review. `paidInFull[month][accountId]`.

## Before pushing
Run `node --test`, check the changed screens in Playwright (desktop and a 390px phone width, no console errors), then commit and push to the working branch.
