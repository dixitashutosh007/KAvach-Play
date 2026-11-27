/**
 * Access Control Centre — server logic (D-22). Admin SDK only; used by
 * /api/admin/access and scripts/migrate-role-consolidation.mjs.
 *
 * Single writer of every role:
 *   - Club Admin / Finance Admin: appUsers.isClubAdmin / isFinanceAdmin
 *     (firestore.rules make all role keys server-only).
 *   - Super Admin: Firebase Auth custom claim `admin: true` (SEC-001).
 * Every change writes one auditLogs entry (entity "access").
 */
import crypto from "node:crypto";
import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { writeServerAudit } from "./server-audit.ts";
import {
  ACTIVE_ROLES,
  activeRolesOf,
  diffRoles,
  planRoleConsolidation,
  roleLabel,
  summariseConsolidation,
  type ActiveRole,
  type AppUserRoleDoc,
} from "./role-consolidation.ts";

/** Server-only lock + authoritative Super Admin list for the last-Super-Admin guard. */
export const SUPER_ADMIN_LOCK = { collection: "accessControl", doc: "superAdmins" } as const;

export class AccessError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** UIDs (of the given set) whose Auth record carries the `admin` claim. Missing users count as no claim. */
export async function superAdminUids(auth: Auth, uids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < uids.length; i += 100) {
    const res = await auth.getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
    for (const u of res.users) if (u.customClaims?.admin === true && !u.disabled) out.add(u.uid);
  }
  return out;
}

export interface DirectoryRow {
  key: string;
  uid: string | null;
  playerId: string | null;
  name: string;
  kavachId: string | null;
  photoURL: string | null;
  email: string | null;
  roles: ActiveRole[];
  status: "Active" | "Disabled" | "No account";
  linked: boolean;
  lastUpdated: string | null;
  /** Retired-role fields still present (pre-migration). Informational only — they grant nothing. */
  legacy: string[];
}

const iso = (v: any): string | null => (v && typeof v.toDate === "function" ? v.toDate().toISOString() : typeof v === "string" ? v : null);
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/** Every player and account, joined by appUsers.playerId (authoritative link). */
export interface Directory {
  rows: DirectoryRow[];
  /** Lower-cased search text per row key (name, Player ID, KAvach ID, uid, email, phone digits). Server-side only. */
  search: Map<string, string>;
}

export async function loadDirectory(db: Firestore, auth: Auth): Promise<Directory> {
  const [usersSnap, playersSnap] = await Promise.all([
    db.collection("appUsers").select("name", "email", "mobile", "status", "playerId", "role", "isClubAdmin", "isFinanceAdmin", "isMatchAdmin", "isStudioAdmin", "isDesigner", "canDesign", "rolesUpdatedAt").get(),
    db.collection("players").select("name", "kavachId", "photoURL", "email", "mobile", "disabled", "mergedInto").get(),
  ]);
  const supers = await superAdminUids(auth, usersSnap.docs.map((d) => d.id));
  const accountByPlayer = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const d of usersSnap.docs) {
    const pid = d.get("playerId");
    if (typeof pid === "string" && pid && !accountByPlayer.has(pid)) accountByPlayer.set(pid, d);
  }
  const rowFor = (player: FirebaseFirestore.QueryDocumentSnapshot | null, account: FirebaseFirestore.QueryDocumentSnapshot | null): DirectoryRow => {
    const a = (account?.data() || {}) as AppUserRoleDoc & Record<string, any>;
    const p = (player?.data() || {}) as Record<string, any>;
    const plan = account ? planRoleConsolidation(a) : null;
    return {
      key: player ? `p:${player.id}` : `u:${account!.id}`,
      uid: account?.id ?? null,
      playerId: player?.id ?? (typeof a.playerId === "string" ? a.playerId : null),
      name: String(p.name || a.name || (a.email ? String(a.email).split("@")[0] : "") || "Unnamed account"),
      kavachId: p.kavachId ? String(p.kavachId) : null,
      photoURL: typeof p.photoURL === "string" && p.photoURL.startsWith("https://") ? p.photoURL : null,
      email: (a.email || p.email || null) as string | null,
      roles: account ? activeRolesOf(a, supers.has(account.id)) : [],
      status: !account ? "No account" : a.status === "Disabled" ? "Disabled" : "Active",
      linked: Boolean(account && player),
      lastUpdated: iso(a.rolesUpdatedAt),
      legacy: plan?.retired ?? [],
    };
  };
  const rows: DirectoryRow[] = [];
  const used = new Set<string>();
  for (const p of playersSnap.docs) {
    if (p.get("mergedInto")) continue;
    const acc = accountByPlayer.get(p.id) || null;
    if (acc) used.add(acc.id);
    rows.push(rowFor(p, acc));
  }
  for (const u of usersSnap.docs) if (!used.has(u.id)) rows.push(rowFor(null, u));
  const userById = new Map(usersSnap.docs.map((d) => [d.id, d]));
  const playerById = new Map(playersSnap.docs.map((d) => [d.id, d]));
  const search = new Map(
    rows.map((r) => {
      const u = r.uid ? userById.get(r.uid) : undefined;
      const p = r.playerId ? playerById.get(r.playerId) : undefined;
      return [r.key, [r.name, r.kavachId, r.playerId, r.uid, r.email, digits(u?.get("mobile")), digits(p?.get("mobile"))].filter(Boolean).join(" ").toLowerCase()];
    }),
  );
  return { rows, search };
}

