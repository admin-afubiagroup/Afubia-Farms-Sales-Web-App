# Sale and oil-turning save fix

The browser previously attempted to call `recordBusiness`, but no Cloud Function was deployed and the project is not being upgraded to Blaze. The active app save path now writes directly to Firestore for sales and conversions, after client-side shop-stock validation. Shop opening stock and purchased-material records also use the authenticated direct-write path, restricted to administrators by Firestore rules.

Deploy the updated rules first:

```powershell
npx firebase-tools deploy --only firestore:rules --project af-sales-app-16814
```

See `DIRECT_FIRESTORE_SAVING.md` for setup and testing notes, including the limitation that client-side inventory validation is not an atomic trusted transaction.
