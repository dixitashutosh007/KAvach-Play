/**
 * Admin role model (D-22, owner decision 2026-11-24) — single definition shared
 * by the server, the Access Control Centre, the migration and the tests. Pure.
 *
 * Active roles are exactly: Super Admin, Club Admin, Finance Admin.
 *   - Super Admin: the Firebase Auth custom claim `admin: true` (SEC-001).
 *   - Club Admin:  appUsers.isClubAdmin (absorbs Match Admin, Studio Admin, Designer).
 *   - Finance Admin: appUsers.isFinanceAdmin.
 * Retired: Match Admin, Studio Admin, Designer. Their flags no longer grant
 * anything; the migration converts them to Club Admin.
 */

export type ActiveRole = "superAdmin" | "clubAdmin" | "financeAdmin";
export const ACTIVE_ROLES: readonly ActiveRole[] = ["superAdmin", "clubAdmin", "financeAdmin"];

export interface RoleDefinition {
  id: ActiveRole;
  label: string;
  summary: string;
  capabilities: string[];
}

export const ROLE_DEFINITIONS: Readonly<Record<ActiveRole, RoleDefinition>> = {
  superAdmin: {
    id: "superAdmin",
    label: "Super Admin",
    summary: "Complete administrative access, including Access Control and Settings.",
    capabilities: [
      "Access Control Centre — grant and revoke roles",
      "Settings and platform configuration",
      "Everything a Club Admin and a Finance Admin can do",
    ],
  },
  clubAdmin: {
    id: "clubAdmin",
    label: "Club Admin",
    summary: "Matches, squad, Studio, Design Studio and club operations.",
    capabilities: [
      "Match Center — matches, grounds, tournaments, results",
      "Squad, availability, catches, No Show, player stats",
      "Studio memberships and reminders",
      "Design Studio",
      "Roster, invitations, announcements, Pulse, badges, shop",
    ],
  },
  financeAdmin: {
    id: "financeAdmin",
    label: "Finance Admin",
    summary: "Finance dashboard, payments, reconciliation and reports.",
    capabilities: [
      "Finance dashboard and reports",
      "Payments, plans and reminders",
      "Reconciliation",
      "Actual ground / vendor fee entry",
    ],
  },
};

export function isActiveRole(v: unknown): v is ActiveRole {
  return typeof v === "string" && (ACTIVE_ROLES as readonly string[]).includes(v);
}

/** appUsers fields that carry roles. All are server-written only (firestore.rules). */
export const ROLE_FLAG_FIELDS = ["isClubAdmin", "isFinanceAdmin"] as const;
/** Retired role fields: never an authority; removed by the migration. */
export const RETIRED_ROLE_FIELDS = ["isMatchAdmin", "isStudioAdmin", "isDesigner", "canDesign"] as const;
/** Retired `role` strings, mapped to Club Admin by the migration. */
export const RETIRED_ROLE_STRINGS = ["matchAdmin", "studioAdmin", "designer"] as const;
const KNOWN_ROLE_STRINGS = ["player", "admin", "clubAdmin", "financeAdmin", ...RETIRED_ROLE_STRINGS];

export interface AppUserRoleDoc {
  role?: unknown;
  status?: unknown;
  playerId?: unknown;
  isClubAdmin?: unknown;
  isFinanceAdmin?: unknown;
  isMatchAdmin?: unknown;
  isStudioAdmin?: unknown;
  isDesigner?: unknown;
  canDesign?: unknown;
}

/** Active roles held through appUsers (Super Admin comes from the claim, passed in). */
export function activeRolesOf(doc: AppUserRoleDoc | null | undefined, hasSuperClaim = false): ActiveRole[] {
  const out: ActiveRole[] = [];
  if (hasSuperClaim) out.push("superAdmin");
  if (doc?.isClubAdmin === true || doc?.role === "clubAdmin") out.push("clubAdmin");
  if (doc?.isFinanceAdmin === true || doc?.role === "financeAdmin") out.push("financeAdmin");
  return out;
}

