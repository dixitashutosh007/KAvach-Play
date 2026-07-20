// export-firestore.js
// Exports all root collections AND recursively walks subcollections.
// Subcollections are nested under `_subcollections: { name: [...docs] }` on
// each parent doc, so cross-references stay obvious.

const fs = require("fs");

const MAX_DEPTH = 6;

async function exportData() {
  console.log("=== Firestore to JSON Exporter (with subcollections) ===\n");

  const serviceAccountPath = "./serviceAccountKey.json";
  if (!fs.existsSync(serviceAccountPath)) {
    console.error("Error: serviceAccountKey.json not found!");
    console.error("\nTo run this script:");
    console.error("1. Go to Firebase Console -> Project Settings -> Service Accounts.");
    console.error("2. Click 'Generate new private key'.");
    console.error("3. Save the downloaded file as 'serviceAccountKey.json' in this folder.");
    console.error("4. Run `npm install firebase-admin` if you haven't already.");
    console.error("5. Run `node export-firestore.js`\n");
    process.exit(1);
  }

  const { initializeApp, cert } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const serviceAccount = require(serviceAccountPath);

  console.log("Initializing Firebase Admin...");
  const app = initializeApp({ credential: cert(serviceAccount) });

  const dbId = "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412";
  let db;
  try {
    db = getFirestore(app, dbId);
  } catch (e) {
    console.warn("Could not connect with named DB, trying default...");
    db = getFirestore(app);
  }

  const stats = { collections: 0, docs: 0, subcollections: 0 };

  async function exportDoc(docRef, depth) {
    const snap = await docRef.get();
    const data = snap.exists ? { _id: snap.id, ...snap.data() } : { _id: docRef.id };

    if (depth >= MAX_DEPTH) return data;

    const subs = await docRef.listCollections().catch(() => []);
    if (subs.length === 0) return data;

    data._subcollections = {};
    for (const sub of subs) {
      stats.subcollections += 1;
      const subDocs = await exportCollection(sub, depth + 1);
      data._subcollections[sub.id] = subDocs;
    }
    return data;
  }

  async function exportCollection(colRef, depth) {
    const snap = await colRef.get();
    const out = [];
    for (const d of snap.docs) {
      stats.docs += 1;
      const exported = await exportDoc(d.ref, depth);
      out.push(exported);
    }
    return out;
  }

  const backupData = {};
  console.log(`Connecting to Firestore database: ${dbId}...\n`);

  try {
    const roots = await db.listCollections();
    if (roots.length === 0) {
      console.log("No collections found in this database.");
    }

    for (const collection of roots) {
      stats.collections += 1;
      console.log(`Fetching collection: ${collection.id} ...`);
      const before = stats.docs;
      backupData[collection.id] = await exportCollection(collection, 1);
      console.log(
        `  ${collection.id}: ${stats.docs - before} docs (cumulative subcollections walked so far: ${stats.subcollections})`,
      );
    }

    const exportPath = "./firestore-backup.json";
    fs.writeFileSync(exportPath, JSON.stringify(backupData, null, 2));

    const sizeMB = (fs.statSync(exportPath).size / (1024 * 1024)).toFixed(2);
    console.log("\n=== Done ===");
    console.log(`  Root collections: ${stats.collections}`);
    console.log(`  Total documents (including subcollection docs): ${stats.docs}`);
    console.log(`  Subcollections walked: ${stats.subcollections}`);
    console.log(`  File: ${exportPath} (${sizeMB} MB)`);
    console.log(
      "\nThis file now contains subcollections nested under each parent doc's _subcollections field.",
    );
  } catch (err) {
    console.error("\nError during export:", err);
  }
}

exportData();
