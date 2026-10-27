# Afubia Farms — updated sales workspace

## Read this before replacing the live app

This update contains a backend as well as a redesigned front end. Deploy the Firebase Cloud Functions, Firestore rules and front end together. The old browser-only business writes are deliberately denied by the new rules, so a client cannot bypass stock checks.

Production data was not accessed, changed or migrated during this work. Verification used isolated Firebase emulators and demo accounts. Your actual project permissions, rules, Auth configuration and real device push delivery still need the acceptance checks below.

## Installation

Use Node.js 22. The emulator tests also need Java 21 or newer.

```sh
npm ci
npm --prefix functions ci
npm test
```

Copy the `.env` from your original app into this project, or create one using `.env.example`. Your private production configuration is not bundled in this download. Preserve your existing Firebase values. Add the **public** Web Push certificate key as `VITE_FIREBASE_VAPID_KEY`. Never put service-account credentials or other private server keys in `VITE_` variables.

Keep `VITE_USE_FIREBASE_EMULATORS=false` (or unset) in production.

The package excludes `node_modules` and `dist`. Install the dependencies rather than copying the old Windows dependencies, and build with your own environment configuration.

## Firebase deployment

1. Back up/export Firestore and save your existing deployed rules. Prefer a separate staging project for the first deployment.
2. Confirm your project can deploy Cloud Functions; billing-enabled Firebase service and the necessary project permissions are required.
3. In Firebase Console → Project settings → Cloud Messaging → Web configuration / Web Push certificates, generate or copy the public Web Push key into `.env`.
4. Confirm every staff member has an active `users/{Firebase Auth UID}` profile with role `salesgirl`, `salesperson` or `sales_rep`, and branch `kara` or `ogidan`. Admins need an active saved admin role; an email-based UI fallback alone does not authorize database writes.
5. Run the tests and build:

```sh
npm run test:rules
npm run test:integration
npm run build
npx firebase login
npx firebase use --add
# Choose the correct Firebase project carefully.
npx firebase deploy --only functions,firestore:rules,hosting
```

Coordinate the cutover: pause transactions, deploy the new backend/rules/front end, and ask everyone to reload. Old clients cannot keep submitting direct writes under the new rules. For non-Firebase hosting, deploy `dist` to HTTPS hosting with SPA fallback; the service worker, fonts, manifest and icons must be available at the site root. Firebase Functions and rules still need separate deployment.

## Reconcile stock before allowing staff sales

Historical records were preserved, not assumed correct. Reconcile them with physical counts.

- In **Shop Stock**, enter finished stock using its exact package size (75cl, 1L or 5L). A loose-litre balance does not prove a particular bottle size is available.
- In **Materials**, classify purchases as unturned oil kegs, empty 75cl containers, empty 1L containers or empty 5L jerrycans. Only purchased materials enter stock; pending purchases do not.
- Empty containers are consumed when oil is **turned**, not again when a filled bottle is sold.
- The existing rule of **27 usable litres per nominal 30L keg** is retained. Loose oil left after filling is tracked separately from finished bottles.
- Record unturned oil kegs as purchases, or retain supported historical keg-opening entries. Never enter the same physical kegs twice as both purchases and opening stock.
- Honey and Kuli-Kuli opening balances and sales stay separate from Palm Oil.
- For **Other** products, Product Management has separate Kara/Ogidan opening-unit totals. These are cumulative units introduced, not the current remainder. Sales are deducted automatically; increase the cumulative total when more units arrive.
- Clear historical bottle/jerrycan/keg names are matched automatically. Ambiguous materials, caps and labels are not treated as bottles. Review dashboard notices, and correct classifications with administrator access in Firestore when necessary. Do not add duplicate purchases/expenses to hide a historical discrepancy.
- Use Historical Branch Review for records without a reliable shop assignment.

If a transaction is blocked by insufficient recorded stock, correct the inventory history/physical count rather than weakening the rules.

## Browser notifications

On the deployed HTTPS app, sign in as admin, open **Activity & Browser Alerts**, click **Enable browser alerts**, and allow permission. Enable each admin device separately.

Test sales, oil turning, staff sign-in and explicit sign-out, first with the app open and then with its tab closed. Check dashboard history and system/browser notifications. Sign out of the admin account using the new Sign out button on shared devices; it removes that browser's push registration before ending the session.

Push depends on permission, connectivity, supported browser behavior and operating-system settings. Fully quitting/force-stopping a browser, disabling background delivery, being offline or denying permission can delay or prevent delivery. On a supported iPhone/iPad, install the app on the Home Screen before enabling web push. Delivery on every device at every moment is not guaranteed.

Low-stock/material alerts are live **in-app dashboard** alerts. Sales, turning and attendance generate background-push events. This version does not additionally send low-stock push messages.

Simply closing a tab or losing power is not a reliable sign-out event. Explicit and existing automatic staff sign-outs generate attendance when their database write succeeds.

## Spoken Nigerian Pidgin guidance

The recorded audio assets have been removed. Guidance uses consistent Pidgin wording through one browser speech engine. Staff can replay guidance or mute it. A Nigerian English voice is preferred when installed, otherwise an available English voice is used. Accent and sound quality depend on the device; a native Pidgin voice is not guaranteed. This is text-to-speech guidance, not dictation, as clarified in chat. A speech failure does not determine whether a sale saves.

## What changed

- Original green/cream/gold/blue palette retained; locally bundled DM Sans font and license.
- Responsive layout, clearer spacing, common admin navigation and readable form controls.
- Staff dashboard retains its two main work actions.
- Admin revenue/top-product charts, accessible chart figures, activity history and stock/material alerts.
- Server-side stock checks, exact package-size checks, material-aware turning, branch ownership, and per-request retry protection.
- Product-image serialization bug fixed: database records now store URL strings, not React image elements.
- Reports/exports, profit views, product management, branch review, staff monitoring, business-hour restrictions and location-consent behavior retained.

## Operational limitations

The backend serializes transactions with a per-shop lock and reads committed branch history before writing a record, receipt and business activity notification together. Retrying the same UUID does not duplicate that request. A deliberate new submission is a new request. Historical reads grow with the business: a large/high-volume operation should migrate to a reconciled materialized inventory ledger and undergo load testing.

There is no new offline sales queue: unverified or insufficient stock must not be sold silently while disconnected. Real background-push delivery requires your VAPID configuration and device testing; no production notification credentials were available here.

Review `QA_REPORT.md` and complete its release checklist. Keep your source ZIP and environment configuration private.