export type DirectoryFilter = "all" | ActiveRole | "multiple" | "none";

export function queryDirectory({ rows, search }: Directory, opts: { q?: string; filter?: DirectoryFilter; page?: number; pageSize?: number }) {
  const q = (opts.q || "").trim().toLowerCase();
  const qDigits = digits(q);
  const filter = opts.filter || "all";
  let list = rows.filter((r) => {
    if (filter === "multiple" && r.roles.length < 2) return false;
    if (filter === "none" && r.roles.length > 0) return false;
    if ((ACTIVE_ROLES as readonly string[]).includes(filter) && !r.roles.includes(filter as ActiveRole)) return false;
    if (!q) return true;
    const hay = search.get(r.key) || r.name.toLowerCase();
    return hay.includes(q) || (qDigits.length >= 4 && hay.includes(qDigits));
  });
  list = list.sort((a, b) => b.roles.length - a.roles.length || a.name.localeCompare(b.name));
  const pageSize = Math.min(Math.max(opts.pageSize || 25, 5), 100);
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(opts.page || 1, 1), pages);
  return { total, page, pages, pageSize, rows: list.slice((page - 1) * pageSize, page * pageSize) };
}

export function roleCounts(rows: DirectoryRow[]) {
  const counts: Record<ActiveRole, number> = { superAdmin: 0, clubAdmin: 0, financeAdmin: 0 };
  for (const r of rows) if (r.status === "Active") for (const role of r.roles) counts[role]++;
  return counts;
}

export type RoleTransitionStatus = "pending" | "completed" | "failed";

export interface RoleTransitionRecord {
  transitionId: string;
  uid: string;
  actorUid: string;
  actorName: string;
  superChange: "grant" | "revoke";
  previousRoles: ActiveRole[];
  requestedRoles: ActiveRole[];
  status: RoleTransitionStatus;
  claimSynced: boolean;
  tokensRevoked: boolean;
  auditCorrelationId: string;
  attempts: number;
  lastError: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  completedAt?: unknown;
  reconciledBy?: string | null;
}

const labelRoles = (rs: readonly ActiveRole[]) => (rs.length ? rs.map(roleLabel).join(", ") : "No admin role");

function buildRoleDiffSummary(grant: readonly ActiveRole[], revoke: readonly ActiveRole[]): string {
  return [...grant.map((r) => `Granted ${roleLabel(r)}`), ...revoke.map((r) => `Revoked ${roleLabel(r)}`)].join("; ");
}

