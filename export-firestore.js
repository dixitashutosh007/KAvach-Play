// export-firestore.js
// Exports all root collections AND walks subcollections efficiently.
//
// Strategy: for each collection, sample the first N docs to see if any have
// subcollections. If none do, treat the whole collection as flat and skip
// the expensive per-doc listCollections() call for the rest. This keeps big
// leaf collections like `notifications` (8k+ docs) fast.
//
// Subcollections that are found are nested under `_subcollections` on the
// parent doc so cross-references stay obvious.

const fs = require("fs");

const MAX_DEPTH = 6;
const SAMPLE_SIZE = 10;        // check this many docs before deciding to skip
const PARALLEL_LIST = 20;      // parallel listCollections() calls
const PROGRESS_EVERY = 50;     // log every N docs

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

  const stats = { collections: 0, docs: 0, subcollections: 0, listCalls: 0 };

  async function listSubs(docRef) {
    stats.listCalls += 1;
    try {
      return await docRef.listCollections();
    } catch (e) {
      return [];
    }
  }

  async function parallelMap(items, worker, batchSize) {
    const results = new Array(items.length);
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const done = await Promise.all(batch.map((it, j) => worker(it, i + j)));
      for (let k = 0; k < done.length; k += 1) results[i + k] = done[k];
    }
    return results;
  }

  async function walkSubcollections(doc, depth) {
    const subs = await listSubs(doc.ref);
    if (subs.length === 0) return null;
    const out = {};
    for (const sub of subs) {
      stats.subcollections += 1;
      out[sub.id] = await exportCollection(sub, depth + 1);
    }
    return out;
  }

  async function exportCollection(colRef, depth) {
    const snap = await colRef.get();
    const docs = snap.docs;

    if (docs.length === 0) return [];
    if (depth >= MAX_DEPTH) {
      return docs.map((d) => ({ _id: d.id, ...d.data() }));
    }

    // Sample first N docs in parallel to see if this collection has any subcollections
    const sampleCount = Math.min(SAMPLE_SIZE, docs.length);
    const sampleSubs = await parallelMap(
      docs.slice(0, sampleCount),
      (d) => listSubs(d.ref),
      PARALLEL_LIST,
    );
    const hasAnySubs = sampleSubs.some((subs) => subs.length > 0);

    if (!hasAnySubs) {
      // Flat leaf collection — return docs as-is, skip per-doc listCollections
      return docs.map((d, i) => {
        stats.docs += 1;
        if (stats.docs % PROGRESS_EVERY === 0) {
          process.stdout.write(`    ...${stats.docs} docs processed\n`);
        }
        return { _id: d.id, ...d.data() };
      });
    }

    // At least one sampled doc has subcollections; walk them all
    const out = [];
    for (let i = 0; i < docs.length; i += 1) {
      const d = docs[i];
      const data = { _id: d.id, ...d.data() };

      // Reuse sampled result if we already computed it
      let subs = i < sampleCount ? sampleSubs[i] : await listSubs(d.ref);
      if (subs.length > 0) {
        data._subcollections = {};
        for (const sub of subs) {
          stats.subcollections += 1;
          data._subcollections[sub.id] = await exportCollection(sub, depth + 1);
        }
      }
      out.push(data);
      stats.docs += 1;
      if (stats.docs % PROGRESS_EVERY === 0) {
        process.stdout.write(`    ...${stats.docs} docs processed\n`);
      }
    }
    return out;
  }

  const backupData = {};
  console.log(`Connecting to Firestore database: ${dbId}...\n`);

  try {
    const roots = await db.listCollections();
    if (roots.length === 0) console.log("No collections found in this database.");

    for (const collection of roots) {
      stats.collections += 1;
      const t0 = Date.now();
      const beforeDocs = stats.docs;
      console.log(`Fetching collection: ${collection.id} ...`);
      backupData[collection.id] = await exportCollection(collection, 1);
      const took = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `  ${collection.id}: ${stats.docs - beforeDocs} docs in ${took}s ` +
          `(subcollections so far: ${stats.subcollections})`,
      );
    }

    const exportPath = "./firestore-backup.json";
    fs.writeFileSync(exportPath, JSON.stringify(backupData, null, 2));

    const sizeMB = (fs.statSync(exportPath).size / (1024 * 1024)).toFixed(2);
    console.log("\n=== Done ===");
    console.log(`  Root collections: ${stats.collections}`);
    console.log(`  Total documents: ${stats.docs}`);
    console.log(`  Subcollections walked: ${stats.subcollections}`);
    console.log(`  listCollections() calls made: ${stats.listCalls}`);
    console.log(`  File: ${exportPath} (${sizeMB} MB)`);
  } catch (err) {
    console.error("\nError during export:", err);
    process.exit(1);
  }
}

exportData();
