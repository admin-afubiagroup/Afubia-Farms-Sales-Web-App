# Verification report — October 23, 2026

## Verified in an isolated environment

- **19 inventory unit tests passed:** stock deductions, exact last quantity, sold-out/oversell rejection, wrong package-size rejection, keg/container consumption, 27L yield, invalid counts, pending/cancelled records, category isolation, raw-keg sales, legacy matching and Other-product unit balances.
- **15 Firestore rules tests passed:** anonymous/cross-branch access denied, own-branch reads allowed, admin access, inactive accounts denied, direct business-write bypass blocked, notification privacy, role escalation blocked, attendance ownership and admin push-token registration.
- **9 backend integration tests passed:** persisted opening stock, simultaneous last-bottle contention (exactly one success), failed-write atomicity, insufficient-material turning rejection, purchased materials and conversion, retry idempotency, sale of converted stock, canonical totals, forged bypass flags rejected, independent Other-product units, and attendance-triggered sign-in/out notifications. Some test cases cover several related assertions.
- **40 responsive route/viewport checks passed** at 320, 390, 768 and 1440 CSS pixels: admin overview/products/materials/shop stock/reports/profit/packaging; staff dashboard/sales/conversion. No document-level horizontal overflow after fonts and layout settled; scrollable tables/navigation intentionally remain horizontally scrollable internally.
- Login was additionally checked at phone/tablet/desktop widths during development.
- Browser page-error collection on the route checks reported **no runtime errors**.
- Product creation through the actual browser UI succeeded with the default locally bundled image URL. This verifies the repaired image-serialization path.
- Production compilation passed. Both root and Functions lockfiles passed `npm ci --dry-run --ignore-scripts` consistency checks.
- `npm run lint` exits successfully: **0 errors, 9 warnings** retained for existing effect/refactoring patterns. These are not presented as a warning-free codebase.
- `npm audit --omit=dev` reported **0 known vulnerabilities** for root production dependencies and Functions production dependencies at verification time. This is not a guarantee of future security or a complete penetration test.
- Recorded `.m4a` assets are absent. Locally bundled DM Sans and its license are included.

Tests ran with Node 20.20.2 as the available emulator host; the configured deployment runtime is Node 22. Build tools and dependency lockfiles are included. Prefer Node 22 for installation and staging validation.

## Still requires verification in YOUR deployed project

- Production Firebase/Auth/domain/API restriction configuration and actual deployed rules.
- A real administrator and both real salesperson accounts.
- Physical inventory reconciliation against historical records, including package sizes and material classifications.
- Live save/read-back for sales, conversions, materials, opening stock and product changes.
- Browser permission, VAPID configuration, real push receipt with the tab open/closed, and supported locked-phone behavior.
- Actual device Safari/iOS/Android behavior, installed voice availability, touchscreen interaction and accessibility review. Chromium virtual viewports are representative tests, not every physical device.
- Deployment cutover, backups, restore drill and realistic performance/load testing.

No live business database was accessed or modified. Real FCM push delivery was not tested because production notification credentials and device permission were unavailable. Backend notification-document creation and attendance triggers were tested in emulators.

## Known release considerations

- The Firebase vendor bundle still produces Vite's large-chunk advisory. Compilation succeeds; further lazy-loading/bundle work may improve low-bandwidth first loads.
- Transaction queries read branch history; plan a materialized ledger for a large operation.
- Data-only web push uses a service worker and is subject to browser/OS delivery restrictions.
- Closing a tab is not reliable evidence of staff sign-out.
- Guidance uses Pidgin text with the available browser voice; a native Pidgin accent is not guaranteed.
- No new offline sales queue is included. A failed/unverified save must not be treated as successful.

## Release checklist

1. Back up database and rules; configure staging.
2. Restore your original `.env` web configuration, then add the public VAPID key.
3. Install with Node 22 and the supplied lockfiles; repeat all tests.
4. Reconcile every branch's finished stock, empty containers and unturned oil kegs.
5. Deploy Functions + rules + front end together; force old clients to reload.
6. Test each role, each branch, each write path and a simultaneous last-unit sale.
7. Enable notifications on each admin device and test real background receipt.
8. Check physical phones/tablets/laptops and the selected speech voice.
9. Only then reopen production transactions and monitor errors.
