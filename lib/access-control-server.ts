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

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Grant / revoke roles for one account. Super Admin only (checked by the route).
 * - Only active roles; never the caller's own account.
 * - `expected` must match the current roles (optimistic concurrency → 409).
 * - The last active Super Admin can't be removed: a server-only lock document
 *   serialises Super Admin changes and its list is cross-checked with Auth.
 */
export async function setAccountRoles(
  db: Firestore,
  auth: Auth,
  args: { actorUid: string; actorName: string; uid: string; roles: ActiveRole[]; expected: ActiveRole[] },
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
  if (!sameSet(current, args.expected)) {
    throw new AccessError(409, "This user's access changed since you opened it. Review the current roles and try again.", { current });
  }
  const { grant, revoke, changed } = diffRoles(current, next);
  if (!changed) return { changed: false, roles: current };
  if (grant.length && doc.status === "Disabled") throw new AccessError(400, "This account is disabled. Re-enable it before granting roles.");

  const superChange = grant.includes("superAdmin") ? "grant" : revoke.includes("superAdmin") ? "revoke" : null;
  const lockRef = db.collection(SUPER_ADMIN_LOCK.collection).doc(SUPER_ADMIN_LOCK.doc);

  await db.runTransaction(async (tx: Transaction) => {
    const [fresh, lock] = await Promise.all([tx.get(userRef), superChange ? tx.get(lockRef) : Promise.resolve(null)]);
    const freshDoc = (fresh.data() || {}) as AppUserRoleDoc;
    if (!sameSet(activeRolesOf(freshDoc, hasSuper), current)) throw new AccessError(409, "This user's access changed since you opened it.");
    if (superChange) {
      // Authoritative list: the lock document, seeded from Auth on first use.
      let list: string[] = Array.isArray(lock!.get("uids")) ? lock!.get("uids") : [];
      if (!lock!.exists) {
        const all = await db.collection("appUsers").select().get();
        list = [...(await superAdminUids(auth, all.docs.map((d) => d.id)))];
      }
      const after = superChange === "grant" ? [...new Set([...list, uid])] : list.filter((x) => x !== uid);
      if (superChange === "revoke") {
        // Cross-check with Auth: at least one other active Super Admin must remain.
        const others = (await superAdminUids(auth, list.filter((x) => x !== uid))).size;
        if (after.length < 1 || others < 1) throw new AccessError(409, "This is the last active Super Admin. Grant Super Admin to someone else first.");
      }
      tx.set(lockRef, { uids: after, updatedAt: FieldValue.serverTimestamp(), updatedBy: actorUid });
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
    const label = (rs: readonly ActiveRole[]) => (rs.length ? rs.map(roleLabel).join(", ") : "No admin role");
    await writeServerAudit(
      db,
      {
        actorId: actorUid,
        actorName,
        action: "updated",
        entity: "access",
        entityId: uid,
        entityLabel: String(doc.name || doc.email || uid),
        changes: [{ field: "roles", oldValue: label(current), newValue: label(next) }],
        summary: [...grant.map((r) => `Granted ${roleLabel(r)}`), ...revoke.map((r) => `Revoked ${roleLabel(r)}`)].join("; "),
      },
      tx,
    );
  });

  if (superChange) {
    // Applied after the guarded commit; idempotent.
    const claims = { ...(authUser.customClaims || {}) } as Record<string, unknown>;
    if (superChange === "grant") claims.admin = true;
    else delete claims.admin;
    await auth.setCustomUserClaims(uid, claims);
    // Revocation: end existing sessions now (server routes reject revoked tokens, R1).
    if (superChange === "revoke") await auth.revokeRefreshTokens(uid);
  }
  return { changed: true, roles: next, grant, revoke };
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
 * Dry run by default. Idempotent; never touches claims, UID or playerId; keeps
 * the original values in appUsers.roleMigration and writes one audit entry per
 * changed account.
 */
export async function runRoleConsolidation(db: Firestore, opts: { execute?: boolean; actorId?: string; actorName?: string; migrationId?: string } = {}) {
  const snap = await db.collection("appUsers").get();
  const docs = snap.docs.map((d) => ({ uid: d.id, doc: d.data() as AppUserRoleDoc }));
  const summary = summariseConsolidation(docs);
  const migrationId = opts.migrationId || `role-consolidation-${new Date().toISOString().slice(0, 10)}`;
  const changed: { uid: string; retired: string[]; grantsClubAdmin: boolean }[] = [];
  if (opts.execute) {
    let batch = db.batch();
    let n = 0;
    for (const { uid, doc } of docs) {
      const plan = planRoleConsolidation(doc);
      if (!plan.needsChange) continue;
      const update: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(plan.update)) update[k] = v === null ? FieldValue.delete() : v;
      update.roleMigration = {
        migrationId,
        from: Object.fromEntries(["isMatchAdmin", "isStudioAdmin", "isDesigner", "canDesign", "role", "isClubAdmin", "isFinanceAdmin"].filter((k) => (doc as any)[k] !== undefined).map((k) => [k, (doc as any)[k]])),
        migratedAt: FieldValue.serverTimestamp(),
      };
      update.rolesUpdatedAt = FieldValue.serverTimestamp();
      update.rolesUpdatedBy = opts.actorId || "migration";
      batch.update(db.collection("appUsers").doc(uid), update);
      await writeServerAudit(
        db,
        {
          actorId: opts.actorId || "migration",
          actorName: opts.actorName || "Role consolidation migration",
          action: "status_change",
          entity: "access",
          entityId: uid,
          entityLabel: String((doc as any).name || (doc as any).email || uid),
          changes: [{ field: "roles", oldValue: plan.retired.map((r) => ({ matchAdmin: "Match Admin", studioAdmin: "Studio Admin", designer: "Designer" })[r]).join(", ") + (plan.alreadyClubAdmin ? " (already Club Admin)" : ""), newValue: "Club Admin" + (plan.preservesFinanceAdmin ? ", Finance Admin" : "") }],
          summary: `${migrationId}: retired role(s) ${plan.retired.join(", ")} consolidated into Club Admin${plan.grantsClubAdmin ? "" : " (already held)"}.`,
        },
        batch,
      );
      changed.push({ uid, retired: plan.retired, grantsClubAdmin: plan.grantsClubAdmin });
      n += 2;
      if (n >= 400) {
        await batch.commit();
        batch = db.batch();
        n = 0;
      }
    }
    if (n > 0) await batch.commit();
  }
  return { migrationId, executed: Boolean(opts.execute), summary, changed };
}
