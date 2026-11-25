/**
 * D4 static checks on firestore.rules and the UI gates
 * (tests/finance-d4-rules-static.test.mjs). Source inspection only; the
 * behaviour is covered by finance-d4-payment-rules.emulator.test.mjs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const rules = fs.readFileSync("firestore.rules", "utf8");
const block = rules.slice(rules.indexOf("match /payments/{paymentId} {"), rules.indexOf("allow delete: if false; // Do not delete payments"));

describe("D4: payment fee fields are Finance / Super Admin only", () => {
  it("match admins no longer get blanket create/update on payments", () => {
    assert.ok(!/\(isMatchAdmin\(\) \|\| isFinanceAdmin\(\)\)/.test(block));
    assert.match(block, /allow create: if \(\s*isFinanceAdmin\(\) \|\|\s*\(isMatchAdmin\(\) && isMatchAdminPaymentCreate\(incoming\(\)\)\) \|\|/);
    assert.match(block, /allow update: if \(\s*isFinanceAdmin\(\) \|\|\s*\(isMatchAdmin\(\) && isMatchAdminPaymentUpdate\(matchId\)\) \|\|/);
  });
  it("match admin (Club Admin) updates: squad & availability only, no Paid or settlement fields", () => {
    const fn = rules.slice(rules.indexOf("function isMatchAdminPaymentUpdate"), rules.indexOf("function isValidMatchPayment"));
    assert.match(fn, /changed\.hasOnly\(\['status', 'availability', 'tacticalNote', 'availabilityNote', 'updatedAt'\]\)/);
    for (const k of ["'Paid'", "paymentMethod", "manualMethod", "manualBy", "feeCollectedAmount", "feeOverride'", "feeOffsetAmount", "planTag", "sponsoredBy", "financeSnapshot", "waived"]) {
      assert.ok(!fn.includes(k), `Club Admin update rule must not allow ${k}`);
    }
    assert.match(fn, /incoming\(\)\.status in \['Unpaid', 'Not Playing'\]/);
    assert.match(fn, /isPlanSettled\(existing\(\)\)\s*&& incoming\(\)\.status == 'Not Playing'/);
  });
  it("player self-service rules are unchanged", () => {
    assert.match(block, /incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasOnly\(\[\s*'availability',\s*'tacticalNote',\s*'availabilityNote',\s*'status',\s*'updatedAt'\s*\]\)/);
  });
  it("UI hides fee arrangements from Match Admins", () => {
    const rows = fs.readFileSync("lib/match-squad.ts", "utf8");
    assert.match(rows, /if \(ctx\.canManageFees && !share\.paid && !p\.sponsoredBy && !p\.sponsoring && !isGuest\) \{\s*actions\.push\(\{ id: "feePayer"/);
    assert.match(rows, /if \(ctx\.canManageFees && p\.sponsoredBy\) actions\.push\(\{ id: "undoFeePayer"/);
    const tab = fs.readFileSync("components/MatchesTab.tsx", "utf8");
    assert.match(tab, /canManageFees: canOverrideFees, canManageSquad: canApplyPlans/);
  });
});
