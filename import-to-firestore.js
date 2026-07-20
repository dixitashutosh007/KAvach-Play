// import-to-firestore.js
// Reads firestore-backup.json (produced by export-firestore.js) and writes
// every document into a target Firestore database in the SAME Firebase project.
//
// Use case: create a sandbox database and populate it with a snapshot of prod.
//
// Usage:
//   node import-to-firestore.js <target-database-id> [--skip-notifications] [--dry-run]
//
// Examples:
//   node import-to-firestore.js sandbox
//   node import-to-firestore.js sandbox --skip-notifications
//   node import-to-firestore.js sandbox --dry-run
//
// Prereqs:
//   - serviceAccountKey.json in this folder
//   - The target database must ALREADY EXIST. Create it in Firebase Console
//     (Firestore -> "Add database") or via:
//       gcloud firestore databases create --database=<id> --location=asia-south1

const fs = require("fs");

const args = process.argv.slice(2);
const targetDbId = args.find((a) => !a.startsWith("--"));
const skipNotifications = args.includes("--skip-notifications");
const dryRun = args.includes("--dry-run");

if (!targetDbId) {
  console.error("Usage: node import-to-firestore.js <target-database-id> [--skip-notifications] [--dry-run]");
  process.exit(1);
}
if (targetDbId === "(default)" || targetDbId === "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412") {
  console.error("Refusing to import into the production database. Pick a different target id.");
  process.exit(1);
}

const BACKUP = "./firestore-backup.json";
if (!fs.existsSync(BACKUP)) {
  console.error(`Missing ${BACKUP}. Run \`node export-firestore.js\` first.`);
  process.exit(1);
}

const SERVICE_ACCOUNT = "./serviceAccountKey.json";
if (!fs.existsSync(SERVICE_ACCOUNT)) {
  console.error(`Missing ${SERVICE_ACCOUNT}.`);
  process.exit(1);
}

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");

const serviceAccount = require(SERVICE_ACCOUNT);
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app, targetDbId);

// Firestore Admin has a per-batch cap of 500 operations
const BATCH_SIZE = 400;

function reviveTimestamps(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(reviveTimestamps);
  if (typeof value === "object") {
    // Firestore Admin serializes Timestamps as { _seconds, _nanoseconds }
    if (typeof value._seconds === "number" && typeof value._nanoseconds === "number") {
      return new Timestamp(value._seconds, value._nanoseconds);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = reviveTimestamps(v);
    }
    return out;
  }
  return value;
}

function extractDoc(doc) {
  const { _id, _subcollections, ...rest } = doc;
  return { id: _id, data: reviveTimestamps(rest), subs: _subcollections || null };
}

async function commitBatched(ops) {
  if (ops.length === 0) return;
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    if (dryRun) continue;
    const batch = db.batch();
    for (const { ref, data } of ops.slice(i, i + BATCH_SIZE)) {
      batch.set(ref, data);
    }
    await batch.commit();
  }
}

const stats = { collections: 0, docsWritten: 0, subCollectionsWritten: 0 };

async function importCollection(parentPath, collectionName, docs) {
  if (!Array.isArray(docs) || docs.length === 0) return;

  if (skipNotifications && collectionName === "notifications" && parentPath === "") {
    console.log(`  skipped ${collectionName} (--skip-notifications)`);
    return;
  }

  stats.collections += 1;
  const colPath = parentPath ? `${parentPath}/${collectionName}` : collectionName;

  const ops = [];
  const nestedWork = [];

  for (const doc of docs) {
    const { id, data, subs } = extractDoc(doc);
    const ref = db.collection(colPath).doc(id);
    ops.push({ ref, data });
    stats.docsWritten += 1;

    if (subs) {
      for (const [subName, subDocs] of Object.entries(subs)) {
        stats.subCollectionsWritten += 1;
        nestedWork.push({ parent: `${colPath}/${id}`, name: subName, docs: subDocs });
      }
    }
  }

  console.log(`  ${colPath}: ${ops.length} docs${dryRun ? " (dry-run)" : ""}`);
  await commitBatched(ops);

  for (const w of nestedWork) {
    await importCollection(w.parent, w.name, w.docs);
  }
}

async function main() {
  console.log(`=== Firestore Importer ===`);
  console.log(`  Target database: ${targetDbId}`);
  console.log(`  Source file:     ${BACKUP}`);
  console.log(`  Dry run:         ${dryRun}`);
  console.log(`  Skip notifs:     ${skipNotifications}`);
  console.log("");

  const raw = JSON.parse(fs.readFileSync(BACKUP, "utf8"));

  for (const [rootName, docs] of Object.entries(raw)) {
    await importCollection("", rootName, docs);
  }

  console.log("");
  console.log("=== Done ===");
  console.log(`  Collections (incl. subcollections) written: ${stats.collections}`);
  console.log(`  Documents written: ${stats.docsWritten}`);
  console.log(`  Subcollections walked: ${stats.subCollectionsWritten}`);
  if (dryRun) console.log(`  (Dry run — nothing was actually written.)`);
}

main().catch((e) => {
  console.error("\nImport failed:", e);
  process.exit(1);
});
