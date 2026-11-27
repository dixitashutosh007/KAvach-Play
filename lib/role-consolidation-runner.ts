/**
 * Role Consolidation Operational Runner (`lib/role-consolidation-runner.ts`).
 *
 * Strictly separated from Next.js API routes and UI modules (`app/`, `components/`).
 * Only operational CLI scripts (`scripts/migrate-role-consolidation.mjs`) and
 * emulator test suites may obtain a `MigrationExecutionAuth` capability.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { AccessError } from "./access-control-server.ts";
import { planRoleConsolidation, summariseConsolidation, type AppUserRoleDoc } from "./role-consolidation.ts";
import { writeServerAudit } from "./server-audit.ts";

const MIGRATION_AUTH_BRAND = Symbol("kavach.roleConsolidation.authorized");
const AUTHORIZED_EXECUTIONS = new WeakSet<object>();
const DEFAULT_MIGRATION_LEASE_MS = 5 * 60_000;

export interface MigrationExecutionAuth {
  readonly [MIGRATION_AUTH_BRAND]: true;
  readonly actorId: "system:role-consolidation";
  readonly actorName: "Role consolidation migration";
  readonly credentialSource: "service_account" | "emulator";
}

function validateServiceAccountFile(keyPath: string): void {
  if (!fs.existsSync(keyPath)) {
    throw new AccessError(403, "Role consolidation requires serviceAccountKey.json in the repository root.");
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(keyPath, "utf8")) as Record<string, unknown>;
  } catch {
    throw new AccessError(403, "Invalid serviceAccountKey.json credential file.");
  }
  if (
    parsed.type !== "service_account" ||
    typeof parsed.project_id !== "string" ||
    !parsed.project_id ||
    typeof parsed.client_email !== "string" ||
    !parsed.client_email ||
    typeof parsed.private_key !== "string" ||
    !parsed.private_key.includes("BEGIN")
  ) {
    throw new AccessError(403, "serviceAccountKey.json is missing required service account fields.");
  }
}

/**
 * Issues a non-serializable, WeakSet-verified execution capability for `runRoleConsolidation`.
 *
 * Security boundary:
 * - Refuses execution inside Next.js server runtimes (`process.env.NEXT_RUNTIME`) so no
 *   API route or Server Action can mint a capability even if imported.
 * - Validates actual operational credentials on disk (`serviceAccountKey.json`) or
 *   active local emulator (`FIRESTORE_EMULATOR_HOST`).
 */
export function authorizeRoleConsolidationExecution(opts: {
  credentialSource: "service_account" | "emulator";
  serviceAccountPath?: string;
}): MigrationExecutionAuth {
  if (process.env.NEXT_RUNTIME) {
    throw new AccessError(403, "Role consolidation execution is forbidden inside Next.js runtime.");
  }
  if (opts.credentialSource === "service_account") {
    const keyPath = opts.serviceAccountPath || path.resolve(process.cwd(), "serviceAccountKey.json");
    validateServiceAccountFile(keyPath);
  } else if (opts.credentialSource === "emulator") {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new AccessError(403, "Emulator execution requires FIRESTORE_EMULATOR_HOST to be configured.");
    }
  } else {
    throw new AccessError(403, "Invalid operational credential source for role consolidation.");
  }

  const ctx: MigrationExecutionAuth = Object.freeze({
    [MIGRATION_AUTH_BRAND]: true as const,
    actorId: "system:role-consolidation",
    actorName: "Role consolidation migration",
    credentialSource: opts.credentialSource,
  });
  AUTHORIZED_EXECUTIONS.add(ctx);
  return ctx;
}

function signatureForPlan(uid: string, plan: ReturnType<typeof planRoleConsolidation>): string {
  return `${uid}:${plan.retired.join(",")}:${plan.grantsClubAdmin ? 1 : 0}:${plan.preservesFinanceAdmin ? 1 : 0}`;
}

function fingerprintSignatures(signatures: readonly string[]): string {
  return crypto.createHash("sha256").update(signatures.join("|")).digest("hex");
}

