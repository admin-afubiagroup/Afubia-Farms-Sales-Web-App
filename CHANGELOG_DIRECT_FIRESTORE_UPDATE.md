# Afubia Farms update — 27 October 2026

- Added atomic direct-Firestore activity notifications for saved sales and oil-turning records.
- Added dismissible admin popup notifications and retained the live branch activity list.
- Updated Firestore rules so notification writes are accepted only alongside a matching sale/conversion by the same authenticated actor and branch.
- Fixed inventory balances to include opening keg stock and opening empty 75cl/1L/5L packaging materials.
- Updated the Stock Tracker to listen to opening stock and use the same container images used elsewhere in the product UI.
- Added a regression test for admin-entered opening stock being available to salespeople for oil turning.
- Retained browser-session persistence to isolate logins between tabs.
- Added a responsive global styling layer for forms, tables, controls, and mobile stock cards.

## Verification

- `node --test functions/test/*.test.js`: 20 tests passed.
- JavaScript/JSX parser check: 33 files parsed with no syntax errors.
- `npm run build` could not be completed in this environment because the local Vite executable was unavailable and package installation timed out. Run it after `npm install` on your computer.
- Firestore rules and live Firebase writes still need to be deployed/tested against the actual Firebase project.
