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
  it("match admin updates: allowlisted fields, no gateway / plan settlement, collected = recorded fee", () => {
    const fn = rules.slice(rules.indexOf("function isMatchAdminPaymentUpdate"), rules.indexOf("function isValidMatchPayment"));
    assert.match(fn, /changed\.hasOnly\(\['status', 'availability', 'tacticalNote', 'availabilityNote',\s*'paymentMethod', 'manualMethod', 'manualBy', 'feeCollectedAmount', 'updatedAt'\]\)/);
    for (const k of ["feeOverride'", "feeOffsetAmount", "planTag", "sponsoredBy", "financeSnapshot", "waived"]) {
      assert.ok(!fn.slice(0, fn.indexOf("incoming().status in")).includes(k), k);
    }
    assert.match(fn, /incoming\(\)\.get\('paymentMethod', 'manual'\) == 'manual'/);
    assert.match(fn, /in \['cash_collected', 'deposited_directly'\]/);
    assert.match(fn, /incoming\(\)\.feeCollectedAmount == existing\(\)\.get\('feeOverride',\s*get\(\/databases\/\$\(database\)\/documents\/matches\/\$\(matchId\)\)\.data\.fee\)/);
    assert.match(fn, /!isPlanSettled\(existing\(\)\) \|\| incoming\(\)\.status == existing\(\)\.status \|\| incoming\(\)\.status == 'Not Playing'/);
  });
  it("player self-service rules are unchanged", () => {
    assert.match(block, /incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasOnly\(\[\s*'availability',\s*'tacticalNote',\s*'availabilityNote',\s*'status',\s*'updatedAt'\s*\]\)/);
  });
  it("UI hides fee arrangements from Match Admins", () => {
    const tab = fs.readFileSync("components/MatchesTab.tsx", "utf8");
    assert.match(tab, /\{canOverrideFees && payment\.status === "Unpaid" && !payment\.sponsoredBy && \(/);
    assert.match(tab, /\{canOverrideFees && payment\.sponsoredBy && \(/);
  });
});