/**
 * Role consolidation migration (Match Admin, Studio Admin, Designer → Club Admin).
 * Dry run by default. Idempotent, resumable, plan-fingerprinted, and transaction-fenced:
 *   - Every batch executes inside ONE Firestore transaction reading `migrationRuns/{migrationId}`,
 *     checking `fencingToken` + `leaseOwner`, updating `appUsers`, writing create-only `auditLogs`,
 *     and advancing the checkpoint atomically — eliminating TOCTOU races.
 *   - Persists `targetUids`, `planSignatures`, `planFingerprint`, and `migratedUids` so an
 *     incomplete or completed migration cannot be resumed/restarted with a different plan.
 */
export async function runRoleConsolidation(
  db: Firestore,
  opts: {
    execute?: boolean;
    auth?: MigrationExecutionAuth;
    migrationId?: string;
    batchSize?: number;
    leaseDurationMs?: number;
    onBeforeBatchTx?: (batchIndex: number, batchUids: string[]) => Promise<void> | void;
    onAfterLeaseAcquire?: (fencingToken: number) => Promise<void> | void;
  } = {},
) {
  const migrationId = opts.migrationId || `role-consolidation-${new Date().toISOString().slice(0, 10)}`;
  if (!migrationId || migrationId.includes("/") || migrationId.length > 128) {
    throw new AccessError(400, "Invalid migrationId.");
  }

  let actorId = "system:role-consolidation";
  let actorName = "Role consolidation migration";
  if (opts.execute) {
    const authCtx = opts.auth as MigrationExecutionAuth | undefined;
    if (!authCtx || typeof authCtx !== "object" || !AUTHORIZED_EXECUTIONS.has(authCtx) || authCtx[MIGRATION_AUTH_BRAND] !== true) {
      throw new AccessError(
        403,
        "Role consolidation execution requires a verified server-side MigrationExecutionAuth context.",
      );
    }
    actorId = authCtx.actorId;
    actorName = authCtx.actorName;
  }

  const snap = await db.collection("appUsers").get();
  const docs = snap.docs
    .map((d) => ({ uid: d.id, doc: d.data() as AppUserRoleDoc }))
    .sort((a, b) => a.uid.localeCompare(b.uid));
  const summary = summariseConsolidation(docs);
  const maxAccountsPerBatch = Math.min(Math.max(opts.batchSize || 100, 1), 100);
  const leaseDurationMs = Math.max(opts.leaseDurationMs ?? DEFAULT_MIGRATION_LEASE_MS, 50);
  const changed: { uid: string; retired: string[]; grantsClubAdmin: boolean }[] = [];

  if (!opts.execute) {
    return { migrationId, executed: false, alreadyCompleted: false, summary, changed };
  }

  const pendingPlans = docs
    .map(({ uid, doc }) => ({ uid, doc, plan: planRoleConsolidation(doc) }))
    .filter((x) => x.plan.needsChange);
  const pendingSignatures = pendingPlans.map((x) => signatureForPlan(x.uid, x.plan));

  const runRef = db.collection("migrationRuns").doc(migrationId);
  const leaseOwner = `${actorId}_${crypto.randomUUID().slice(0, 8)}`;
  const nowMs = Date.now();
  let prevBatches = 0;
  let prevMigratedCount = 0;
  let migratedUids: string[] = [];
  let fencingToken = 1;
  let alreadyCompleted = false;

  await db.runTransaction(async (tx) => {
    const runSnap = await tx.get(runRef);
    if (runSnap.exists) {
      const status = runSnap.get("status");
      const leaseExpiresAt = Number(runSnap.get("leaseExpiresAt") || 0);
      const savedTargetUids: string[] = Array.isArray(runSnap.get("targetUids"))
        ? (runSnap.get("targetUids") as string[])
        : [];
      const savedMigratedUids: string[] = Array.isArray(runSnap.get("migratedUids"))
        ? (runSnap.get("migratedUids") as string[])
        : [];
      const savedSignatures = (runSnap.get("planSignatures") || {}) as Record<string, string>;

      if (status === "completed") {
        if (pendingPlans.length > 0) {
          throw new AccessError(
            409,
            "Migration ID is already completed; cannot restart under the same ID with unconsolidated accounts.",
          );
        }
        alreadyCompleted = true;
        return;
      }

      if (status === "in_progress" && leaseExpiresAt > nowMs) {
        throw new AccessError(409, "Migration is already in progress under this migrationId.");
      }

      // Plan consistency check on resume: remaining pending accounts must match saved plan
      const expectedRemaining = savedTargetUids.filter((u) => !savedMigratedUids.includes(u));
      const currentPendingUids = pendingPlans.map((p) => p.uid);
      const sameRemainingUids =
        expectedRemaining.length === currentPendingUids.length &&
        expectedRemaining.every((u, idx) => u === currentPendingUids[idx]);
      const sameSignatures = pendingPlans.every(
        (p) => savedSignatures[p.uid] === signatureForPlan(p.uid, p.plan),
      );
      if (!sameRemainingUids || !sameSignatures) {
        throw new AccessError(
          409,
          "Migration plan changed since migrationId was started; use a new migrationId.",
        );
      }

      prevBatches = Number(runSnap.get("batchesCommitted") || 0);
      prevMigratedCount = Number(runSnap.get("migratedCount") || 0);
      migratedUids = [...savedMigratedUids];
      fencingToken = Number(runSnap.get("fencingToken") || 0) + 1;
    }

    const initialTargetUids = runSnap.exists ? (runSnap.get("targetUids") as string[]) : pendingPlans.map((p) => p.uid);
    const initialPlanSignatures = runSnap.exists
      ? (runSnap.get("planSignatures") as Record<string, string>)
      : Object.fromEntries(pendingPlans.map((p) => [p.uid, signatureForPlan(p.uid, p.plan)]));
    const initialFingerprint = runSnap.exists
      ? String(runSnap.get("planFingerprint") || "")
      : fingerprintSignatures(pendingSignatures);

    tx.set(
      runRef,
      {
        migrationId,
        status: "in_progress",
        actorId,
        actorName,
        leaseOwner,
        fencingToken,
        leaseExpiresAt: nowMs + leaseDurationMs,
        targetUids: initialTargetUids,
        planSignatures: initialPlanSignatures,
        planFingerprint: initialFingerprint,
        migratedUids,
        batchesCommitted: prevBatches,
        migratedCount: prevMigratedCount,
        lastError: null,
        startedAt: runSnap.exists ? runSnap.get("startedAt") || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  if (alreadyCompleted) {
    return { migrationId, executed: true, alreadyCompleted: true, summary, changed: [] };
  }

  if (opts.onAfterLeaseAcquire) {
    await opts.onAfterLeaseAcquire(fencingToken);
  }

  let batchesCommitted = prevBatches;
  let migratedCount = prevMigratedCount;

  try {
    if (pendingPlans.length === 0) {
      await db.runTransaction(async (tx) => {
        const snapRun = await tx.get(runRef);
        if (!snapRun.exists || snapRun.get("fencingToken") !== fencingToken || snapRun.get("leaseOwner") !== leaseOwner) {
          throw new AccessError(409, "Migration lease was superseded before completion.");
        }
        tx.update(runRef, {
          status: "completed",
          leaseExpiresAt: null,
          lastError: null,
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      return { migrationId, executed: true, alreadyCompleted: false, summary, changed: [] };
    }

    const totalBatches = Math.ceil(pendingPlans.length / maxAccountsPerBatch);
    for (let bIdx = 0; bIdx < totalBatches; bIdx++) {
      const chunk = pendingPlans.slice(bIdx * maxAccountsPerBatch, (bIdx + 1) * maxAccountsPerBatch);
      const isFinalBatch = bIdx === totalBatches - 1;
      const batchIndex = batchesCommitted + 1;

      if (opts.onBeforeBatchTx) {
        await opts.onBeforeBatchTx(
          batchIndex,
          chunk.map((c) => c.uid),
        );
      }

      const batchChanged: { uid: string; retired: string[]; grantsClubAdmin: boolean }[] = [];

      // Single atomic Firestore transaction per batch:
      // Reads runRef (fencing check) + chunk appUsers, then writes appUsers + auditLogs + checkpoint.
      await db.runTransaction(async (tx) => {
        const [freshRunSnap, ...userSnaps] = await Promise.all([
          tx.get(runRef),
          ...chunk.map((c) => tx.get(db.collection("appUsers").doc(c.uid))),
        ]);

        if (
          !freshRunSnap.exists ||
          freshRunSnap.get("fencingToken") !== fencingToken ||
          freshRunSnap.get("leaseOwner") !== leaseOwner
        ) {
          throw new AccessError(409, "Migration lease was superseded by another executor (fencing mismatch).");
        }

        const newlyMigrated: string[] = [];
        for (let j = 0; j < chunk.length; j++) {
          const { uid } = chunk[j]!;
          const uSnap = userSnaps[j]!;
          if (!uSnap.exists) continue;
          const freshDoc = uSnap.data() as AppUserRoleDoc;
          const freshPlan = planRoleConsolidation(freshDoc);
          if (!freshPlan.needsChange) continue;

          const update: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(freshPlan.update)) update[k] = v === null ? FieldValue.delete() : v;
          update.roleMigration = {
            migrationId,
            from: Object.fromEntries(
              ["isMatchAdmin", "isStudioAdmin", "isDesigner", "canDesign", "role", "isClubAdmin", "isFinanceAdmin"]
                .filter((k) => (freshDoc as any)[k] !== undefined)
                .map((k) => [k, (freshDoc as any)[k]]),
            ),
            migratedAt: FieldValue.serverTimestamp(),
          };
          update.rolesUpdatedAt = FieldValue.serverTimestamp();
          update.rolesUpdatedBy = actorId;
          tx.update(db.collection("appUsers").doc(uid), update);

          await writeServerAudit(
            db,
            {
              actorId,
              actorName,
              actorType: "system",
              action: "status_change",
              entity: "access",
              entityId: uid,
              entityLabel: String((freshDoc as any).name || (freshDoc as any).email || uid),
              changes: [
                {
                  field: "roles",
                  oldValue:
                    freshPlan.retired
                      .map((r) => ({ matchAdmin: "Match Admin", studioAdmin: "Studio Admin", designer: "Designer" })[r])
                      .join(", ") + (freshPlan.alreadyClubAdmin ? " (already Club Admin)" : ""),
                  newValue: "Club Admin" + (freshPlan.preservesFinanceAdmin ? ", Finance Admin" : ""),
                },
              ],
              summary: `${migrationId}: retired role(s) ${freshPlan.retired.join(", ")} consolidated into Club Admin${freshPlan.grantsClubAdmin ? "" : " (already held)"}.`,
              id: `role_consolidation_${migrationId}_${uid}`,
            },
            tx,
          );

          newlyMigrated.push(uid);
          batchChanged.push({ uid, retired: freshPlan.retired, grantsClubAdmin: freshPlan.grantsClubAdmin });
        }

        const nextMigratedUids = [...new Set([...migratedUids, ...newlyMigrated])];
        const nextBatchesCommitted = batchesCommitted + 1;
        const nextMigratedCount = migratedCount + batchChanged.length;

        tx.update(runRef, {
          batchesCommitted: nextBatchesCommitted,
          migratedCount: nextMigratedCount,
          migratedUids: nextMigratedUids,
          ...(isFinalBatch
            ? {
                status: "completed",
                leaseExpiresAt: null,
                lastError: null,
                completedAt: FieldValue.serverTimestamp(),
              }
            : {
                leaseExpiresAt: Date.now() + leaseDurationMs,
              }),
          updatedAt: FieldValue.serverTimestamp(),
        });

        migratedUids = nextMigratedUids;
        batchesCommitted = nextBatchesCommitted;
        migratedCount = nextMigratedCount;
      });

      changed.push(...batchChanged);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Batch transaction failed";
    try {
      await db.runTransaction(async (tx) => {
        const snapRun = await tx.get(runRef);
        if (!snapRun.exists || snapRun.get("fencingToken") !== fencingToken || snapRun.get("leaseOwner") !== leaseOwner) {
          return;
        }
        tx.update(runRef, {
          status: "failed",
          batchesCommitted,
          migratedCount,
          migratedUids,
          leaseExpiresAt: null,
          lastError: errMsg.slice(0, 300),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
    } catch {
      // Ignore secondary failure while propagating primary error
    }
    throw err;
  }

  return { migrationId, executed: true, alreadyCompleted: false, summary, changed };
}
