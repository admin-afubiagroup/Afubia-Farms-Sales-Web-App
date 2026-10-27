# Staff Login / Attendance Fix

This update keeps the existing Afubia Farms UI and styling unchanged.

## Files updated
- `src/components/Login.jsx`
  - Validates `branchName` along with the existing staff ID, branch, role, and active status before recording attendance.
  - Uses the validated Firestore profile's staff ID, branch ID, and branch name in the attendance payload.
  - Keeps location optional when browser geolocation times out or is unavailable.
  - Keeps `serverTimestamp()` for the attendance timestamp.
  - Gives a more actionable message for Firestore permission errors.
- `firestore.rules`
  - Restricts attendance creation to an authenticated, active salesperson with an assigned branch.
  - Requires the attendance record's user, staff ID, branch ID, and branch name to match that user's protected profile.
  - Requires `timestamp == request.time`, which is intended to work with the client's `serverTimestamp()`.
  - Restricts allowed fields and validates optional location values.
  - Keeps attendance reads administrator-only and staff update/delete blocked.
- `tests/firestore.rules.test.mjs`
  - Seeds test profiles with staff and branch details.
  - Tests valid attendance and rejects branch/staff identity forgery.

## Important deployment step
The local `firestore.rules` file does not automatically change the rules in Firebase Console. Open Firebase Console → project `af-sales-app-16814` → Firestore Database → Rules, replace the published rules with the complete contents of this project's `firestore.rules`, and click **Publish**. Do not add a duplicate `match /staffAttendance/{attendanceId}` block.

Then deploy the updated web app so the corrected `Login.jsx` is in use. Confirm that the Kara and Ogidan `users/{uid}` documents each contain matching `active: true`, `role`, `staffId`, `branchId`, and `branchName` values.

## Verification limitation
The Firestore rules test file was updated and its JavaScript syntax checked. A full Vite build / emulator rules test could not be completed in this environment because dependency installation timed out and the Vite executable was unavailable.
