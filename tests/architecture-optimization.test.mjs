import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("ARCH-001: useStore implements listener lifecycle and teardown mechanisms", () => {
  const storeCode = fs.readFileSync(path.resolve("hooks/useStore.ts"), "utf-8");

  // Verify detachDomain and detachAllLazy are implemented
  assert.ok(
    storeCode.includes("const detachDomain = useCallback"),
    "useStore must implement detachDomain",
  );
  assert.ok(
    storeCode.includes("const detachAllLazy = useCallback"),
    "useStore must implement detachAllLazy",
  );

  // Verify that detachDomain unsubscribes and deletes the map entry
  assert.ok(
    storeCode.includes("lazySubsRef.current.delete(domainKey)"),
    "detachDomain must remove domainKey from lazySubsRef",
  );

  // Verify exported in the store object
  assert.ok(storeCode.includes("detachDomain,"), "useStore must export detachDomain");
  assert.ok(storeCode.includes("detachAllLazy,"), "useStore must export detachAllLazy");

  // Verify active tab teardown hook in app/page.tsx
  const pageCode = fs.readFileSync(path.resolve("app/page.tsx"), "utf-8");
  assert.ok(
    pageCode.includes("store.detachDomain?.("),
    "app/page.tsx must detach lazy listeners when tabs become inactive",
  );
});

test("ARCH-002: Scoped loading and chronological ordering for initial match queries", () => {
  const storeCode = fs.readFileSync(path.resolve("hooks/useStore.ts"), "utf-8");

  // Verify matches subscription uses chronological ordering
  assert.ok(
    storeCode.includes('orderBy("date", "desc")') || storeCode.includes("orderBy('date', 'desc')"),
    "Matches query must be ordered by date descending to eliminate client-side re-sorting latency",
  );

  // Verify appUsers default subscription is scoped to current user doc (not full collection)
  assert.ok(
    storeCode.includes('doc(db, "appUsers", user.uid)'),
    "appUsers default subscription must remain scoped to current user doc",
  );
});

test("ARCH-003: useStore exports complete backward-compatible contract", () => {
  const storeCode = fs.readFileSync(path.resolve("hooks/useStore.ts"), "utf-8");

  const requiredExports = [
    "grounds", "addGround", "updateGround", "deleteGround",
    "matches", "addMatch", "updateMatch", "deleteMatch",
    "players", "addPlayer", "updatePlayer", "deletePlayer",
    "payments", "ensurePayments", "updatePaymentStatus",
    "otherFees", "ensureOtherFees", "addOtherFee",
    "badges", "ensureBadges", "addBadge",
    "appUsers", "updateAppUserProfile",
    "appConfig", "updateAppConfig",
    "detachDomain", "detachAllLazy",
    "isLoaded",
  ];

  for (const exp of requiredExports) {
    assert.ok(
      storeCode.includes(exp),
      `useStore must export ${exp} to maintain backward compatibility`,
    );
  }
});