async function ensureSuperAdminLockSeeded(db: Firestore, auth: Auth): Promise<string[]> {
  const lockRef = db.collection(SUPER_ADMIN_LOCK.collection).doc(SUPER_ADMIN_LOCK.doc);
  const lockSnap = await lockRef.get();
  if (lockSnap.exists && Array.isArray(lockSnap.get("uids"))) {
    return lockSnap.get("uids") as string[];
  }
  const all = await db.collection("appUsers").select().get();
  const seeded = [...(await superAdminUids(auth, all.docs.map((d) => d.id)))];
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(lockRef);
    if (!fresh.exists) {
      tx.set(lockRef, { uids: seeded, pendingRevokes: [], updatedAt: FieldValue.serverTimestamp(), updatedBy: "system_seed" });
    }
  });
  const after = await lockRef.get();
  return Array.isArray(after.get("uids")) ? (after.get("uids") as string[]) : seeded;
}

async function applyAuthClaimAndRevoke(
  auth: Auth,
  uid: string,
  superChange: "grant" | "revoke",
  state: { claimSynced: boolean },
): Promise<{ claimSynced: boolean; tokensRevoked: boolean }> {
  if (!state.claimSynced) {
    const authUser = await auth.getUser(uid);
    const claims = { ...(authUser.customClaims || {}) } as Record<string, unknown>;
    if (superChange === "grant") claims.admin = true;
    else delete claims.admin;
    await auth.setCustomUserClaims(uid, claims);
    state.claimSynced = true;
  }
  let tokensRevoked = superChange !== "revoke";
  if (superChange === "revoke") {
    await auth.revokeRefreshTokens(uid);
    tokensRevoked = true;
  }
  return { claimSynced: state.claimSynced, tokensRevoked };
}

async function finalizeSuperAdminTransition(
  db: Firestore,
  transitionId: string,
  reconciledBy?: string,
): Promise<{ alreadyCompleted: boolean; roles: ActiveRole[] }> {
  const transRef = db.collection("roleTransitions").doc(transitionId);
  const lockRef = db.collection(SUPER_ADMIN_LOCK.collection).doc(SUPER_ADMIN_LOCK.doc);
  let out: { alreadyCompleted: boolean; roles: ActiveRole[] } = { alreadyCompleted: false, roles: [] };

  await db.runTransaction(async (tx) => {
    const [transSnap, lockSnap] = await Promise.all([tx.get(transRef), tx.get(lockRef)]);
    if (!transSnap.exists) throw new AccessError(404, "Role transition record not found.");
    const t = transSnap.data() as RoleTransitionRecord;
    if (t.status === "completed") {
      out = { alreadyCompleted: true, roles: t.requestedRoles };
      return;
    }

    const userSnap = await tx.get(db.collection("appUsers").doc(t.uid));
    const userDoc = (userSnap.data() || {}) as Record<string, any>;

    const currentUids: string[] = Array.isArray(lockSnap.get("uids")) ? [...(lockSnap.get("uids") as string[])] : [];
    const currentPendingRevokes: string[] = Array.isArray(lockSnap.get("pendingRevokes"))
      ? [...(lockSnap.get("pendingRevokes") as string[])]
      : [];

    const nextUids =
      t.superChange === "grant"
        ? [...new Set([...currentUids, t.uid])]
        : currentUids.filter((x) => x !== t.uid);
    const nextPendingRevokes = currentPendingRevokes.filter((x) => x !== t.uid);

    tx.set(
      lockRef,
      {
        uids: nextUids,
        pendingRevokes: nextPendingRevokes,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: reconciledBy || t.actorUid,
      },
      { merge: true },
    );

    tx.update(transRef, {
      status: "completed",
      claimSynced: true,
      tokensRevoked: t.superChange === "revoke",
      lastError: null,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(reconciledBy ? { reconciledBy } : {}),
    });

    const { grant, revoke } = diffRoles(t.previousRoles, t.requestedRoles);
    const summaryBase = buildRoleDiffSummary(grant, revoke) || `Completed Super Admin ${t.superChange}`;

    await writeServerAudit(
      db,
      {
        actorId: reconciledBy || t.actorUid,
        actorName: t.actorName,
        action: "updated",
        entity: "access",
        entityId: t.uid,
        entityLabel: String(userDoc.name || userDoc.email || t.uid),
        changes: [
          { field: "roles", oldValue: labelRoles(t.previousRoles), newValue: labelRoles(t.requestedRoles) },
          { field: "superAdminTransition", oldValue: t.status, newValue: "completed" },
        ],
        summary: reconciledBy ? `${summaryBase} (reconciled)` : summaryBase,
        id: `role_done_${t.auditCorrelationId}`,
      },
      tx,
    );

    out = { alreadyCompleted: false, roles: t.requestedRoles };
  });

  return out;
}

