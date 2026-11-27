#!/usr/bin/env node
/**
 * D-22 role consolidation: Match Admin, Studio Admin, Designer → Club Admin.
 *
 * DRY RUN by default (read-only). Writes only with --execute.
 * Per AGENTS.md: running --execute against production requires explicit owner
 * approval. Run the dry run first and review the report.
 *
 * Usage:
 *   node scripts/migrate-role-consolidation.mjs --database=<firestoreDatabaseId> [--execute] [--json]
 *
 * Credentials: serviceAccountKey.json in the repository root (never committed),
 * or FIRESTORE_EMULATOR_HOST for a local emulator run.
 *
 * Guarantees (lib/role-consolidation.ts, lib/access-control-server.ts):
 *   - Idempotent: accounts already consolidated are not changed again.
 *   - Adds isClubAdmin once; preserves isFinanceAdmin and existing isClubAdmin.
 *   - Never reads or writes Super Admin claims, UIDs or playerId links.
 *   - Removes the retired flags; keeps their original values in
 *     appUsers.roleMigration and writes one auditLogs entry per changed account.
 *   - Reports disabled, unlinked and unknown-role accounts for review.
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { authorizeRoleConsolidationExecution, runRoleConsolidation } from "../lib/access-control-server.ts";
import { APPROVED_FIRESTORE_DATABASE_IDS } from "../lib/database-config.ts";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const asJson = args.includes("--json");
const database = (args.find((a) => a.startsWith("--database=")) || "").slice("--database=".length);
const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (args.some((a) => a.startsWith("--actor"))) {
  console.error("Actor identity is derived from the server execution context and cannot be overridden via CLI.");
  process.exit(2);
}

if (!emulator) {
  if (!database || !APPROVED_FIRESTORE_DATABASE_IDS.has(database)) {
    console.error(`--database=<id> is required and must be one of: ${[...APPROVED_FIRESTORE_DATABASE_IDS].join(", ")}`);
    process.exit(2);
  }
  const keyPath = path.resolve(process.cwd(), "serviceAccountKey.json");
  if (!fs.existsSync(keyPath)) {
    console.error("serviceAccountKey.json not found in the repository root.");
    process.exit(2);
  }
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, "utf8"))) });
} else if (!getApps().length) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || "kavach-role-migration-local" });
}
const db = emulator ? getFirestore() : getFirestore(database);

const authCtx = execute
  ? authorizeRoleConsolidationExecution({ credentialSource: emulator ? "emulator" : "service_account" })
  : undefined;
const report = await runRoleConsolidation(db, { execute, auth: authCtx });
if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const s = report.summary;
  console.log(`\nRole consolidation — ${execute ? "EXECUTED" : "DRY RUN (no writes)"} — ${report.migrationId}${emulator ? " [emulator]" : ` [${database}]`}`);
  console.log("───────────────────────────────────────────────────────────────");
  console.log(`Accounts scanned                         ${s.scanned}`);
  console.log(`Match Admin holders                      ${s.matchAdmin}`);
  console.log(`Studio Admin holders                     ${s.studioAdmin}`);
  console.log(`Designer holders                         ${s.designer}`);
  console.log(`Holding more than one retired role       ${s.multipleRetired}`);
  console.log(`Will receive Club Admin (new)            ${s.receiveClubAdmin}`);
  console.log(`Already Club Admin (flags cleaned only)  ${s.alreadyClubAdmin}`);
  console.log(`Finance Admin preserved                  ${s.financePreserved}`);
  console.log(`Accounts to change                       ${s.changes}${execute ? `  → changed ${report.changed.length}` : ""}`);
  console.log(`Flagged for review                       ${s.flagged.length}`);
  for (const f of s.flagged) console.log(`  - ${f.uid}: ${f.flags.join(", ")} (retired: ${f.retired.join(", ")})`);
  console.log("Super Admin claims are not read or changed by this migration.\n");
}
