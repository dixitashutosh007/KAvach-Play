/**
 * Firebase Auth + Firestore Emulator validation for Badges 2.0 Phase 2:
 * - Custom badgeType lifecycle (active default, archive, restore)
 * - Blocking new awards for archived badgeTypes while preserving historical awards
 * - Blocking hard-deletion of referenced badgeTypes (409) while allowing unreferenced deletion
 * - Protecting built-in catalogue definitions in POST/PATCH badgeType
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { initializeApp, getApps, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const ROOT = pathToFileURL(process.cwd() + "/").href;
register(
  "data:text/javascript," +
    encodeURIComponent(`
const ROOT = ${JSON.stringify(ROOT)};
export async function resolve(spec, ctx, next) {
  if (spec === "next/server") return next("next/server.js", ctx);
  if (spec.startsWith("@/")) spec = new URL(spec.slice(2) + (/\\.[a-z]+$/.test(spec) ? "" : ".ts"), ROOT).href;
  return next(spec, ctx);
}`),
  import.meta.url,
);

const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);

async function signInEmulatorUser(auth, uid) {
  try {
    await auth.createUser({ uid, email: `${uid}@kavach.test` });
  } catch {}
  const customToken = await auth.createCustomToken(uid);
  const res = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const data = await res.json();
  if (!res.ok || !data.idToken) throw new Error(`Token exchange failed for ${uid}`);
  return data.idToken;
}

describe("Badges Phase 2 (Firebase Auth + Firestore Emulator)", { skip: !hasEmulator ? "Emulator not running" : false }, () => {
  let app;
  let db;
  let auth;
  let badgesRoute;
  let adminToken;

  before(async () => {
    const projectId = process.env.GCLOUD_PROJECT || "demo-kavach-play";
    app = getApps().length ? getApps()[0] : initializeApp({ projectId });
    db = getFirestore(app);
    auth = getAuth(app);

    const { setServerDbForTesting } = await import("../lib/server-db.ts");
    setServerDbForTesting(db);

    badgesRoute = await import("../app/api/admin/badges/route.ts");

    await db.collection("appUsers").doc("p2-club-admin").set({
      uid: "p2-club-admin",
      name: "Phase2 Admin",
      status: "Active",
      isClubAdmin: true,
    });
    adminToken = await signInEmulatorUser(auth, "p2-club-admin");
  });

  after(async () => {
    if (app) await deleteApp(app);
  });

  const callBadges = (method, body, query = "") =>
    badgesRoute[method](
      new Request(`http://localhost/api/admin/badges${query}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );

  it("supports custom badge active/archive/restore lifecycle while preserving historical awards", async () => {
    // 1. Create custom badgeType without explicit active -> defaults to active: true
    const createType = await callBadges("POST", {
      target: "badgeType",
      badgeTypeDef: {
        id: "custom_fielding_mvp",
        label: "Fielding MVP",
        short: "Field MVP",
        tier: "gold",
        emoji: "🧤",
        stackable: false,
        category: "performance",
        description: "Outstanding fielding effort",
      },
      idempotencyKey: "p2_bt_create_1",
    });
    assert.equal(createType.status, 200);
    const typeDoc = (await db.collection("badgeTypes").doc("custom_fielding_mvp").get()).data();
    assert.equal(typeDoc.active, true);

    // 2. Award while active -> succeeds
    const award1 = await callBadges("POST", {
      target: "badge",
      badge: {
        id: "p2-hist-award-1",
        playerId: "p2-player-1",
        playerName: "Rahul",
        badgeType: "custom_fielding_mvp",
        note: "3 catches vs Royals",
      },
      idempotencyKey: "p2_award_1",
    });
    assert.equal(award1.status, 200);

    // 3. Hard-deleting referenced badgeType is blocked (409)
    const delReferenced = await callBadges("DELETE", undefined, "?target=badgeType&id=custom_fielding_mvp&idempotencyKey=p2_del_ref");
    assert.equal(delReferenced.status, 409);

    // 4. Archive badgeType (active: false)
    const archiveRes = await callBadges("PATCH", {
      target: "badgeType",
      id: "custom_fielding_mvp",
      updates: { active: false },
      idempotencyKey: "p2_archive_1",
    });
    assert.equal(archiveRes.status, 200);

    // 5. New award while archived is rejected (400), historical award remains intact
    const awardBlocked = await callBadges("POST", {
      target: "badge",
      badge: {
        id: "p2-award-blocked",
        playerId: "p2-player-2",
        playerName: "Virat",
        badgeType: "custom_fielding_mvp",
      },
      idempotencyKey: "p2_award_blocked",
    });
    assert.equal(awardBlocked.status, 400);

    const histSnap = await db.collection("badges").doc("p2-hist-award-1").get();
    assert.equal(histSnap.exists, true);
    assert.equal(histSnap.data().note, "3 catches vs Royals");

    // 6. Restore badgeType (active: true) -> new awards allowed again
    const restoreRes = await callBadges("PATCH", {
      target: "badgeType",
      id: "custom_fielding_mvp",
      updates: { active: true },
      idempotencyKey: "p2_restore_1",
    });
    assert.equal(restoreRes.status, 200);

    const awardAfterRestore = await callBadges("POST", {
      target: "badge",
      badge: {
        id: "p2-award-restored",
        playerId: "p2-player-2",
        playerName: "Virat",
        badgeType: "custom_fielding_mvp",
      },
      idempotencyKey: "p2_award_restored",
    });
    assert.equal(awardAfterRestore.status, 200);
  });

  it("allows deleting unreferenced custom badgeType and blocks built-in catalogue overrides", async () => {
    const createUnused = await callBadges("POST", {
      target: "badgeType",
      badgeTypeDef: { id: "unused_custom_type", label: "Unused", short: "Unused", tier: "bronze", emoji: "U" },
      idempotencyKey: "p2_unused_create",
    });
    assert.equal(createUnused.status, 200);

    const delUnused = await callBadges("DELETE", undefined, "?target=badgeType&id=unused_custom_type&idempotencyKey=p2_unused_del");
    assert.equal(delUnused.status, 200);

    const badBuiltin = await callBadges("POST", {
      target: "badgeType",
      badgeTypeDef: { id: "year_1", label: "1 Year", short: "1Y", tier: "bronze", emoji: "1", stackable: true },
      idempotencyKey: "p2_bad_builtin",
    });
    assert.equal(badBuiltin.status, 409);
  });

  it("enforces built-in metadata protection on PATCH and allows presentation-only updates on year_1", async () => {
    const seedYear1 = await callBadges("POST", {
      target: "badgeType",
      badgeTypeDef: {
        id: "year_1",
        label: "1 Year with KAvach",
        short: "1 Year",
        tier: "bronze",
        emoji: "1",
      },
      idempotencyKey: "p2r_seed_year1",
    });
    assert.equal(seedYear1.status, 200);

    const forbiddenPatches = [
      { active: false },
      { stackable: true },
      { awardMode: "manual" },
      { category: "custom" },
    ];
    for (const [idx, updates] of forbiddenPatches.entries()) {
      const res = await callBadges("PATCH", {
        target: "badgeType",
        id: "year_1",
        updates,
        idempotencyKey: `p2r_forbid_patch_${idx}`,
      });
      assert.equal(res.status, 409, `Expected 409 for forbidden PATCH ${JSON.stringify(updates)}`);

      const stored = (await db.collection("badgeTypes").doc("year_1").get()).data();
      assert.equal(stored.active, true);
      assert.equal(stored.stackable, false);
      assert.equal(stored.awardMode, "auto_tenure");
      assert.equal(stored.category, "tenure");
    }

    // Permitted presentation-field update succeeds without altering authoritative fields
    const okPatch = await callBadges("PATCH", {
      target: "badgeType",
      id: "year_1",
      updates: { description: "Updated 1-year club milestone" },
      idempotencyKey: "p2r_ok_patch_year1",
    });
    assert.equal(okPatch.status, 200);
    const updated = (await db.collection("badgeTypes").doc("year_1").get()).data();
    assert.equal(updated.description, "Updated 1-year club milestone");
    assert.equal(updated.active, true);
    assert.equal(updated.stackable, false);
    assert.equal(updated.awardMode, "auto_tenure");
    assert.equal(updated.category, "tenure");

    // POST built-in with conflicting awardMode or category is also rejected
    const badPostMode = await callBadges("POST", {
      target: "badgeType",
      badgeTypeDef: { id: "year_2", label: "2Y", short: "2Y", tier: "bronze", emoji: "2", awardMode: "manual" },
      idempotencyKey: "p2r_bad_post_mode",
    });
    assert.equal(badPostMode.status, 409);

    const badPostCat = await callBadges("POST", {
      target: "badgeType",
      badgeTypeDef: { id: "year_2", label: "2Y", short: "2Y", tier: "bronze", emoji: "2", category: "custom" },
      idempotencyKey: "p2r_bad_post_cat",
    });
    assert.equal(badPostCat.status, 409);
  });

  it("validates custom category and awardMode at the API boundary and blocks system_potw on custom definitions", async () => {
    const badCat = await callBadges("POST", {
      target: "badgeType",
      badgeTypeDef: { id: "cust_bad_cat", label: "Bad Cat", category: "not_a_category" },
      idempotencyKey: "p2r_bad_cat",
    });
    assert.equal(badCat.status, 400);

    const badMode = await callBadges("POST", {
      target: "badgeType",
      badgeTypeDef: { id: "cust_bad_mode", label: "Bad Mode", awardMode: "not_a_mode" },
      idempotencyKey: "p2r_bad_mode",
    });
    assert.equal(badMode.status, 400);

    const sysModePost = await callBadges("POST", {
      target: "badgeType",
      badgeTypeDef: { id: "cust_sys_mode", label: "Fake POTW", awardMode: "system_potw" },
      idempotencyKey: "p2r_sys_mode_post",
    });
    assert.equal(sysModePost.status, 400);

    // Create valid custom type, then verify invalid PATCHes are rejected
    const validCreate = await callBadges("POST", {
      target: "badgeType",
      badgeTypeDef: { id: "cust_valid_patch_chk", label: "Valid", category: "custom", awardMode: "manual" },
      idempotencyKey: "p2r_valid_create",
    });
    assert.equal(validCreate.status, 200);

    const patchBadCat = await callBadges("PATCH", {
      target: "badgeType",
      id: "cust_valid_patch_chk",
      updates: { category: "invalid" },
    });
    assert.equal(patchBadCat.status, 400);

    const patchSysMode = await callBadges("PATCH", {
      target: "badgeType",
      id: "cust_valid_patch_chk",
      updates: { awardMode: "system_potw" },
    });
    assert.equal(patchSysMode.status, 400);
  });

  it("serializes concurrent badge award vs badge-type deletion without leaving orphaned awards", async () => {
    for (let i = 0; i < 5; i++) {
      const typeId = `race_del_type_${i}`;
      const createRes = await callBadges("POST", {
        target: "badgeType",
        badgeTypeDef: { id: typeId, label: `Race Type ${i}`, short: `RT${i}`, tier: "silver", emoji: "R" },
        idempotencyKey: `race_del_create_${i}`,
      });
      assert.equal(createRes.status, 200);

      const [awardRes, deleteRes] = await Promise.all([
        callBadges("POST", {
          target: "badge",
          badge: {
            id: `race_del_award_${i}`,
            playerId: `race_del_player_${i}`,
            playerName: "Race Player",
            badgeType: typeId,
          },
          idempotencyKey: `race_del_award_key_${i}`,
        }),
        callBadges("DELETE", undefined, `?target=badgeType&id=${typeId}&idempotencyKey=race_del_del_key_${i}`),
      ]);

      const typeSnap = await db.collection("badgeTypes").doc(typeId).get();
      const awardsSnap = await db.collection("badges").where("badgeType", "==", typeId).get();

      if (awardsSnap.size > 0) {
        assert.equal(typeSnap.exists, true, `Iteration ${i}: award exists so badgeType must still exist`);
        assert.equal(awardRes.status, 200);
        assert.equal(deleteRes.status, 409);
      } else {
        assert.equal(typeSnap.exists, false, `Iteration ${i}: no award exists so badgeType deletion should have succeeded`);
        assert.equal(deleteRes.status, 200);
        assert.equal(awardRes.status, 400);
      }
    }
  });

  it("rejects non-boolean active and stackable values on POST and PATCH without coercion", async () => {
    const invalidBodies = [
      { active: "false" },
      { active: 0 },
      { stackable: "false" },
      { stackable: 1 },
    ];

    for (const [idx, invalidFields] of invalidBodies.entries()) {
      const postRes = await callBadges("POST", {
        target: "badgeType",
        badgeTypeDef: {
          id: `bad_bool_post_${idx}`,
          label: "Bad Bool",
          ...invalidFields,
        },
        idempotencyKey: `p2s_bad_bool_post_${idx}`,
      });
      assert.equal(postRes.status, 400, `Expected 400 on POST for ${JSON.stringify(invalidFields)}`);
      const postDoc = await db.collection("badgeTypes").doc(`bad_bool_post_${idx}`).get();
      assert.equal(postDoc.exists, false);
    }

    // Seed a valid custom definition (omitting active/stackable -> defaults true/false)
    const createValid = await callBadges("POST", {
      target: "badgeType",
      badgeTypeDef: { id: "bool_patch_target", label: "Bool Target" },
      idempotencyKey: "p2s_bool_seed",
    });
    assert.equal(createValid.status, 200);
    const beforeDoc = (await db.collection("badgeTypes").doc("bool_patch_target").get()).data();
    assert.equal(beforeDoc.active, true);
    assert.equal(beforeDoc.stackable, false);

    for (const [idx, invalidFields] of invalidBodies.entries()) {
      const patchRes = await callBadges("PATCH", {
        target: "badgeType",
        id: "bool_patch_target",
        updates: invalidFields,
        idempotencyKey: `p2s_bad_bool_patch_${idx}`,
      });
      assert.equal(patchRes.status, 400, `Expected 400 on PATCH for ${JSON.stringify(invalidFields)}`);

      const afterDoc = (await db.collection("badgeTypes").doc("bool_patch_target").get()).data();
      assert.equal(afterDoc.active, true);
      assert.equal(afterDoc.stackable, false);
    }
  });
});
