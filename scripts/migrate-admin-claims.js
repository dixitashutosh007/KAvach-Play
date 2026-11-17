// scripts/migrate-admin-claims.js
// Migration tool to audit and migrate administrator privileges from Firestore
// `appUsers` (role === 'admin' or isSuperAdmin === true) to Firebase Auth Custom Claims ({ admin: true }).
//
// Target Architecture (SEC-001):
//   - Custom claims ({ admin: true }) are the SOLE authority for super-admin privileges.
//   - Firestore `appUsers.role == 'admin'` is NOT an authority.
//   - To prevent privilege escalation, migration NEVER auto-promotes records based on role == 'admin'.
//   - An explicit, owner-approved UID allowlist is strictly required to grant claims.
//
// Usage:
//   node scripts/migrate-admin-claims.js [--report]
//   node scripts/migrate-admin-claims.js --allowlist=uid1,uid2 [--execute]
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

// Parse allowlist if provided
let approvedUids = [];
const allowlistArg = args.find((a) => a.startsWith("--allowlist="));
if (allowlistArg) {
  approvedUids = allowlistArg
    .replace("--allowlist=", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Check for allowlist file if present
const ALLOWLIST_FILE = path.resolve(process.cwd(), "config/admin-allowlist.json");
if (fs.existsSync(ALLOWLIST_FILE)) {
  try {
    const fileUids = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, "utf8"));
    if (Array.isArray(fileUids)) {
      approvedUids = Array.from(new Set([...approvedUids, ...fileUids]));
    }
  } catch (e) {
    console.warn("[WARN] Could not parse config/admin-allowlist.json:", e.message);
  }
}

const SERVICE_ACCOUNT = path.resolve(process.cwd(), "serviceAccountKey.json");
if (!fs.existsSync(SERVICE_ACCOUNT)) {
  console.log("===============================================================================");
  console.log("         KAvach Play — Administrator Authority Candidate Report Generator      ");
  console.log("===============================================================================");
  console.log(`[INFO] serviceAccountKey.json not present on local machine.`);
  console.log("Migration Architecture Specifications (SEC-001):");
  console.log("  1. Custom claims ({ admin: true }) are the SOLE authority source.");
  console.log("  2. Arbitrary role == 'admin' records in appUsers are strictly ignored.");
  console.log("  3. Promotion requires explicit entry in approved allowlist.");
  console.log("  4. Execution is forbidden during automated remediation.");
  process.exit(0);
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
  console.log(`Execution Mode: ${execute ? "LIVE EXECUTION (--execute)" : "READ-ONLY CANDIDATE REPORT"}`);
  console.log(`Approved Allowlist Count: ${approvedUids.length}`);
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
  let unapprovedCandidatesCount = 0;

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
        isApproved: false,
        action: "SKIP (No matching Firebase Auth user)",
      });
      continue;
    }

    const currentClaims = authUser.customClaims || {};
    const hasAdminClaim = currentClaims.admin === true;
    const isApproved = approvedUids.includes(candidate.uid);

    if (hasAdminClaim) {
      results.push({
        ...candidate,
        authEmail: authUser.email,
        authStatus: "VERIFIED",
        hasAdminClaim: true,
        isApproved,
        action: "VERIFIED (Admin claim active)",
      });
    } else if (!isApproved) {
      unapprovedCandidatesCount++;
      results.push({
        ...candidate,
        authEmail: authUser.email,
        authStatus: "UNAPPROVED",
        hasAdminClaim: false,
        isApproved: false,
        action: "BLOCKED (Requires explicit owner allowlist approval)",
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
          isApproved: true,
          action: "MIGRATED (Claim set: { admin: true })",
        });
      } else {
        results.push({
          ...candidate,
          authEmail: authUser.email,
          authStatus: "VERIFIED",
          hasAdminClaim: false,
          isApproved: true,
          action: "READY_FOR_MIGRATION (Approved in allowlist)",
        });
      }
    }
  }

  // Print Table
  console.log(
    "| UID                      | Email                     | Role  | SuperAdmin | Claim? | Allowlisted? | Action / Status"
  );
  console.log(
    "|--------------------------|---------------------------|-------|------------|--------|--------------|---------------------------------------------"
  );
  for (const r of results) {
    const uidPad = (r.uid || "").padEnd(24).slice(0, 24);
    const emailPad = (r.authEmail || r.email || "N/A").padEnd(25).slice(0, 25);
    const rolePad = (r.role || "").padEnd(5).slice(0, 5);
    const superPad = String(r.isSuperAdmin).padEnd(10).slice(0, 10);
    const claimPad = String(r.hasAdminClaim).padEnd(6).slice(0, 6);
    const allowPad = String(r.isApproved).padEnd(12).slice(0, 12);
    console.log(`| ${uidPad} | ${emailPad} | ${rolePad} | ${superPad} | ${claimPad} | ${allowPad} | ${r.action}`);
  }

  console.log("-------------------------------------------------------------------------------");
  console.log(`Total candidates: ${candidateAdmins.length}`);
  console.log(`Unapproved candidates: ${unapprovedCandidatesCount}`);
  console.log(`Approved accounts pending migration: ${pendingMigrationCount}`);

  if (unapprovedCandidatesCount > 0) {
    console.log("\n[SECURITY NOTICE] Candidate accounts with role == 'admin' cannot be granted custom");
    console.log("claims unless explicitly listed in an approved allowlist (--allowlist=uid1,uid2).");
  }

  if (pendingMigrationCount > 0 && !execute) {
    console.log("\nTo execute migration for approved accounts:");
    console.log("  node scripts/migrate-admin-claims.js --allowlist=uid1,uid2 --execute");
  }
}

runMigrationAudit().catch((err) => {
  console.error("[FATAL ERROR]", err);
  process.exit(1);
});
