/**
 * Weekend match operations — server routes against the Firestore emulator
 * (`tests/weekend-ops.emulator.test.mjs`).
 *
 * Production code exercised (no mocks of the code under test):
 *   - app/api/admin/weekend-results/route.ts          (Feature A, incl. abandoned waiver)
 *   - app/api/admin/reconcile-abandoned/route.ts      (shared waiver, Finance route)
 *   - app/api/admin/player-of-weekend/route.ts        (Feature B)
 *   - app/api/admin/weekend-prompts/route.ts          (schedule + pending state, per role)
 *   - app/api/finance/match-ledger/route.ts           (Feature D's existing, unchanged write path)
 * Caller identity comes from the KAVACH_TEST_AUTH_BYPASS x-test-* headers (enabled by the
 * emulator runner; token verification itself is covered by R1). The clock is pinned with
 * x-test-now, which the routes honour only behind the same test bypass.
 *
 * Run: npm run test:emulator -- tests/weekend-ops.emulator.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !emulatorHost && "FIRESTORE_EMULATOR_HOST not set (run via npm run test:emulator)";

// The existing match-ledger route (unchanged by this workstream) uses the "@/..." alias and
// TypeScript parameter properties, which Node's type stripping rejects. Resolve the alias to
// the same files (same module instances, so the emulator db injected below is the one it
// uses) and transpile only that route with the project's TypeScript compiler.
const ROOT = pathToFileURL(process.cwd() + "/").href;
register(
  "data:text/javascript," +
    encodeURIComponent(`
const ROOT = ${JSON.stringify(ROOT)};
export async function resolve(spec, ctx, next) {
  if (spec === "next/server") return next("next/server.js", ctx);
  if (spec.startsWith("@/")) spec = new URL(spec.slice(2) + (/\\.[a-z]+$/.test(spec) ? "" : ".ts"), ROOT).href;
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (!url.endsWith("/app/api/finance/match-ledger/route.ts")) return next(url, ctx);
  const { readFile } = await import("node:fs/promises");
  const ts = (await import(${JSON.stringify(ROOT + "node_modules/typescript/lib/typescript.js")})).default;
  const source = await readFile(new URL(url), "utf-8");
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false } }).outputText;
  return { format: "module", source: out, shortCircuit: true };
}`),
  import.meta.url,
);

const ist = (date, time = "00:00") => Date.parse(`${date}T${time}:00+05:30`);
// Weekend of Sat 2026-11-21 / Sun 2026-11-22.
const SUN_1930 = ist("2026-11-22", "19:30");
const MON_0900 = ist("2026-11-23", "09:00");
const TUE_0900 = ist("2026-11-24", "09:00");
const SAT_NEXT = ist("2026-11-28", "10:00");

describe("Weekend match operations — routes on the emulator", { skip }, () => {
  let db;
  let results, reconcile, potw, prompts, ledger;
  let seq = 0;
  const saved = {};
  const id = (p) => `${p}_${++seq}`;

  before(async () => {
    Object.assign(process.env, { NODE_ENV: "test", KAVACH_TEST_AUTH_BYPASS: "true" });
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = getApps().length ? getApps()[0] : initializeApp({ projectId: "kavach-weekend-ops-test" });
    db = getFirestore(app);
    (await import("../lib/server-db.ts")).setServerDbForTesting(db);
    results = await import("../app/api/admin/weekend-results/route.ts");
    reconcile = await import("../app/api/admin/reconcile-abandoned/route.ts");
    potw = await import("../app/api/admin/player-of-weekend/route.ts");
    prompts = await import("../app/api/admin/weekend-prompts/route.ts");
    ledger = await import("../app/api/finance/match-ledger/route.ts");
    for (const l of ["log", "info", "warn", "error"]) {
      saved[l] = console[l];
      console[l] = () => {};
    }
  });
  after(() => Object.assign(console, saved));

  async function call(handler, { uid, roles, body, now, query = "" } = {}) {
    const headers = { "content-type": "application/json" };
    if (uid) {
      headers["x-test-uid"] = uid;
      if (roles) headers["x-test-roles"] = roles;
    }
    if (now) headers["x-test-now"] = String(now);
    const method = body === undefined ? "GET" : "POST";
    const res = await handler(new Request(`http://localhost/api/x${query}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
    let json = {};
    try { json = await res.json(); } catch {}
    return { status: res.status, json };
  }
  const postResults = (o, body) => call(results.POST, { ...o, body });
  const MA = { uid: "u_match_admin", roles: "matchAdmin" };
  const SA = { uid: "u_super", roles: "superAdmin" };
  const CA = { uid: "u_club_admin", roles: "clubAdmin" };
  const FA = { uid: "u_finance", roles: "financeAdmin" };
  const PL = { uid: "u_player" };

  async function seedMatch(extra = {}) {
    const matchId = id("m");
    await db.collection("matches").doc(matchId).set({
      groundId: "g1", format: "T20", jerseyColor: "Scarlet Red", opponent: `Opp ${matchId}`, matchType: "Practice",
      fee: 500, date: "2026-11-22", time: "07:00", maxSquadSize: 14, result: "Pending", createdAt: new Date(), updatedAt: new Date(),
      ...extra,
    });
    return matchId;
  }
  const match = async (mid) => (await db.collection("matches").doc(mid).get()).data();
  const audits = async (entityId) => (await db.collection("auditLogs").where("entityId", "==", entityId).get()).docs.map((d) => d.data());

  // ── Feature A: results ──

  it("WO-01 results: unauthenticated 401; player, Finance Admin and Club Admin 403 (not broadened)", async () => {
    const mid = await seedMatch();
    const body = { results: [{ matchId: mid, result: "KAvach Won" }] };
    assert.equal((await postResults({ now: SUN_1930 }, body)).status, 401);
    for (const who of [PL, FA, CA]) assert.equal((await postResults({ ...who, now: SUN_1930 }, body)).status, 403, who.roles || "player");
    assert.equal((await match(mid)).result, "Pending");
  });

  it("WO-02 Match Admin and Super Admin record an eligible result, audited", async () => {
    const a = await seedMatch();
    const b = await seedMatch({ date: "2026-11-21" });
    const r = await postResults({ ...MA, now: SUN_1930 }, { results: [{ matchId: a, result: "KAvach Won" }] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.outcomes, [{ matchId: a, status: "saved", result: "KAvach Won" }]);
    assert.equal((await match(a)).result, "KAvach Won");
    const log = await audits(a);
    assert.equal(log.length, 1);
    assert.equal(log[0].actorId, MA.uid);
    assert.deepEqual(log[0].changes, [{ field: "result", oldValue: "Pending", newValue: "KAvach Won" }]);
    const r2 = await postResults({ ...SA, now: SUN_1930 }, { results: [{ matchId: b, result: "Tie" }] });
    assert.equal(r2.json.outcomes[0].status, "saved");
  });

  it("WO-03 never overwrites: a recorded result is a conflict; the same value is a no-op", async () => {
    const mid = await seedMatch({ result: "KAvach Lost" });
    const r = await postResults({ ...MA, now: SUN_1930 }, { results: [{ matchId: mid, result: "KAvach Won" }] });
    assert.deepEqual(r.json.outcomes, [{ matchId: mid, status: "conflict", existingResult: "KAvach Lost" }]);
    const same = await postResults({ ...MA, now: SUN_1930 }, { results: [{ matchId: mid, result: "KAvach Lost" }] });
    assert.equal(same.json.outcomes[0].status, "unchanged");
    assert.equal((await match(mid)).result, "KAvach Lost");
    assert.equal((await audits(mid)).length, 0);
  });

  it("WO-04 eligibility is re-checked on the server: too early, missing format, invalid values, unknown match", async () => {
    const early = await seedMatch({ date: "2026-11-22", time: "14:00" }); // eligible from Monday 00:00
    const nofmt = await seedMatch({ format: "" });
    const ok = await seedMatch();
    const r = await postResults({ ...MA, now: SUN_1930 }, {
      results: [
        { matchId: early, result: "KAvach Won" },
        { matchId: nofmt, result: "KAvach Won" },
        { matchId: ok, result: "Pending" },
        { matchId: ok, result: "Draw" },
        { matchId: "missing_match", result: "Tie" },
        { matchId: "a/b", result: "Tie" },
      ],
    });
    assert.deepEqual(r.json.outcomes.map((o) => [o.status, o.reason ?? null]), [
      ["not_eligible", "not_yet"],
      ["not_eligible", "missing_or_unknown_format"],
      ["invalid", "Choose Won, Loss, Tie or Abandoned."],
      ["invalid", "Invalid or duplicate match id."],
      ["not_found", null],
      ["invalid", "Invalid or duplicate match id."],
    ]);
    for (const m of [early, nofmt, ok]) assert.equal((await match(m)).result, "Pending");
    assert.equal((await postResults({ ...MA, now: SUN_1930 }, { results: [] })).status, 400);
  });

  it("WO-05 partial save: valid rows are saved, others reported, nothing else changes", async () => {
    const a = await seedMatch();
    const done = await seedMatch({ result: "Tie" });
    const r = await postResults({ ...MA, now: SUN_1930 }, { results: [{ matchId: a, result: "KAvach Lost" }, { matchId: done, result: "KAvach Won" }] });
    assert.deepEqual(r.json.outcomes.map((o) => o.status), ["saved", "conflict"]);
    assert.equal((await match(a)).result, "KAvach Lost");
    assert.equal((await match(done)).result, "Tie");
  });

  it("WO-06 two admins at once with different results: exactly one is saved, the other is a conflict", async () => {
    const mid = await seedMatch();
    const [x, y] = await Promise.all([
      postResults({ ...MA, now: SUN_1930 }, { results: [{ matchId: mid, result: "KAvach Won" }] }),
      postResults({ ...SA, now: SUN_1930 }, { results: [{ matchId: mid, result: "KAvach Lost" }] }),
    ]);
    const statuses = [x.json.outcomes[0].status, y.json.outcomes[0].status].sort();
    assert.deepEqual(statuses, ["conflict", "saved"]);
    const winner = x.json.outcomes[0].status === "saved" ? "KAvach Won" : "KAvach Lost";
    assert.equal((await match(mid)).result, winner);
    assert.equal((await audits(mid)).length, 1);
  });

  async function seedPayments(mid) {
    const col = db.collection(`matches/${mid}/payments`);
    await col.doc("p_unpaid_1").set({ id: "p_unpaid_1", matchId: mid, playerId: "pl1", status: "Unpaid", createdAt: new Date(), updatedAt: new Date() });
    await col.doc("p_unpaid_2").set({ id: "p_unpaid_2", matchId: mid, playerId: "pl2", status: "Unpaid", feeOverride: 700, createdAt: new Date(), updatedAt: new Date() });
    await col.doc("p_paid").set({ id: "p_paid", matchId: mid, playerId: "pl3", status: "Paid", feeCollectedAmount: 500, paymentMethod: "razorpay", createdAt: new Date(), updatedAt: new Date() });
    await col.doc("p_np").set({ id: "p_np", matchId: mid, playerId: "pl4", status: "Not Playing", createdAt: new Date(), updatedAt: new Date() });
  }
  const pay = async (mid, pid) => (await db.doc(`matches/${mid}/payments/${pid}`).get()).data();

  it("WO-07 Abandoned by a Match Admin runs the existing waiver on the server: unpaid waived, paid preserved, audited", async () => {
    const mid = await seedMatch();
    await seedPayments(mid);
    const r = await postResults({ ...MA, now: SUN_1930 }, { results: [{ matchId: mid, result: "Abandoned" }] });
    assert.deepEqual(r.json.outcomes[0], { matchId: mid, status: "saved", result: "Abandoned", waiver: { status: "applied", waived: 2, paidPreserved: 1 } });
    for (const p of ["p_unpaid_1", "p_unpaid_2"]) {
      const d = await pay(mid, p);
      assert.equal(d.status, "Waived");
      assert.equal(d.waivedReason, "Match Abandoned");
      assert.ok(d.waivedAt);
      assert.equal(d.playerId, p === "p_unpaid_1" ? "pl1" : "pl2"); // original references kept
    }
    assert.equal((await pay(mid, "p_unpaid_2")).feeOverride, 700); // original amount kept
    const paid = await pay(mid, "p_paid");
    assert.equal(paid.status, "Paid");
    assert.equal(paid.feeCollectedAmount, 500);
    assert.equal(paid.waivedReason, undefined); // no refund, no change
    assert.equal((await pay(mid, "p_np")).status, "Not Playing");
    const log = await audits(mid);
    assert.equal(log.length, 2);
    const waiverLog = log.find((l) => l.action === "status_change");
    assert.equal(waiverLog.actorId, MA.uid);
    assert.match(waiverLog.summary, /waived 2 unpaid match-fee obligation\(s\) \(₹1200\); 1 paid record\(s\) preserved/);
  });

  it("WO-08 the waiver is idempotent and safely retryable (results route and Finance route share it)", async () => {
    const mid = await seedMatch();
    await seedPayments(mid);
    await postResults({ ...MA, now: SUN_1930 }, { results: [{ matchId: mid, result: "Abandoned" }] });
    // A late unpaid obligation appears (e.g. squad change) → a retry waives only it.
    await db.doc(`matches/${mid}/payments/p_late`).set({ id: "p_late", matchId: mid, playerId: "pl5", status: "Unpaid", createdAt: new Date(), updatedAt: new Date() });
    const retry = await postResults({ ...MA, now: SUN_1930 }, { results: [{ matchId: mid, result: "Abandoned" }] });
    assert.deepEqual(retry.json.outcomes[0], { matchId: mid, status: "unchanged", result: "Abandoned", waiver: { status: "applied", waived: 1, paidPreserved: 1 } });
    const again = await postResults({ ...MA, now: SUN_1930 }, { results: [{ matchId: mid, result: "Abandoned" }] });
    assert.equal(again.json.outcomes[0].waiver.waived, 0);
    // Finance route: same mechanism, nothing left to waive.
    const fin = await call(reconcile.POST, { ...FA, body: { matchId: mid } });
    assert.equal(fin.status, 200);
    assert.equal(fin.json.waivedCount, 0);
    assert.equal(fin.json.alreadyWaivedCount, 3);
    assert.equal(fin.json.paidPreservedCount, 1);
    assert.equal((await audits(mid)).filter((l) => l.action === "status_change").length, 2); // no audit for no-op runs
    // Match Admin still cannot call the Finance route directly.
    assert.equal((await call(reconcile.POST, { ...MA, body: { matchId: mid } })).status, 403);
  });

  it("WO-09 Finance reconcile route keeps its behaviour (dry run writes nothing) and now audits", async () => {
    const mid = await seedMatch({ result: "Abandoned" });
    await seedPayments(mid);
    const dry = await call(reconcile.POST, { ...FA, body: { matchId: mid, dryRun: true } });
    assert.equal(dry.json.waivedCount, 2);
    assert.equal((await pay(mid, "p_unpaid_1")).status, "Unpaid");
    assert.equal((await audits(mid)).length, 0);
    const real = await call(reconcile.POST, { ...FA, body: { matchId: mid } });
    assert.equal(real.json.waivedCount, 2);
    assert.equal((await pay(mid, "p_unpaid_1")).status, "Waived");
    assert.equal((await audits(mid))[0].actorId, FA.uid);
    const notAbandoned = await seedMatch();
    assert.equal((await call(reconcile.POST, { ...FA, body: { matchId: notAbandoned } })).status, 400);
  });

  // ── Feature B: Player of the Weekend ──

  async function seedPlayer({ linkedUid, ...extra } = {}) {
    const pid = id("player");
    await db.collection("players").doc(pid).set({ id: pid, name: `Player ${pid}`, mobile: "9000000000", inviteStatus: "Accepted", photoURL: "https://example.test/p.jpg", ...extra });
    if (linkedUid) await db.collection("appUsers").doc(linkedUid).set({ playerId: pid, name: "Linked" });
    return pid;
  }
  const count = async (col, field, value) => (await db.collection(col).where(field, "==", value).count().get()).data().count;
  const WEEKEND = "2026-11-21";

  it("WO-10 award authority: Club Admin / Super Admin only; Match Admin, Finance Admin, player and anonymous denied", async () => {
    const pid = await seedPlayer();
    const body = { weekendId: WEEKEND, playerId: pid };
    assert.equal((await call(potw.POST, { now: MON_0900, body })).status, 401);
    for (const who of [PL, MA, FA]) assert.equal((await call(potw.POST, { ...who, now: MON_0900, body })).status, 403);
    assert.equal((await db.doc(`badges/potw_${WEEKEND}`).get()).exists, false);
  });

  it("WO-11 validation: window, weekend, player, message", async () => {
    const pid = await seedPlayer();
    const disabled = await seedPlayer({ disabled: true });
    const merged = await seedPlayer({ mergedInto: pid });
    assert.equal((await call(potw.POST, { ...CA, now: SAT_NEXT, body: { weekendId: WEEKEND, playerId: pid } })).status, 409);
    assert.equal((await call(potw.POST, { ...CA, now: MON_0900, body: { weekendId: "2026-11-14", playerId: pid } })).status, 400);
    assert.equal((await call(potw.POST, { ...CA, now: MON_0900, body: { weekendId: WEEKEND, playerId: "nobody" } })).status, 404);
    assert.equal((await call(potw.POST, { ...CA, now: MON_0900, body: { weekendId: WEEKEND, playerId: disabled } })).status, 400);
    assert.equal((await call(potw.POST, { ...CA, now: MON_0900, body: { weekendId: WEEKEND, playerId: merged } })).status, 400);
    assert.equal((await call(potw.POST, { ...CA, now: MON_0900, body: { weekendId: WEEKEND, playerId: pid, message: "a\nb\nc\nd\ne" } })).status, 400);
    assert.equal((await call(potw.POST, { ...CA, now: MON_0900, body: { weekendId: WEEKEND, playerId: pid, message: "x".repeat(121) } })).status, 400);
    assert.equal((await db.doc(`badges/potw_${WEEKEND}`).get()).exists, false);
  });

  it("WO-12 simultaneous awards by two admins: exactly one award, badge, banner post and notification; retries create nothing", async () => {
    const p1 = await seedPlayer({ linkedUid: "uid_linked_1" });
    const p2 = await seedPlayer({ linkedUid: "uid_linked_2" });
    const [a, b] = await Promise.all([
      call(potw.POST, { ...CA, now: MON_0900, body: { weekendId: WEEKEND, playerId: p1, message: "82* off 51\nand 2 catches" } }),
      call(potw.POST, { ...SA, now: MON_0900, body: { weekendId: WEEKEND, playerId: p2 } }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const winner = a.status === 200 ? a.json.award : b.json.award;
    const badge = (await db.doc(`badges/potw_${WEEKEND}`).get()).data();
    assert.equal(badge.playerId, winner.playerId);
    assert.equal(badge.badgeType, "player_of_weekend");
    assert.equal(badge.weekendId, WEEKEND);
    assert.equal(badge.redeemed, false);
    const post = (await db.doc(`posts/potw_${WEEKEND}`).get()).data();
    assert.equal(post.kind, "potw");
    assert.equal(post.isAnnouncement, true);
    assert.equal(post.potw.playerId, winner.playerId);
    const notif = (await db.doc(`notifications/potw_${WEEKEND}`).get()).data();
    assert.equal(notif.userId, winner.playerId === p1 ? "uid_linked_1" : "uid_linked_2");
    assert.equal(winner.notified, true);
    // Retry by the losing admin and a double-click by the winner: 409, nothing new.
    const retry = await call(potw.POST, { ...CA, now: ist("2026-11-25", "10:00"), body: { weekendId: WEEKEND, playerId: p2 } });
    assert.equal(retry.status, 409);
    assert.equal(retry.json.alreadyAwarded, true);
    assert.equal(await count("badges", "badgeType", "player_of_weekend"), 1);
    assert.equal(await count("posts", "kind", "potw"), 1);
    assert.equal(await count("notifications", "metadata.kind", "potw"), 1);
    assert.equal((await audits(`potw_${WEEKEND}`)).length, 1);
  });

  it("WO-13 a player without a linked login gets the award and banner but no notification", async () => {
    await db.recursiveDelete(db.collection("badges"));
    await db.recursiveDelete(db.collection("posts"));
    await db.recursiveDelete(db.collection("notifications"));
    const pid = await seedPlayer();
    const r = await call(potw.POST, { ...SA, now: MON_0900, body: { weekendId: WEEKEND, playerId: pid } });
    assert.equal(r.status, 200);
    assert.equal(r.json.award.notified, false);
    assert.equal((await db.doc(`posts/potw_${WEEKEND}`).get()).exists, true);
    assert.equal((await db.doc(`notifications/potw_${WEEKEND}`).get()).exists, false);
  });

  // ── Prompts: schedule, roles, pending state ──

  it("WO-14 prompt sections follow verified roles; players are denied", async () => {
    assert.equal((await call(prompts.GET, { ...PL, now: TUE_0900 })).status, 403);
    assert.equal((await call(prompts.GET, { now: TUE_0900 })).status, 401);
    const keys = async (who) => Object.keys((await call(prompts.GET, { ...who, now: TUE_0900 })).json).filter((k) => ["results", "potw", "fees"].includes(k)).sort();
    assert.deepEqual(await keys(MA), ["results"]);
    assert.deepEqual(await keys(CA), ["potw"]);
    assert.deepEqual(await keys(FA), ["fees"]);
    assert.deepEqual(await keys(SA), ["fees", "potw", "results"]);
    assert.deepEqual(await keys({ uid: "u_mf", roles: "matchAdmin,financeAdmin" }), ["fees", "results"]);
  });

  it("WO-15 results prompt: due from Sunday 19:00, clears once recorded; backfill queue is explicit and role-gated", async () => {
    const mid = await seedMatch({ date: "2026-11-21" });
    const old = await seedMatch({ date: "2026-10-03" });
    const nofmt = await seedMatch({ date: "2026-11-21", format: "" });
    const ids = async (now) => (await call(prompts.GET, { ...MA, now })).json.results.items.map((i) => i.id);
    assert.equal((await ids(ist("2026-11-22", "18:59"))).includes(mid), false); // not due before Sunday 19:00
    const due = await call(prompts.GET, { ...MA, now: SUN_1930 });
    assert.ok(due.json.results.items.some((i) => i.id === mid));
    assert.ok(!due.json.results.items.some((i) => i.id === old)); // never in the recurring prompt
    assert.ok(due.json.results.exceptions.some((e) => e.id === nofmt && e.reason === "missing_or_unknown_format"));
    assert.ok(due.json.pending.results >= 1);
    await postResults({ ...MA, now: SUN_1930 }, { results: [{ matchId: mid, result: "KAvach Won" }] });
    assert.equal((await ids(SUN_1930)).includes(mid), false); // cleared for every admin
    const bf = await call(prompts.GET, { ...MA, now: SUN_1930, query: "?view=history" });
    assert.ok(bf.json.results.items.some((i) => i.id === old));
    assert.ok(!bf.json.results.items.some((i) => i.id === mid)); // recorded → gone
    assert.ok(!bf.json.results.exceptions.some((e) => e.id === nofmt)); // in the recurring prompt's window → not duplicated
    // History sections follow roles: Finance sees fees only, Club Admin POTW only — never results.
    const fin = await call(prompts.GET, { ...FA, now: SUN_1930, query: "?view=history" });
    assert.deepEqual(Object.keys(fin.json).filter((k) => ["results", "fees", "potw"].includes(k)), ["fees"]);
    const club = await call(prompts.GET, { ...CA, now: SUN_1930, query: "?view=history" });
    assert.deepEqual(Object.keys(club.json).filter((k) => ["results", "fees", "potw"].includes(k)), ["potw"]);
    assert.equal((await call(prompts.GET, { ...PL, now: SUN_1930, query: "?view=history" })).status, 403);
    assert.equal((await call(prompts.GET, { ...MA, now: SUN_1930, query: "?view=other" })).status, 400);
  });

  it("WO-16 Player of the Weekend prompt: open Monday 08:00–Friday 23:59, pending until awarded", async () => {
    // A banner post without its badge (e.g. badge revoked) still counts as awarded — never prompt for an award that can't be granted.
    await db.recursiveDelete(db.collection("badges"));
    assert.equal((await call(prompts.GET, { ...CA, now: MON_0900 })).json.pending.potw, 0);
    await db.recursiveDelete(db.collection("posts"));
    await db.recursiveDelete(db.collection("notifications"));
    const before = await call(prompts.GET, { ...CA, now: ist("2026-11-23", "07:59") });
    assert.equal(before.json.potw, null);
    const open = await call(prompts.GET, { ...CA, now: MON_0900 });
    assert.equal(open.json.potw.weekendId, WEEKEND);
    assert.equal(open.json.potw.awarded, null);
    assert.equal(open.json.pending.potw, 1);
    const pid = await seedPlayer();
    await call(potw.POST, { ...CA, now: MON_0900, body: { weekendId: WEEKEND, playerId: pid } });
    const after = await call(prompts.GET, { ...CA, now: ist("2026-11-27", "20:00") });
    assert.equal(after.json.pending.potw, 0);
    assert.equal(after.json.potw.awarded.playerId, pid);
    assert.equal((await call(prompts.GET, { ...CA, now: SAT_NEXT })).json.potw, null);
  });

  it("WO-17 actual fee: the prompt lists matches without a fee; the existing ledger route (Finance only) records it with audit and history", async () => {
    const mid = await seedMatch({ date: "2026-11-21" });
    const abandoned = await seedMatch({ date: "2026-11-22", result: "Abandoned" });
    const feeIds = async () => (await call(prompts.GET, { ...FA, now: TUE_0900 })).json.fees.items.map((i) => i.id);
    assert.ok((await feeIds()).includes(mid));
    assert.ok((await feeIds()).includes(abandoned));
    assert.equal((await call(prompts.GET, { ...FA, now: ist("2026-11-24", "07:59") })).json.fees.items.some((i) => i.id === mid), false);
    // Non-finance roles cannot write the actual fee.
    for (const who of [MA, CA, PL]) {
      assert.equal((await call(ledger.POST, { ...who, body: { action: "setGroundFee", matchId: mid, amount: 4000 } })).status, 403);
    }
    assert.equal((await call(ledger.POST, { ...FA, body: { action: "setGroundFee", matchId: mid, amount: -1 } })).status, 400);
    const ok = await call(ledger.POST, { ...FA, body: { action: "setGroundFee", matchId: mid, amount: 4000, reason: "" } });
    assert.equal(ok.status, 200);
    const m = await match(mid);
    assert.equal(m.groundFeePaidAmount, 4000);
    assert.equal(m.fee, 500); // configured per-player fee unchanged
    assert.equal(m.groundFeeHistory.length, 1);
    assert.ok((await audits(mid)).length >= 1);
    assert.equal((await feeIds()).includes(mid), false); // cleared for everyone
    // A correction still requires a reason (existing flow).
    assert.equal((await call(ledger.POST, { ...FA, body: { action: "setGroundFee", matchId: mid, amount: 4500 } })).status, 400);
    // ₹0 is a recorded amount, not "missing".
    await call(ledger.POST, { ...SA, body: { action: "setGroundFee", matchId: abandoned, amount: 0 } });
    assert.equal((await feeIds()).includes(abandoned), false);
  });

  // ── Historical Data Completion ──

  const hist = async (who, now = TUE_0900) => (await call(prompts.GET, { ...who, now, query: "?view=history" })).json;

  it("WO-18 history: results and fees lists are persistent, role-scoped, disjoint from the recurring prompts, and shrink as records are completed by any admin", async () => {
    const r1 = await seedMatch({ date: "2026-09-05" });
    const r2 = await seedMatch({ date: "2026-09-12" });
    const f1 = await seedMatch({ date: "2026-09-19", result: "KAvach Won" });
    const recent = await seedMatch({ date: "2026-11-21" }); // in the recurring prompts
    const h0 = await hist(SA);
    for (const id of [r1, r2]) assert.ok(h0.results.items.some((i) => i.id === id));
    assert.ok(h0.fees.items.some((i) => i.id === f1));
    assert.ok(!h0.results.items.some((i) => i.id === recent));
    assert.ok(!h0.fees.items.some((i) => i.id === recent));
    assert.equal(h0.results.count, h0.results.items.length);
    // Partial completion by a Match Admin; another admin (Super) sees the smaller list.
    const save = await postResults({ ...MA, now: TUE_0900 }, { source: "backfill", results: [{ matchId: r1, result: "KAvach Lost" }] });
    assert.equal(save.json.outcomes[0].status, "saved");
    const h1 = await hist({ uid: "u_other_super", roles: "superAdmin" });
    assert.equal(h1.results.count, h0.results.count - 1);
    assert.ok(!h1.results.items.some((i) => i.id === r1));
    assert.ok(h1.results.items.some((i) => i.id === r2)); // completed records don't reappear; others stay
    // Fee via the existing ledger route by Finance → gone from history for everyone.
    await call(ledger.POST, { ...FA, body: { action: "setGroundFee", matchId: f1, amount: 3500 } });
    const h2 = await hist(SA);
    assert.ok(!h2.fees.items.some((i) => i.id === f1));
    assert.equal(h2.fees.count, h0.fees.count - 1);
    assert.equal(h2.fees.count, h2.fees.items.length);
    const audit = await audits(r1);
    assert.match(audit[0].summary, /historical backfill/);
  });

  it("WO-19 history: Player of the Weekend lists past played weekends without an award; an explicit historical award creates badge + notification + audit, no banner; idempotent", async () => {
    await db.recursiveDelete(db.collection("badges"));
    await db.recursiveDelete(db.collection("posts"));
    await db.recursiveDelete(db.collection("notifications"));
    const played = await seedMatch({ date: "2026-10-10", result: "KAvach Won" }); // Sat 10 Oct
    await seedMatch({ date: "2026-10-18", result: "Abandoned" }); // weekend 17 Oct: abandoned only
    await seedMatch({ date: "2025-12-20", result: "KAvach Won" }); // before POTW_HISTORY_FROM default
    const h0 = await hist(CA);
    const ids = h0.potw.items.map((w) => w.weekendId);
    assert.ok(ids.includes("2026-10-10"));
    assert.ok(!ids.includes("2026-10-17"));
    assert.ok(!ids.includes("2025-12-20"));
    assert.ok(!ids.includes("2026-11-21")); // current weekend → recurring prompt
    assert.ok(h0.potw.items.find((w) => w.weekendId === "2026-10-10").matches.some((m) => m.id === played));
    const pid = await seedPlayer({ linkedUid: "uid_hist_potw" });
    // Only the award authority; only eligible past weekends.
    assert.equal((await call(potw.POST, { ...MA, now: TUE_0900, body: { source: "history", weekendId: "2026-10-10", playerId: pid } })).status, 403);
    for (const bad of ["2026-10-17", "2026-10-11", "2025-12-20", "2026-11-21", "junk"]) {
      assert.equal((await call(potw.POST, { ...CA, now: TUE_0900, body: { source: "history", weekendId: bad, playerId: pid } })).status, 400, bad);
    }
    const [a, b] = await Promise.all([
      call(potw.POST, { ...CA, now: TUE_0900, body: { source: "history", weekendId: "2026-10-10", playerId: pid, message: "Five-for" } }),
      call(potw.POST, { ...SA, now: TUE_0900, body: { source: "history", weekendId: "2026-10-10", playerId: pid } }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const badge = (await db.doc("badges/potw_2026-10-10").get()).data();
    assert.equal(badge.historical, true);
    assert.equal(badge.weekendId, "2026-10-10");
    assert.equal((await db.doc("posts/potw_2026-10-10").get()).exists, false); // no banner for an old weekend
    assert.equal((await db.doc("notifications/potw_2026-10-10").get()).data().userId, "uid_hist_potw");
    assert.equal((await audits("potw_2026-10-10")).length, 1);
    const h1 = await hist({ uid: "u_club_2", roles: "clubAdmin" });
    assert.ok(!h1.potw.items.some((w) => w.weekendId === "2026-10-10"));
    assert.equal(h1.potw.count, h0.potw.count - 1);
    // The current weekend's regular award is unaffected and still creates its banner.
    const cur = await call(potw.POST, { ...CA, now: TUE_0900, body: { weekendId: "2026-11-21", playerId: pid } });
    assert.equal(cur.status, 200);
    assert.equal((await db.doc("posts/potw_2026-11-21").get()).exists, true);
  });

  it("WO-20 results in one request are saved concurrently: all independent rows saved and audited; duplicates rejected; order kept", async () => {
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(await seedMatch({ date: "2026-09-26" }));
    const r = await postResults({ ...MA, now: TUE_0900 }, {
      source: "backfill",
      results: [...ids.map((matchId, i) => ({ matchId, result: i % 2 ? "KAvach Won" : "Tie" })), { matchId: ids[0], result: "KAvach Lost" }],
    });
    assert.deepEqual(r.json.outcomes.map((o) => o.matchId), [...ids, ids[0]]);
    assert.deepEqual(r.json.outcomes.map((o) => o.status), ["saved", "saved", "saved", "saved", "saved", "saved", "invalid"]);
    for (const [i, id] of ids.entries()) {
      assert.equal((await match(id)).result, i % 2 ? "KAvach Won" : "Tie");
      assert.equal((await audits(id)).length, 1);
    }
  });
});
