/**
 * Access Control Centre API (`/api/admin/access`) — D-22. SUPER ADMIN ONLY.
 *
 * GET  ?view=overview                         role cards (counts) + migration dry-run summary
 * GET  ?view=directory&q=&filter=&page=       paginated, server-searched user directory
 * GET  ?view=history                          access-change history (auditLogs, entity "access")
 * POST { uid, roles: ActiveRole[], expected }  grant / revoke roles for one account
 *
 * The caller's Super Admin authority is verified server-side (ID token + claim,
 * requireSuperAdmin). Roles are validated against the active allowlist
 * (superAdmin | clubAdmin | financeAdmin); retired roles are rejected. This is
 * the ONLY role writer in the app (firestore.rules make role keys server-only).
 */
import { NextResponse } from "next/server.js";
import { getAuth } from "firebase-admin/auth";
import { ensureAdminApp, getServerFirestore, requireSuperAdmin } from "../../../../lib/server-auth.ts";
import { actorNameFor } from "../../../../lib/server-audit.ts";
import { ACTIVE_ROLES, ROLE_DEFINITIONS, isActiveRole, summariseConsolidation, type ActiveRole, type AppUserRoleDoc } from "../../../../lib/role-consolidation.ts";
import { AccessError, accessHistory, listPendingRoleTransitions, loadDirectory, queryDirectory, reconcileRoleTransition, roleCounts, setAccountRoles, type DirectoryFilter } from "../../../../lib/access-control-server.ts";

const FILTERS: DirectoryFilter[] = ["all", "superAdmin", "clubAdmin", "financeAdmin", "multiple", "none"];
const authFor = () => getAuth(ensureAdminApp());

export async function GET(req: Request) {
  const guard = await requireSuperAdmin(req);
  if (!guard.ok) return guard.response;
  const url = new URL(req.url);
  const view = url.searchParams.get("view") || "overview";
  const db = getServerFirestore();
  try {
    if (view === "history") return NextResponse.json({ items: await accessHistory(db) });
    if (view === "overview") {
      const [dir, users, pendingTransitions] = await Promise.all([
        loadDirectory(db, authFor()),
        db.collection("appUsers").get(),
        listPendingRoleTransitions(db),
      ]);
      const migration = summariseConsolidation(users.docs.map((d) => ({ uid: d.id, doc: d.data() as AppUserRoleDoc })));
      return NextResponse.json({
        roles: ACTIVE_ROLES.map((id) => ({ ...ROLE_DEFINITIONS[id], count: roleCounts(dir.rows)[id] })),
        totalAccounts: dir.rows.filter((r) => r.uid).length,
        migration,
        pendingTransitions,
      });
    }
    if (view === "directory") {
      const filter = (url.searchParams.get("filter") || "all") as DirectoryFilter;
      if (!FILTERS.includes(filter)) return NextResponse.json({ error: "Unknown filter." }, { status: 400 });
      const q = (url.searchParams.get("q") || "").slice(0, 100);
      const page = Number(url.searchParams.get("page")) || 1;
      const dir = await loadDirectory(db, authFor());
      return NextResponse.json(queryDirectory(dir, { q, filter, page, pageSize: 25 }));
    }
    return NextResponse.json({ error: "Unknown view." }, { status: 400 });
  } catch {
    console.error("[access] read failed");
    return NextResponse.json({ error: "Could not load access data." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const guard = await requireSuperAdmin(req);
  if (!guard.ok) return guard.response;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const db = getServerFirestore();
  if (body?.action === "reconcile") {
    const transitionId = typeof body?.transitionId === "string" ? body.transitionId.trim() : "";
    if (!transitionId || transitionId.length > 128 || transitionId.includes("/")) {
      return NextResponse.json({ error: "Invalid transitionId." }, { status: 400 });
    }
    try {
      const result = await reconcileRoleTransition(db, authFor(), {
        transitionId,
        actorUid: guard.uid,
        actorName: await actorNameFor(db, guard.uid),
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof AccessError) return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
      console.error("[access] reconcile failed");
      return NextResponse.json({ error: "Could not reconcile role transition." }, { status: 500 });
    }
  }
  const uid = body?.uid;
  if (typeof uid !== "string" || !uid || uid.length > 128 || uid.includes("/")) return NextResponse.json({ error: "Invalid account." }, { status: 400 });
  const list = (v: unknown): ActiveRole[] | null =>
    Array.isArray(v) && v.length <= ACTIVE_ROLES.length && v.every(isActiveRole) ? [...new Set(v as ActiveRole[])] : null;
  const roles = list(body?.roles);
  const expected = list(body?.expected);
  if (!roles || !expected) {
    return NextResponse.json({ error: `Roles must be from: ${ACTIVE_ROLES.join(", ")}. Match Admin, Studio Admin and Designer are retired.` }, { status: 400 });
  }
  const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : undefined;
  try {
    const result = await setAccountRoles(db, authFor(), { actorUid: guard.uid, actorName: await actorNameFor(db, guard.uid), uid, roles, expected, idempotencyKey });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
    console.error("[access] role change failed");
    return NextResponse.json({ error: "Could not save the change. Nothing was changed; try again." }, { status: 500 });
  }
}
