# Afubia Farms: Admin Web Push Setup

This project uses Firebase Cloud Messaging (FCM), a root-scope service worker, and Cloud Functions. Admin push tokens are stored in `adminPushTokens`; Firestore rules permit only active administrators to register/read/delete their own tokens. The sender rechecks each token owner's role before sending.

## Events that notify admin devices

- New sales and oil-turning activity.
- Staff attendance sign-in/sign-out (existing feature).
- New staff messages, including product finished, low stock, missing kegs and missing containers.
- A stock balance crossing its warning level: Palm Oil or Kuli-Kuli Oil at 10 L or below, Honey at 10 bottles or below, packaging at 30 units or below, or kegs at 2 or below. A low-stock event is created only when the balance crosses from above the threshold to at/below it, avoiding a push for every subsequent sale while it remains low.

## Firebase Console setup

1. Open Firebase Console for the same project ID configured in `.env`.
2. Open Project settings → Cloud Messaging.
3. Under Web configuration / Web Push certificates, generate or copy the VAPID key pair's public key.
4. Put the public key in `VITE_FIREBASE_VAPID_KEY` in the local `.env` file. Do not commit `.env` or share the private key. The web push public key is not a service-account secret, but it must match the Firebase project.
5. Ensure Cloud Messaging API and Cloud Functions are enabled for the Firebase project and billing/plan requirements are satisfied for the project's Functions deployment.
6. Deploy the rules and functions, then host the site on HTTPS. Firebase Hosting provides HTTPS automatically.

## Deploy

From the app root in PowerShell:

```powershell
npm install
cd functions
npm install
cd ..
npm test
npm run lint
npm run build
firebase deploy --only firestore:rules,functions,hosting --project af-sales-app-16814
```

Deploying Hosting is included in the last command. If you only want to release backend push behavior and security rules first, run:

```powershell
firebase deploy --only firestore:rules,functions --project af-sales-app-16814
```

## Enable each device

1. Sign in to the admin account on the Android phone in Chrome and open the hosted HTTPS URL.
2. Open Admin → Live Branch Activity and click **Enable browser alerts**. Accept the browser notification prompt.
3. Repeat on the computer in the browser you use there. Each browser/device has its own FCM token and must be enabled separately.
4. In Android settings, allow Chrome/site notifications and make sure Do Not Disturb / battery restrictions are not suppressing alerts. On desktop, allow site notifications in browser and operating-system settings.
5. Test by having a salesperson submit a staff message and by creating a test sale that crosses a low-stock threshold. Verify the notification appears while the dashboard is open and while the browser is in the background/closed.

## Sound and vibration limits

The service worker requests a vibration pattern and a non-silent system notification. Android Chrome may vibrate when the device/browser/site and notification channel allow it. Desktop browsers often ignore vibration. The website cannot force sound or bypass silent mode, Do Not Disturb, notification permissions, battery restrictions or OS policies; use device notification settings to choose the sound and vibration behaviour. Push delivery can also be delayed by network/device power management.

## Security notes

- Do not add FCM server credentials or service-account private keys to Vite environment variables or browser code.
- Only active admin-role profiles can register device tokens; the Cloud Function checks the profile role again before sending.
- Salespeople can create reports only for their own assigned branch. They cannot read staff messages or admin notifications.
- A user's token is stored separately per browser/device. Enable notifications on both phone and computer.
