// scripts/migrate-admin-claims.js
// Migration tool to audit and migrate administrator privileges from Firestore
// `appUsers` (role === 'admin' or isSuperAdmin === true) to Firebase Auth Custom Claims ({ admin: true }).
//
// Usage:
//   node scripts/migrate-admin-claims.js [--dry-run]
//   node scripts/migrate-admin-claims.js --execute
//
// Prereqs:
//   - serviceAccountKey.json in repository root
//   - firebase-admin installed
//
// Note: Per AGENTS.md rules, this script is provided for administrator authority
// migration planning and MUST NOT be executed against production during automated remediation.

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const execute = args.includes("--execute");

const SERVICE_ACCOUNT = path.resolve(process.cwd(), "serviceAccountKey.json");
if (!fs.existsSync(SERVICE_ACCOUNT)) {
  console.error(
    `[ERROR] Missing service account key at ${SERVICE_ACCOUNT}.`,
  );
  console.error(
    "Please download your serviceAccountKey.json from Firebase Console -> Project Settings -> Service Accounts.",
  );
  process.exit(1);
}

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const serviceAccount = require(SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });

const db = getFirestore();
const auth = getAuth();

async function runMigrationAudit() {
  console.log("===============================================================================");
  console.log("         KAvach Play — Administrator Authority Migration Audit Tool           ");
  console.log("===============================================================================");
  console.log(`Execution Mode: ${execute ? "LIVE EXECUTION (--execute)" : "DRY RUN (Read-Only Audit)"}`);
  console.log("-------------------------------------------------------------------------------");

  const appUsersSnap = await db.collection("appUsers").get();
  const candidateAdmins = [];

  for (const doc of appUsersSnap.docs) {
    const data = doc.data();
    if (data.role === "admin" || data.isSuperAdmin === true) {
      candidateAdmins.push({
        uid: doc.id,
        email: data.email || null,
        name: data.displayName || data.name || "N/A",
        role: data.role || "N/A",
        isSuperAdmin: Boolean(data.isSuperAdmin),
      });
    }
  }

  console.log(`Found ${candidateAdmins.length} administrator candidate(s) in Firestore appUsers.\n`);

  const results = [];
  let pendingMigrationCount = 0;

  for (const candidate of candidateAdmins) {
    let authUser = null;
    let authError = null;

    try {
      authUser = await auth.getUser(candidate.uid);
    } catch (err) {
      if (candidate.email) {
        try {
          authUser = await auth.getUserByEmail(candidate.email);
        } catch (e2) {
          authError = err.message;
        }
      } else {
        authError = err.message;
      }
    }

    if (!authUser) {
      results.push({
        ...candidate,
        authStatus: `AUTH_NOT_FOUND (${authError})`,
        hasAdminClaim: false,
        action: "SKIP (No matching Firebase Auth user)",
      });
      continue;
    }

    const currentClaims = authUser.customClaims || {};
    const hasAdminClaim = currentClaims.admin === true;

    if (hasAdminClaim) {
      results.push({
        ...candidate,
        authEmail: authUser.email,
        authStatus: "VERIFIED",
        hasAdminClaim: true,
        action: "NONE (Already has admin claim)",
      });
    } else {
      pendingMigrationCount++;
      if (execute) {
        const nextClaims = { ...currentClaims, admin: true };
        await auth.setCustomUserClaims(authUser.uid, nextClaims);
        results.push({
          ...candidate,
          authEmail: authUser.email,
          authStatus: "VERIFIED",
          hasAdminClaim: false,
          action: "MIGRATED (Claim set: { admin: true })",
        });
      } else {
        results.push({
          ...candidate,
          authEmail: authUser.email,
          authStatus: "VERIFIED",
          hasAdminClaim: false,
          action: "NEEDS_MIGRATION (Claim required: { admin: true })",
        });
      }
    }
  }

  // Print Table
  console.log(
    "| UID                      | Email                     | Role  | SuperAdmin | Has Claim? | Action Taken / Needed"
  );
  console.log(
    "|--------------------------|---------------------------|-------|------------|------------|-----------------------"
  );
  for (const r of results) {
    const uidPad = (r.uid || "").padEnd(24).slice(0, 24);
    const emailPad = (r.authEmail || r.email || "N/A").padEnd(25).slice(0, 25);
    const rolePad = (r.role || "").padEnd(5).slice(0, 5);
    const superPad = String(r.isSuperAdmin).padEnd(10).slice(0, 10);
    const claimPad = String(r.hasAdminClaim).padEnd(10).slice(0, 10);
    console.log(`| ${uidPad} | ${emailPad} | ${rolePad} | ${superPad} | ${claimPad} | ${r.action}`);
  }

  console.log("-------------------------------------------------------------------------------");
  console.log(`Total candidates: ${candidateAdmins.length}`);
  console.log(`Accounts requiring migration: ${pendingMigrationCount}`);

  if (!execute && pendingMigrationCount > 0) {
    console.log("\n[ACTION REQUIRED BEFORE DISABLING FALLBACK IN FIRESTORE RULES]");
    console.log("Once reviewed by product owner, execute migration with:");
    console.log("  node scripts/migrate-admin-claims.js --execute");
    console.log("\nAfter migration, affected admins must sign out and sign in to refresh ID tokens.");
    console.log("Once all admins have verified the claim, the appUsers.role fallback can safely be dropped.");
  } else if (execute) {
    console.log("\n[SUCCESS] Custom claims have been updated. Instruct users to re-authenticate.");
  } else {
    console.log("\n[OK] All administrator accounts already have Firebase Auth custom claim { admin: true }.");
  }
}

runMigrationAudit().catch((err) => {
  console.error("[FATAL ERROR]", err);
  process.exit(1);
});