async function markSuperAdminTransitionFailed(
  db: Firestore,
  transitionId: string,
  errMsg: string,
  claimSynced: boolean,
): Promise<void> {
  const transRef = db.collection("roleTransitions").doc(transitionId);
  await db.runTransaction(async (tx) => {
    const transSnap = await tx.get(transRef);
    if (!transSnap.exists) return;
    const t = transSnap.data() as RoleTransitionRecord;
    if (t.status === "completed") return;
    const nextAttempts = Number(t.attempts || 0) + 1;
    tx.update(transRef, {
      status: "failed",
      claimSynced,
      tokensRevoked: false,
      attempts: nextAttempts,
      lastError: errMsg.slice(0, 300),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await writeServerAudit(
      db,
      {
        actorId: t.actorUid,
        actorName: t.actorName,
        action: "status_change",
        entity: "access",
        entityId: t.uid,
        entityLabel: t.uid,
        changes: [{ field: "superAdminTransition", oldValue: t.status, newValue: "failed" }],
        summary: `Super Admin ${t.superChange} failed during Auth sync; reconciliation required`,
        id: `role_fail_${t.auditCorrelationId}_${nextAttempts}`,
      },
      tx,
    );
  });
}

/**
 * Grant / revoke roles for one account. Super Admin only (checked by the route).
 *
 * P2-ID-04:
 * - Zero Firebase Auth calls inside Firestore transaction callbacks.
 * - Super Admin transitions use an explicit 3-stage durable state machine
 *   (`roleTransitions/{transitionId}`: pending → completed | failed):
 *   1. Stage 1 (Firestore tx): validates state, enforces last-Super-Admin guard
 *      using `superAdmins.uids` minus `pendingRevokes`, applies non-super Firestore
 *      role changes, creates `roleTransitions` in `pending`, and writes the
 *      "requested" audit record. Incomplete grants are NOT added to `uids`.
 *   2. Stage 2 (Auth SDK, outside tx): updates custom claims & revokes tokens.
 *   3. Stage 3 (Firestore tx): marks `completed`, updates `superAdmins.uids`, and
 *      writes the "completed" audit record. On Auth failure, marks `failed`
 *      (reconciliation-required) and records the failure audit.
 */
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

export async function setAccountRoles(
  db: Firestore,
  auth: Auth,
  args: { actorUid: string; actorName: string; uid: string; roles: ActiveRole[]; expected: ActiveRole[]; idempotencyKey?: string },
) {
  const { actorUid, actorName, uid } = args;
  if (uid === actorUid) throw new AccessError(403, "You can't change your own access. Ask another Super Admin.");
  const next = ACTIVE_ROLES.filter((r) => args.roles.includes(r));

  const userRef = db.collection("appUsers").doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) throw new AccessError(404, "This player has no linked account yet. Roles need a signed-in account.");
  const doc = snap.data() as AppUserRoleDoc & Record<string, any>;

  let authUser;
  try {
    authUser = await auth.getUser(uid);
  } catch {
    throw new AccessError(404, "No sign-in account exists for this user.");
  }

  const hasSuper = authUser.customClaims?.admin === true;
  const current = activeRolesOf(doc, hasSuper);

  // Check idempotent retry on an explicit transition key before concurrency conflict checks
  const rawKey = typeof args.idempotencyKey === "string" ? args.idempotencyKey.trim() : "";
  const safeKey = rawKey && /^[a-zA-Z0-9_-]{1,96}$/.test(rawKey) ? rawKey : null;
  if (safeKey) {
    const existingTransSnap = await db.collection("roleTransitions").doc(safeKey).get();
    if (existingTransSnap.exists) {
      const existingTrans = existingTransSnap.data() as RoleTransitionRecord;
      if (existingTrans.uid !== uid) {
        throw new AccessError(409, "Idempotency key belongs to a different account.");
      }
      if (existingTrans.status === "completed") {
        return { changed: true, roles: existingTrans.requestedRoles, alreadyCompleted: true, transitionId: safeKey };
      }
      return reconcileRoleTransition(db, auth, { transitionId: safeKey, actorUid, actorName });
    }
  }

  // Block new role changes if a Super Admin transition is already pending/failed for this uid
  const openTransitions = await db
    .collection("roleTransitions")
    .where("uid", "==", uid)
    .where("status", "in", ["pending", "failed"])
    .limit(1)
    .get();
  if (!openTransitions.empty) {
    const open = openTransitions.docs[0]!.data() as RoleTransitionRecord;
    throw new AccessError(
      409,
      "A Super Admin claim transition is pending or requires reconciliation for this account.",
      { reconciliationRequired: true, transitionId: open.transitionId, status: open.status },
    );
  }

  if (!sameSet(current, args.expected)) {
    throw new AccessError(409, "This user's access changed since you opened it. Review the current roles and try again.", { current });
  }
  const { grant, revoke, changed } = diffRoles(current, next);
  if (!changed) return { changed: false, roles: current };
  if (grant.length && doc.status === "Disabled") throw new AccessError(400, "This account is disabled. Re-enable it before granting roles.");

  const superChange = grant.includes("superAdmin") ? "grant" : revoke.includes("superAdmin") ? "revoke" : null;
  const lockRef = db.collection(SUPER_ADMIN_LOCK.collection).doc(SUPER_ADMIN_LOCK.doc);

  // Pre-transaction Auth verification (NEVER inside tx callback)
  let verifiedOtherSupers = new Set<string>();
  if (superChange) {
    const seededUids = await ensureSuperAdminLockSeeded(db, auth);
    if (superChange === "revoke") {
      verifiedOtherSupers = await superAdminUids(auth, seededUids.filter((x) => x !== uid));
      if (verifiedOtherSupers.size < 1) {
        throw new AccessError(409, "This is the last active Super Admin. Grant Super Admin to someone else first.");
      }
    }
  }

  const transitionId = safeKey || `rt_${uid}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const transRef = db.collection("roleTransitions").doc(transitionId);

  // Stage 1: Atomic Firestore transaction (intent + non-super roles + requested audit)
  await db.runTransaction(async (tx: Transaction) => {
    const [fresh, lock, existingInTx] = await Promise.all([
      tx.get(userRef),
      superChange ? tx.get(lockRef) : Promise.resolve(null),
      superChange ? tx.get(transRef) : Promise.resolve(null),
    ]);
    if (existingInTx?.exists) {
      throw new AccessError(409, "Role transition already exists; retry reconciliation instead.", { transitionId });
    }
    const freshDoc = (fresh.data() || {}) as AppUserRoleDoc;
    if (!sameSet(activeRolesOf(freshDoc, hasSuper), current)) {
      throw new AccessError(409, "This user's access changed since you opened it.");
    }

    if (superChange) {
      const list: string[] = Array.isArray(lock!.get("uids")) ? [...(lock!.get("uids") as string[])] : [];
      const pendingRevokes: string[] = Array.isArray(lock!.get("pendingRevokes"))
        ? [...(lock!.get("pendingRevokes") as string[])]
        : [];

      if (superChange === "revoke") {
        // Count active Super Admins not in pendingRevokes and verified in Auth
        const remainingActive = list.filter((x) => x !== uid && !pendingRevokes.includes(x) && verifiedOtherSupers.has(x));
        if (remainingActive.length < 1) {
          throw new AccessError(409, "This is the last active Super Admin. Grant Super Admin to someone else first.");
        }
        tx.set(
          lockRef,
          {
            pendingRevokes: [...new Set([...pendingRevokes, uid])],
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: actorUid,
          },
          { merge: true },
        );
      }

      const transRecord: RoleTransitionRecord = {
        transitionId,
        uid,
        actorUid,
        actorName,
        superChange,
        previousRoles: current,
        requestedRoles: next,
        status: "pending",
        claimSynced: false,
        tokensRevoked: false,
        auditCorrelationId: transitionId,
        attempts: 0,
        lastError: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      tx.create(transRef, transRecord);
    }

    const update: Record<string, unknown> = { rolesUpdatedAt: FieldValue.serverTimestamp(), rolesUpdatedBy: actorUid };
    if (grant.includes("clubAdmin")) update.isClubAdmin = true;
    if (revoke.includes("clubAdmin")) {
      update.isClubAdmin = FieldValue.delete();
      if (freshDoc.role === "clubAdmin") update.role = "player";
    }
    if (grant.includes("financeAdmin")) update.isFinanceAdmin = true;
    if (revoke.includes("financeAdmin")) {
      update.isFinanceAdmin = FieldValue.delete();
      if (freshDoc.role === "financeAdmin") update.role = "player";
    }
    tx.update(userRef, update);

    if (superChange) {
      await writeServerAudit(
        db,
        {
          actorId: actorUid,
          actorName,
          action: "status_change",
          entity: "access",
          entityId: uid,
          entityLabel: String(doc.name || doc.email || uid),
          changes: [
            { field: "roles", oldValue: labelRoles(current), newValue: labelRoles(next) },
            { field: "superAdminTransition", oldValue: "none", newValue: "pending" },
          ],
          summary: `Requested Super Admin ${superChange} for ${String(doc.name || doc.email || uid)} (pending Auth claim sync)`,
          id: `role_req_${transitionId}`,
        },
        tx,
      );
    } else {
      await writeServerAudit(
        db,
        {
          actorId: actorUid,
          actorName,
          action: "updated",
          entity: "access",
          entityId: uid,
          entityLabel: String(doc.name || doc.email || uid),
          changes: [{ field: "roles", oldValue: labelRoles(current), newValue: labelRoles(next) }],
          summary: buildRoleDiffSummary(grant, revoke),
        },
        tx,
      );
    }
  });

  if (!superChange) {
    return { changed: true, roles: next, grant, revoke };
  }

  // Stage 2: Firebase Auth claim & token revocation (outside transaction)
  const syncState = { claimSynced: false };
  try {
    await applyAuthClaimAndRevoke(auth, uid, superChange, syncState);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Firebase Auth update failed";
    await markSuperAdminTransitionFailed(db, transitionId, msg, syncState.claimSynced);
    throw new AccessError(
      502,
      `Super Admin ${superChange} could not be synced to Firebase Auth; reconciliation required.`,
      { transitionId, reconciliationRequired: true, status: "failed" },
    );
  }

  // Stage 3: Finalize transition + update superAdmins lock + write completed audit
  await finalizeSuperAdminTransition(db, transitionId);
  return { changed: true, roles: next, grant, revoke, transitionId, status: "completed" as const };
}

/**
 * Controlled recovery / reconciliation for a pending or failed Super Admin claim transition.
 * Idempotent: if already completed, returns without duplicating state or audits.
 */
export async function reconcileRoleTransition(
  db: Firestore,
  auth: Auth,
  args: { transitionId: string; actorUid: string; actorName: string },
) {
  const { transitionId, actorUid } = args;
  const transSnap = await db.collection("roleTransitions").doc(transitionId).get();
  if (!transSnap.exists) {
    throw new AccessError(404, "Role transition not found.");
  }
  const t = transSnap.data() as RoleTransitionRecord;
  if (t.status === "completed") {
    return { changed: false, alreadyCompleted: true, roles: t.requestedRoles, transitionId, status: "completed" as const };
  }

  const syncState = { claimSynced: Boolean(t.claimSynced) };
  try {
    await applyAuthClaimAndRevoke(auth, t.uid, t.superChange, syncState);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Firebase Auth reconciliation failed";
    await markSuperAdminTransitionFailed(db, transitionId, msg, syncState.claimSynced);
    throw new AccessError(
      502,
      `Reconciliation failed during Firebase Auth sync: ${msg}`,
      { transitionId, reconciliationRequired: true, status: "failed" },
    );
  }

  const finalized = await finalizeSuperAdminTransition(db, transitionId, actorUid);
  return {
    changed: !finalized.alreadyCompleted,
    alreadyCompleted: finalized.alreadyCompleted,
    roles: finalized.roles,
    transitionId,
    status: "completed" as const,
  };
}

/** Lists pending/failed Super Admin transitions requiring operator visibility/reconciliation. */
export async function listPendingRoleTransitions(db: Firestore) {
  const snap = await db.collection("roleTransitions").where("status", "in", ["pending", "failed"]).limit(50).get();
  return snap.docs.map((d) => {
    const t = d.data() as RoleTransitionRecord;
    return {
      transitionId: t.transitionId,
      uid: t.uid,
      superChange: t.superChange,
      status: t.status,
      claimSynced: t.claimSynced,
      tokensRevoked: t.tokensRevoked,
      attempts: t.attempts,
      lastError: t.lastError,
      updatedAt: iso(t.updatedAt),
    };
  });
}

/** Recent access changes (role grants/revokes and the consolidation migration), newest first. */
export async function accessHistory(db: Firestore, limit = 100) {
  const snap = await db.collection("auditLogs").where("entity", "==", "access").limit(500).get();
  return snap.docs
    .map((d) => {
      const x = d.data() || {};
      return {
        id: d.id,
        uid: x.entityId || null,
        user: x.entityLabel || x.entityId || "",
        before: x.changes?.[0]?.oldValue ?? null,
        after: x.changes?.[0]?.newValue ?? null,
        summary: x.summary || "",
        actor: x.actorName || x.actorId || "",
        at: iso(x.timestamp),
      };
    })
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
    .slice(0, limit);
}

/**
 * Role consolidation migration (Match Admin, Studio Admin, Designer → Club Admin).
 * Dry run by default. Idempotent, resumable, and progress-tracked in `migrationRuns/{migrationId}`:
 *   - Never touches claims, UID, or playerId.
 *   - Keeps original values in `appUsers.roleMigration`.
 *   - Writes one create-only `auditLogs` entry (`role_consolidation_${migrationId}_${uid}`) per changed account.
 *   - Persists batch checkpoints so partial failures never lose progress and retries skip migrated accounts.
 */
export async function runRoleConsolidation(
  db: Firestore,
  opts: {
    execute?: boolean;
    actorId?: string;
    actorName?: string;
    migrationId?: string;
    batchSize?: number;
    onBeforeCommitBatch?: (batchIndex: number, batchUids: string[]) => Promise<void> | void;
  } = {},
) {
  const snap = await db.collection("appUsers").get();
  const docs = snap.docs
    .map((d) => ({ uid: d.id, doc: d.data() as AppUserRoleDoc }))
    .sort((a, b) => a.uid.localeCompare(b.uid));
  const summary = summariseConsolidation(docs);
  const migrationId = opts.migrationId || `role-consolidation-${new Date().toISOString().slice(0, 10)}`;
  const actorId = opts.actorId || "system:role-consolidation";
  const actorName = opts.actorName || "Role consolidation migration";
  const maxAccountsPerBatch = Math.min(Math.max(opts.batchSize || 200, 1), 200);
  const changed: { uid: string; retired: string[]; grantsClubAdmin: boolean }[] = [];

  if (opts.execute) {
    const runRef = db.collection("migrationRuns").doc(migrationId);
    const runSnap = await runRef.get();
    const prevBatches = runSnap.exists ? Number(runSnap.get("batchesCommitted") || 0) : 0;
    const prevMigratedCount = runSnap.exists ? Number(runSnap.get("migratedCount") || 0) : 0;

    await runRef.set(
      {
        migrationId,
        status: "in_progress",
        actorId,
        actorName,
        batchesCommitted: prevBatches,
        migratedCount: prevMigratedCount,
        lastError: null,
        startedAt: runSnap.exists ? runSnap.get("startedAt") || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const pendingPlans = docs
      .map(({ uid, doc }) => ({ uid, doc, plan: planRoleConsolidation(doc) }))
      .filter((x) => x.plan.needsChange);

    let batchesCommitted = prevBatches;
    let migratedCount = prevMigratedCount;

    try {
      for (let i = 0; i < pendingPlans.length; i += maxAccountsPerBatch) {
        const chunk = pendingPlans.slice(i, i + maxAccountsPerBatch);
        const batchIndex = batchesCommitted + 1;
        if (opts.onBeforeCommitBatch) {
          await opts.onBeforeCommitBatch(
            batchIndex,
            chunk.map((c) => c.uid),
          );
        }

        const batch = db.batch();
        const batchChanged: { uid: string; retired: string[]; grantsClubAdmin: boolean }[] = [];

        for (const { uid, doc, plan } of chunk) {
          const update: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(plan.update)) update[k] = v === null ? FieldValue.delete() : v;
          update.roleMigration = {
            migrationId,
            from: Object.fromEntries(
              ["isMatchAdmin", "isStudioAdmin", "isDesigner", "canDesign", "role", "isClubAdmin", "isFinanceAdmin"]
                .filter((k) => (doc as any)[k] !== undefined)
                .map((k) => [k, (doc as any)[k]]),
            ),
            migratedAt: FieldValue.serverTimestamp(),
          };
          update.rolesUpdatedAt = FieldValue.serverTimestamp();
          update.rolesUpdatedBy = actorId;
          batch.update(db.collection("appUsers").doc(uid), update);
          await writeServerAudit(
            db,
            {
              actorId,
              actorName,
              actorType: "system",
              action: "status_change",
              entity: "access",
              entityId: uid,
              entityLabel: String((doc as any).name || (doc as any).email || uid),
              changes: [
                {
                  field: "roles",
                  oldValue:
                    plan.retired.map((r) => ({ matchAdmin: "Match Admin", studioAdmin: "Studio Admin", designer: "Designer" })[r]).join(", ") +
                    (plan.alreadyClubAdmin ? " (already Club Admin)" : ""),
                  newValue: "Club Admin" + (plan.preservesFinanceAdmin ? ", Finance Admin" : ""),
                },
              ],
              summary: `${migrationId}: retired role(s) ${plan.retired.join(", ")} consolidated into Club Admin${plan.grantsClubAdmin ? "" : " (already held)"}.`,
              id: `role_consolidation_${migrationId}_${uid}`,
            },
            batch,
          );
          batchChanged.push({ uid, retired: plan.retired, grantsClubAdmin: plan.grantsClubAdmin });
        }

        await batch.commit();
        changed.push(...batchChanged);
        batchesCommitted += 1;
        migratedCount += batchChanged.length;

        await runRef.set(
          {
            batchesCommitted,
            migratedCount,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      await runRef.set(
        {
          status: "completed",
          batchesCommitted,
          migratedCount,
          lastError: null,
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Batch commit failed";
      await runRef.set(
        {
          status: "failed",
          batchesCommitted,
          migratedCount,
          lastError: errMsg.slice(0, 300),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      throw err;
    }
  }
  return { migrationId, executed: Boolean(opts.execute), summary, changed };
}
