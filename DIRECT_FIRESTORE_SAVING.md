# Direct Firestore saving (no Cloud Functions deployment)

This version removes the deployed `recordBusiness` callable from the active browser save path. Sales, oil-turning/conversion records, admin-entered shop opening stock, and admin-entered purchased materials are written directly to Firestore. This avoids deploying Cloud Functions and therefore avoids the Cloud Functions Blaze-plan deployment requirement.

## Firestore rules

Deploy the updated rules before testing the app:

```powershell
npx firebase-tools deploy --only firestore:rules --project af-sales-app-16814
```

The rules enforce authentication, active profile, role, branch ownership, branch names, identity fields, server timestamps, and the 08:00–18:00 Nigeria-time window for salesperson sales/conversion writes. Only administrators may create shop opening stock or material purchase records.

## Stock validation

Before saving a sale or conversion, the app reads records for the selected shop and runs the shared inventory balance/availability checks. This prevents ordinary invalid submissions in the UI. **Because the validation is client-side and the final write is not an atomic server transaction, a determined client can bypass it and simultaneous sales can race.** Firestore rules still enforce branch and role boundaries, but they cannot safely guarantee stock balances by themselves. Do not treat this as equivalent to the trusted Cloud Function transaction.

## Testing steps

1. Deploy only the Firestore rules using the command above.
2. Run the app locally with its existing Firebase environment variables.
3. As admin, ensure each shop has its opening stock and purchased materials recorded.
4. As a salesperson, test one small sale and one oil-turning record in the assigned shop.
5. Confirm both records appear under the same branch and update the shop stock screens as expected. Avoid repeated submissions while testing to prevent duplicates.

The app no longer needs `recordBusiness` for these writes. Each successful sale or oil-turning save writes its activity notification in the same Firestore batch as the business record. The admin dashboard listens to `branchNotifications` in real time and displays a dismissible popup for new activity while the dashboard is open. Enable browser alerts in the dashboard if you also want operating-system notifications; browser permission and platform settings apply. This direct-write option does not provide guaranteed push delivery while the admin dashboard/browser is closed.

## Login sessions across tabs

Firebase Auth uses `browserSessionPersistence`. Each tab has its own browser session, so a salesperson signing in from another tab should not replace the authenticated user in the original tab. The session survives refreshes and remains active until sign-out or the tab's browser session ends.

## Stock tracker and conversion validation

The inventory balance now counts admin-entered opening kegs and opening empty containers as usable conversion materials, as well as purchased materials. The Stock Tracker listens to opening stock, purchases, sales, and conversions so its balances update as Firestore changes. Oil turning still checks for actual kegs and the selected empty containers and keeps the 27-usable-litres-per-keg limit.

The `functions/` directory is retained for reference/future server-side hardening; do not deploy functions as part of this no-Blaze option.
