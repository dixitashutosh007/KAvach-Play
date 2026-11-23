/**
 * C1 / C2 static checks (tests/match-finance-lifecycle-rules-static.test.mjs).
 * Behaviour is covered by match-finance-lifecycle-rules.emulator.test.mjs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const rules = fs.readFileSync("firestore.rules", "utf8");
const matchBlock = rules.slice(rules.indexOf("match /matches/{matchId} {"), rules.indexOf("match /comments/{commentId} {"));
const payBlock = rules.slice(rules.indexOf("match /payments/{paymentId} {", rules.indexOf("match /matches/{matchId} {")), rules.indexOf("allow delete: if false; // Do not delete payments"));

describe("C1: match finance fields", () => {
  it("server-only key list covers ground fee and finance lifecycle fields", () => {
    const fn = rules.slice(rules.indexOf("function matchFinanceServerKeys"), rules.indexOf("function isFinanceClosedMatch"));
    for (const k of ["groundFeePaidAmount", "isGroundFeePaid", "groundFeeHistory", "financeStatus", "financeHistory", "financeClosedBy"]) assert.ok(fn.includes(`'${k}'`), k);
  });
  it("create / update / delete guards", () => {
    assert.match(matchBlock, /allow create: if isMatchAdmin\(\)[\s\S]*?!incoming\(\)\.keys\(\)\.hasAny\(matchFinanceServerKeys\(\)\)/);
    assert.match(matchBlock, /!incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasAny\(matchFinanceServerKeys\(\)\)/);
    assert.match(matchBlock, /existing\(\)\.get\('financeStatus', 'open'\) != 'closed'\s*\|\| !incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasAny\(\['fee', 'matchFeeBudget'\]\)/);
    assert.match(matchBlock, /allow delete: if isMatchAdmin\(\) && existing\(\)\.get\('financeStatus', 'open'\) != 'closed';/);
  });
  it("closed check tolerates a missing parent match", () => {
    assert.match(rules, /function isFinanceClosedMatch\(matchId\) \{\s*return exists\(/);
  });
});

describe("C2: payments", () => {
  it("guards apply to every client update and create", () => {
    assert.match(payBlock, /&& paymentFinanceGuards\(matchId\)/);
    assert.match(payBlock, /!incoming\(\)\.keys\(\)\.hasAny\(\['reversals', 'financeSnapshot'\]\)\s*&& !isFinanceClosedMatch\(matchId\)/);
  });
  it("real money definition matches lib/match-finance (status Paid, not plan/club, not paid by another, non-zero)", () => {
    const fn = rules.slice(rules.indexOf("function isCollectedMoney"), rules.indexOf("function paymentFinanceGuards"));
    assert.match(fn, /d\.get\('status', ''\) == 'Paid'/);
    assert.match(fn, /!\(d\.get\('manualMethod', ''\) in \['club_sponsored', 'part_of_plan'\]\)/);
    assert.match(fn, /d\.get\('sponsoredBy', ''\) == ''/);
    assert.match(fn, /d\.get\('feeCollectedAmount', d\.get\('feeOverride', 1\)\) != 0/);
  });
  it("locks status / money fields on collected payments; server-only fields; closed-match locks", () => {
    const fn = rules.slice(rules.indexOf("function paymentFinanceGuards"), rules.indexOf("function isPlanSettled"));
    assert.match(fn, /!changed\.hasAny\(\['reversals', 'financeSnapshot'\]\)/);
    for (const k of ["status", "paymentMethod", "feeCollectedAmount", "razorpayPaymentId", "feeOverride"]) assert.ok(fn.includes(`'${k}'`), k);
    assert.match(fn, /!\(existing\(\)\.status == 'Not Playing' && incoming\(\)\.status != 'Not Playing'\)/);
  });
});
