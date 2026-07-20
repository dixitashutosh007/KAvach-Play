// scripts/purge-appconfig-secrets.js
// One-time cleanup: remove any legacy secret fields from the appConfig doc.
// These fields used to be written to Firestore, which is publicly readable.
// They now live in Amplify env vars. This script deletes the fields from the
// existing document so they no longer leak.
//
// Usage:
//   node scripts/purge-appconfig-secrets.js <target-database-id> [--dry-run]
//
// Examples:
//   node scripts/purge-appconfig-secrets.js ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412 --dry-run
//   node scripts/purge-appconfig-secrets.js ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412
//   node scripts/purge-appconfig-secrets.js kavach-play-db-ext
//
// Prereqs: serviceAccountKey.json in repo root.

const fs = require("fs");

const args = process.argv.slice(2);
const targetDbId = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");

if (!targetDbId) {
  console.error(
    "Usage: node scripts/purge-appconfig-secrets.js <target-database-id> [--dry-run]",
  );
  process.exit(1);
}

const SERVICE_ACCOUNT = "./serviceAccountKey.json";
if (!fs.existsSync(SERVICE_ACCOUNT)) {
  console.error(`Missing ${SERVICE_ACCOUNT}.`);
  process.exit(1);
}

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const serviceAccount = require(SERVICE_ACCOUNT);

const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app, targetDbId);

const SECRET_FIELDS = [
  "razorpayKeySecret",
  "smtpPassword",
  "resendApiKey",
  "whatsappAccessToken",
];

async function main() {
  console.log(`Target database: ${targetDbId}`);
  console.log(`Dry run: ${dryRun}\n`);

  const ref = db.collection("appConfig").doc("default");
  const snap = await ref.get();
  if (!snap.exists) {
    console.log("No appConfig/default doc exists. Nothing to purge.");
    return;
  }

  const data = snap.data() || {};
  const present = SECRET_FIELDS.filter((f) => data[f] !== undefined);

  if (present.length === 0) {
    console.log("No secret fields present. Nothing to purge.");
    return;
  }

  console.log("Secret fields to remove:");
  for (const f of present) {
    const val = data[f];
    const masked =
      typeof val === "string" && val.length > 4
        ? val.slice(0, 2) + "***" + val.slice(-2)
        : "(present)";
    console.log(`  ${f} = ${masked}`);
  }

  if (dryRun) {
    console.log("\nDry run — nothing was changed.");
    return;
  }

  const updates = {};
  for (const f of present) updates[f] = FieldValue.delete();
  await ref.update(updates);
  console.log("\nDone. Fields removed.");
}

main().catch((e) => {
  console.error("Purge failed:", e.message || e);
  process.exit(1);
});
