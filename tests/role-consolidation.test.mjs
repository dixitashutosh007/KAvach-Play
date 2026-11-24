/**
 * D-22 role consolidation (`tests/role-consolidation.test.mjs`). Imports the
 * PRODUCTION module lib/role-consolidation.ts; plus source checks that the
 * retired flags no longer authorise anything. No emulator, browser or network.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as r from "../lib/role-consolidation.ts";

const plan = (doc) => r.planRoleConsolidation(doc);

describe("active role model", () => {
  it("is exactly Super Admin, Club Admin, Finance Admin", () => {
    assert.deepEqual([...r.ACTIVE_ROLES], ["superAdmin", "clubAdmin", "financeAdmin"]);
    for (const retired of ["matchAdmin", "studioAdmin", "designer", "isDesigner"]) assert.equal(r.isActiveRole(retired), false);
  });
  it("derives active roles only from the claim and the active flags", () => {
    assert.deepEqual(r.activeRolesOf({ isMatchAdmin: true, isStudioAdmin: true, isDesigner: true, canDesign: true, role: "matchAdmin" }), []);
    assert.deepEqual(r.activeRolesOf({ isClubAdmin: true, isFinanceAdmin: true }, true), ["superAdmin", "clubAdmin", "financeAdmin"]);
    assert.deepEqual(r.activeRolesOf({ role: "admin" }), []); // SEC-001: role=="admin" is not an authority
  });
  it("diffRoles lists grants and revokes", () => {
    assert.deepEqual(r.diffRoles(["clubAdmin"], ["clubAdmin", "financeAdmin"]), { grant: ["financeAdmin"], revoke: [], changed: true });
    assert.deepEqual(r.diffRoles(["superAdmin", "clubAdmin"], ["clubAdmin"]), { grant: [], revoke: ["superAdmin"], changed: true });
    assert.equal(r.diffRoles(["clubAdmin"], ["clubAdmin"]).changed, false);
  });
});

describe("migration mapping", () => {
  it("Match Admin → Club Admin; retired flag removed", () => {
    const p = plan({ isMatchAdmin: true, playerId: "p1" });
    assert.deepEqual(p.retired, ["matchAdmin"]);
    assert.equal(p.grantsClubAdmin, true);
    assert.deepEqual(p.update, { isMatchAdmin: null, isClubAdmin: true });
  });
  it("Studio Admin → Club Admin", () => {
    assert.deepEqual(plan({ isStudioAdmin: true, playerId: "p" }).update, { isStudioAdmin: null, isClubAdmin: true });
  });
  it("Designer (isDesigner / canDesign / role) → Club Admin", () => {
    assert.deepEqual(plan({ isDesigner: true, playerId: "p" }).update, { isDesigner: null, isClubAdmin: true });
    assert.deepEqual(plan({ canDesign: true, playerId: "p" }).update, { canDesign: null, isClubAdmin: true });
    assert.deepEqual(plan({ role: "designer", playerId: "p" }).update, { role: "clubAdmin", isClubAdmin: true });
  });
  it("any combination of retired roles gives Club Admin once", () => {
    const p = plan({ isMatchAdmin: true, isStudioAdmin: true, isDesigner: true, playerId: "p" });
    assert.deepEqual(p.retired.sort(), ["designer", "matchAdmin", "studioAdmin"]);
    assert.equal(p.update.isClubAdmin, true);
    assert.equal(Object.values(p.update).filter((v) => v === true).length, 1);
  });
  it("Match Admin + Finance Admin → Club Admin + Finance Admin (Finance untouched)", () => {
    const p = plan({ isMatchAdmin: true, isFinanceAdmin: true, playerId: "p" });
    assert.equal(p.preservesFinanceAdmin, true);
    assert.equal("isFinanceAdmin" in p.update, false);
    assert.equal(p.update.isClubAdmin, true);
  });
  it("existing Club Admin stays; only retired flags are cleaned", () => {
    const p = plan({ isClubAdmin: true, isStudioAdmin: true, playerId: "p" });
    assert.equal(p.grantsClubAdmin, false);
    assert.equal(p.alreadyClubAdmin, true);
    assert.deepEqual(p.update, { isStudioAdmin: null });
  });
  it("is idempotent: a consolidated account needs no change; Super Admin and other fields never touched", () => {
    const once = { isMatchAdmin: true, playerId: "p", role: "player", isFinanceAdmin: true, name: "A" };
    const after = { ...once, ...plan(once).update };
    for (const [k, v] of Object.entries(after)) if (v === null) delete after[k];
    assert.equal(plan(after).needsChange, false);
    for (const k of ["playerId", "name", "isSuperAdmin", "uid"]) assert.equal(k in plan(once).update, false);
    assert.equal(plan({ isClubAdmin: true, isFinanceAdmin: true, playerId: "p" }).needsChange, false);
    assert.equal(plan({ playerId: "p" }).needsChange, false);
  });
  it("flags disabled, unlinked and unknown-role accounts for review", () => {
    assert.deepEqual(plan({ isMatchAdmin: true, status: "Disabled", playerId: "p" }).flags, ["disabled"]);
    assert.deepEqual(plan({ isStudioAdmin: true }).flags, ["unlinked"]);
    assert.deepEqual(plan({ isDesigner: true, playerId: "p", role: "captain" }).flags, ["unknown_role"]);
  });
  it("dry-run summary counts", () => {
    const s = r.summariseConsolidation([
      { uid: "a", doc: { isMatchAdmin: true, playerId: "1" } },
      { uid: "b", doc: { isStudioAdmin: true, isMatchAdmin: true, playerId: "2" } },
      { uid: "c", doc: { isDesigner: true, isFinanceAdmin: true, playerId: "3" } },
      { uid: "d", doc: { isClubAdmin: true, isStudioAdmin: true, playerId: "4" } },
      { uid: "e", doc: { isFinanceAdmin: true, playerId: "5" } },
      { uid: "f", doc: { isMatchAdmin: true } },
    ]);
    assert.deepEqual(
      { m: s.matchAdmin, st: s.studioAdmin, d: s.designer, multi: s.multipleRetired, club: s.receiveClubAdmin, already: s.alreadyClubAdmin, fin: s.financePreserved, changes: s.changes },
      { m: 3, st: 2, d: 1, multi: 1, club: 4, already: 1, fin: 1, changes: 5 },
    );
    assert.deepEqual(s.flagged, [{ uid: "f", flags: ["unlinked"], retired: ["matchAdmin"] }]);
  });
});

describe("retired roles no longer authorise (source)", () => {
  const src = (f) => fs.readFileSync(f, "utf-8");
  it("server: Club Admin aliases come only from isClubAdmin / role clubAdmin", () => {
    const s = src("lib/server-auth.ts");
    assert.doesNotMatch(s, /data\.isMatchAdmin|data\.isStudioAdmin|data\.isDesigner|data\.canDesign|role === "matchAdmin"|role === "studioAdmin"|role === "designer"/);
    assert.match(s, /if \(data\.isClubAdmin === true \|\| data\.role === "clubAdmin"\) addClubAdmin\(roles\);/);
    assert.match(s, /export async function requireStudioAdmin[\s\S]*?requireRole\(req, \["clubAdmin", "superAdmin"\]\)/);
  });
  it("rules: retired helpers are Club Admin; isAnyAdmin ignores retired flags; role keys are server-only", () => {
    const s = src("firestore.rules");
    assert.match(s, /function isStudioAdmin\(\) \{\s*return isClubAdmin\(\);/);
    assert.match(s, /function isMatchAdmin\(\) \{\s*return isClubAdmin\(\);/);
    assert.doesNotMatch(s, /getUserData\(\)\.get\('(isStudioAdmin|isMatchAdmin|isDesigner|canDesign)'/);
    assert.match(s, /allow update: if !incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasAny\(\['playerId'\]\)\s*&& !incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasAny\(roleKeys\(\)\)/);
  });
  it("client: no component writes role flags; the Access Control API is the only writer", () => {
    for (const f of ["components/EditPlayerInline.tsx", "components/SettingsTab.tsx", "hooks/useStore.ts"]) {
      assert.doesNotMatch(src(f), /updateAppUserProfile\([^)]*\{\s*(isClubAdmin|isFinanceAdmin|isMatchAdmin|isStudioAdmin|isDesigner)\s*:/, f);
      assert.doesNotMatch(src(f), /updateAppUserRole/, f);
    }
    assert.doesNotMatch(src("hooks/useStore.ts"), /updateDoc\(userDoc, \{ role: "admin" \}\)/);
    assert.match(src("app/api/admin/access/route.ts"), /const guard = await requireSuperAdmin\(req\);/);
  });
});
