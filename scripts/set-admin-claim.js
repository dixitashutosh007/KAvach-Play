// scripts/set-admin-claim.js
// Grant or revoke the `admin: true` Firebase Auth custom claim on a user.
// Custom claims travel in the auth token and can be checked from any client
// (via getIdTokenResult) or from Firestore security rules (via
// request.auth.token.admin).
//
// Usage:
//   node scripts/set-admin-claim.js <email> [--revoke]
//
// Examples:
//   node scripts/set-admin-claim.js dixitashutosh007@gmail.com
//   node scripts/set-admin-claim.js dixitashutosh007@gmail.com --revoke
//
// Prereqs:
//   - serviceAccountKey.json in repo root
//   - `npm install firebase-admin` (already a dep)
//
// After running, the user must SIGN OUT and SIGN BACK IN once so their new
// token carries the claim. (Or call auth.currentUser.getIdToken(true) to
// force-refresh.)

const fs = require("fs");

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
const revoke = args.includes("--revoke");

if (!email) {
  console.error(
    "Usage: node scripts/set-admin-claim.js <email> [--revoke]",
  );
  process.exit(1);
}

const SERVICE_ACCOUNT = "./serviceAccountKey.json";
if (!fs.existsSync(SERVICE_ACCOUNT)) {
  console.error(
    `Missing ${SERVICE_ACCOUNT}. Download from Firebase Console -> Project Settings -> Service Accounts.`,
  );
  process.exit(1);
}

const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const serviceAccount = require(SERVICE_ACCOUNT);

initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth();

async function main() {
  console.log(`Looking up user by email: ${email}`);
  const user = await auth.getUserByEmail(email);
  console.log(`  uid: ${user.uid}`);
  const currentClaims = user.customClaims || {};
  const nextClaims = { ...currentClaims };
  if (revoke) {
    delete nextClaims.admin;
    console.log("Revoking admin claim...");
  } else {
    nextClaims.admin = true;
    console.log("Granting admin claim...");
  }
  await auth.setCustomUserClaims(user.uid, nextClaims);
  console.log(`Done. Current claims: ${JSON.stringify(nextClaims)}`);
  console.log(
    "\nThe user MUST sign out and sign back in for the change to take effect.",
  );
}

main().catch((e) => {
  console.error("Failed:", e.message || e);
  process.exit(1);
});