export interface ConsolidationPlan {
  /** Retired roles found (for the report and the audit trail). */
  retired: ("matchAdmin" | "studioAdmin" | "designer")[];
  needsChange: boolean;
  grantsClubAdmin: boolean;
  alreadyClubAdmin: boolean;
  preservesFinanceAdmin: boolean;
  /** Field updates to apply (null = delete the field). */
  update: Record<string, unknown>;
  flags: ("disabled" | "unlinked" | "unknown_role")[];
}

/**
 * Migration decision for one appUsers document. Idempotent: a document with no
 * retired fields needs no change. Never touches Super Admin (claims), UID,
 * playerId or any non-role field.
 */
export function planRoleConsolidation(doc: AppUserRoleDoc): ConsolidationPlan {
  const retired = new Set<"matchAdmin" | "studioAdmin" | "designer">();
  if (doc.isMatchAdmin === true || doc.role === "matchAdmin") retired.add("matchAdmin");
  if (doc.isStudioAdmin === true || doc.role === "studioAdmin") retired.add("studioAdmin");
  if (doc.isDesigner === true || doc.canDesign === true || doc.role === "designer") retired.add("designer");

  const update: Record<string, unknown> = {};
  for (const f of RETIRED_ROLE_FIELDS) if (f in doc && doc[f] !== undefined) update[f] = null;
  const retiredRoleString = (RETIRED_ROLE_STRINGS as readonly string[]).includes(String(doc.role));
  if (retiredRoleString) update.role = "clubAdmin";

  const alreadyClubAdmin = doc.isClubAdmin === true || doc.role === "clubAdmin";
  const grantsClubAdmin = retired.size > 0 && !alreadyClubAdmin;
  if (retired.size > 0 && doc.isClubAdmin !== true) update.isClubAdmin = true;

  const flags: ConsolidationPlan["flags"] = [];
  if (doc.status === "Disabled") flags.push("disabled");
  if (!doc.playerId) flags.push("unlinked");
  if (doc.role !== undefined && doc.role !== null && !KNOWN_ROLE_STRINGS.includes(String(doc.role))) flags.push("unknown_role");

  return {
    retired: [...retired],
    needsChange: Object.keys(update).length > 0,
    grantsClubAdmin,
    alreadyClubAdmin,
    preservesFinanceAdmin: doc.isFinanceAdmin === true,
    update,
    flags,
  };
}

export interface ConsolidationSummary {
  scanned: number;
  matchAdmin: number;
  studioAdmin: number;
  designer: number;
  multipleRetired: number;
  receiveClubAdmin: number;
  alreadyClubAdmin: number;
  financePreserved: number;
  changes: number;
  flagged: { uid: string; flags: string[]; retired: string[] }[];
}

export function summariseConsolidation(docs: { uid: string; doc: AppUserRoleDoc }[]): ConsolidationSummary {
  const s: ConsolidationSummary = { scanned: docs.length, matchAdmin: 0, studioAdmin: 0, designer: 0, multipleRetired: 0, receiveClubAdmin: 0, alreadyClubAdmin: 0, financePreserved: 0, changes: 0, flagged: [] };
  for (const { uid, doc } of docs) {
    const p = planRoleConsolidation(doc);
    if (p.retired.includes("matchAdmin")) s.matchAdmin++;
    if (p.retired.includes("studioAdmin")) s.studioAdmin++;
    if (p.retired.includes("designer")) s.designer++;
    if (p.retired.length > 1) s.multipleRetired++;
    if (p.grantsClubAdmin) s.receiveClubAdmin++;
    if (p.retired.length > 0 && p.alreadyClubAdmin) s.alreadyClubAdmin++;
    if (p.retired.length > 0 && p.preservesFinanceAdmin) s.financePreserved++;
    if (p.needsChange) s.changes++;
    if (p.retired.length > 0 && p.flags.length > 0) s.flagged.push({ uid, flags: p.flags, retired: p.retired });
  }
  return s;
}

/** Role change requested in the Access Control Centre. */
export function diffRoles(current: readonly ActiveRole[], next: readonly ActiveRole[]) {
  const grant = ACTIVE_ROLES.filter((r) => next.includes(r) && !current.includes(r));
  const revoke = ACTIVE_ROLES.filter((r) => current.includes(r) && !next.includes(r));
  return { grant, revoke, changed: grant.length + revoke.length > 0 };
}

export const roleLabel = (r: ActiveRole) => ROLE_DEFINITIONS[r].label;
