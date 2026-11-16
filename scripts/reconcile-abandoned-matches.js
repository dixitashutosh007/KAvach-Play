#!/usr/bin/env node
/**
 * scripts/reconcile-abandoned-matches.js
 *
 * CLI utility to reconcile abandoned match obligations according to
 * approved Option A policy (AGENTS.md):
 *   - Waives unpaid match fees on matches marked "Abandoned"
 *   - Sets status: "Waived", waivedReason: "Match Abandoned"
 *   - Preserves paid payments (never modifies, never deletes)
 *   - Idempotent and safe to run repeatedly
 *
 * Usage:
 *   node scripts/reconcile-abandoned-matches.js [--dry-run] [--match-id=<id>]
 */

const { initializeApp } = require("firebase/app");
const { getAuth, signInWithEmailAndPassword } = require("firebase/auth");
const {
  initializeFirestore,
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  serverTimestamp,
} = require("firebase/firestore");
const fs = require("fs");
const path = require("path");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...vals] = trimmed.split("=");
    env[key.trim()] = vals.join("=").trim();
  }
  return env;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const matchIdArg = args.find((a) => a.startsWith("--match-id="))?.split("=")[1];

  console.log(`=== KAvach Play Abandoned Match Reconciler ===`);
  console.log(`Mode: ${isDryRun ? "DRY RUN (no writes)" : "LIVE EXECUTION"}`);
  if (matchIdArg) console.log(`Target Match: ${matchIdArg}`);

  const projectRoot = path.resolve(__dirname, "..");
  const envLocal = loadEnv(path.join(projectRoot, ".env.local"));
  const envRoot = loadEnv(path.join(projectRoot, ".env"));
  const env = { ...envRoot, ...envLocal, ...process.env };

  const configPath = path.join(projectRoot, "firebase-applet-config.json");
  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const dbId = firebaseConfig.firestoreDatabaseId || "(default)";
  const db = initializeFirestore(app, {}, dbId);

  const adminEmail = env.ADMIN_EMAIL;
  const adminPassword = env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.error("Error: ADMIN_EMAIL and ADMIN_PASSWORD must be configured in .env.local");
    process.exit(1);
  }

  await signInWithEmailAndPassword(auth, adminEmail, adminPassword);
  console.log(`Authenticated as admin: ${adminEmail}`);

  let abandonedMatches = [];
  if (matchIdArg) {
    const matchesSnap = await getDocs(collection(db, "matches"));
    const matchDoc = matchesSnap.docs.find((d) => d.id === matchIdArg);
    if (!matchDoc) {
      console.error(`Match ${matchIdArg} not found`);
      process.exit(1);
    }
    const data = matchDoc.data();
    if (data.result !== "Abandoned") {
      console.error(`Match ${matchIdArg} is not marked as Abandoned (result: ${data.result})`);
      process.exit(1);
    }
    abandonedMatches.push({ id: matchDoc.id, ...data });
  } else {
    const q = query(collection(db, "matches"), where("result", "==", "Abandoned"));
    const snap = await getDocs(q);
    snap.forEach((d) => abandonedMatches.push({ id: d.id, ...d.data() }));
  }

  console.log(`Found ${abandonedMatches.length} abandoned match(es).`);

  let totalWaived = 0;
  let totalPaidPreserved = 0;
  let totalAlreadyWaived = 0;

  for (const match of abandonedMatches) {
    console.log(`\nInspecting match ${match.id} vs ${match.opponent || "Unknown"} (${match.date}):`);
    const paySnap = await getDocs(collection(db, `matches/${match.id}/payments`));

    let batch = writeBatch(db);
    let batchCount = 0;

    paySnap.forEach((pDoc) => {
      const pay = pDoc.data();
      const amount = pay.feeOverride !== undefined ? pay.feeOverride : (match.fee || 0);

      if (pay.status === "Unpaid") {
        console.log(`  [WAIVE] Payment ${pDoc.id} (Player: ${pay.playerId}, Amount: ₹${amount})`);
        totalWaived++;
        if (!isDryRun) {
          batch.update(doc(db, `matches/${match.id}/payments/${pDoc.id}`), {
            status: "Waived",
            waivedReason: "Match Abandoned",
            waivedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          batchCount++;
        }
      } else if (pay.status === "Paid") {
        console.log(`  [PRESERVED] Paid Payment ${pDoc.id} (Player: ${pay.playerId}, Amount: ₹${pay.feeCollectedAmount ?? amount})`);
        totalPaidPreserved++;
      } else if (pay.status === "Waived") {
        totalAlreadyWaived++;
      }
    });

    if (!isDryRun && batchCount > 0) {
      await batch.commit();
      console.log(`  Committed ${batchCount} update(s) to match ${match.id}.`);
    }
  }

  console.log(`\n=== Reconciliation Summary ===`);
  console.log(`Total Abandoned Matches: ${abandonedMatches.length}`);
  console.log(`Obligations Waived:      ${totalWaived}`);
  console.log(`Paid Payments Preserved: ${totalPaidPreserved}`);
  console.log(`Already Waived:          ${totalAlreadyWaived}`);
  console.log(`Mode:                    ${isDryRun ? "DRY RUN (No changes made)" : "COMPLETED"}`);
}

main().catch((err) => {
  console.error("Reconciliation failed:", err);
  process.exit(1);
});
