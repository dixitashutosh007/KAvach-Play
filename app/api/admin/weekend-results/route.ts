/**
 * POST /api/admin/weekend-results — record weekend match results (Feature A).
 *
 * Auth: Super Admin or (legacy) Match Admin ONLY — owner decision 2026-11-24.
 * Club Admin is deliberately not included until role consolidation (D-19,
 * Workstream B) is implemented and verified; this is narrower than
 * `requireMatchAdmin`, which already admits Club Admin.
 *
 * Body: { source?: "prompt" | "backfill", results: [{ matchId, result }] }
 *   result ∈ "KAvach Won" | "KAvach Lost" | "Tie" | "Abandoned"
 *
 * Per match, in one transaction: the match must exist, be eligible (estimated
 * end + 6 h has passed; start and format known) and have no result yet. A
 * recorded result is never overwritten (status "conflict"; corrections stay in
 * the Match Center edit form). Re-sending the same value is a no-op
 * ("unchanged"). Every write has a server audit entry.
 *
 * Abandoned: the existing trusted abandoned-match transition
 * (lib/abandoned-match.ts, shared with /api/admin/reconcile-abandoned) runs on
 * the server after the result is saved — unpaid obligations waived, paid
 * records preserved, audited, idempotent. If it fails, the result stays
 * Abandoned and re-sending the same result retries the transition safely.
 * The caller gains no finance permissions: only this fixed transition runs.
 *
 * Partial saves are supported: each item reports its own outcome. Items are
 * processed concurrently (independent documents); "error" items are safe to retry.
 */
import { NextResponse } from "next/server.js";
import { FieldValue } from "firebase-admin/firestore";
import { requireRole } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { actorNameFor, writeServerAudit } from "../../../../lib/server-audit.ts";
import { waiveAbandonedMatchObligations } from "../../../../lib/abandoned-match.ts";
import { hasResult, isResultValue, resultEligibility, type MatchLike } from "../../../../lib/weekend-ops.ts";
import { isSafeId, RESULT_RECORDER_ROLES, serverNow } from "../../../../lib/weekend-ops-server.ts";

const MAX_ITEMS = 50;

type Outcome =
  | { matchId: string; status: "saved" | "unchanged"; result: string; waiver?: { status: "applied" | "failed"; waived?: number; paidPreserved?: number } }
  | { matchId: string; status: "conflict"; existingResult: string }
  | { matchId: string; status: "not_found" | "invalid" | "not_eligible" | "error"; reason?: string };

class ItemError extends Error {
  outcome: Outcome;
  constructor(outcome: Outcome) {
    super(outcome.status);
    this.outcome = outcome;
  }
}

export async function POST(req: Request) {
  const guard = await requireRole(req, [...RESULT_RECORDER_ROLES]);
  if (!guard.ok) return guard.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const source = body?.source === "backfill" ? "backfill" : "prompt";
  const list = Array.isArray(body?.results) ? body.results : null;
  if (!list || list.length === 0 || list.length > MAX_ITEMS) {
    return NextResponse.json({ error: `Send 1–${MAX_ITEMS} results.` }, { status: 400 });
  }

  const db = getServerFirestore();
  const now = serverNow(req);
  const actor = { id: guard.uid, name: await actorNameFor(db, guard.uid) };
  const seen = new Set<string>();

  // Each match is independent (its own transaction, eligibility check, audit
  // entry and — for Abandoned — waiver), so they run concurrently; the response
  // keeps the request order. An unexpected failure on one match is reported as
  // "error" (safe to retry) and does not undo or block the others.
  const recordOne = async (item: any): Promise<Outcome> => {
    const matchId = item?.matchId;
    const result = item?.result;
    if (!isSafeId(matchId) || seen.has(matchId)) {
      return { matchId: String(matchId ?? ""), status: "invalid", reason: "Invalid or duplicate match id." };
    }
    seen.add(matchId);
    if (!isResultValue(result)) return { matchId, status: "invalid", reason: "Choose Won, Loss, Tie or Abandoned." };

    let saved: { status: "saved" | "unchanged"; match: MatchLike & { fee?: number } };
    try {
      saved = await db.runTransaction(async (tx) => {
        const ref = db.collection("matches").doc(matchId);
        const snap = await tx.get(ref);
        if (!snap.exists) throw new ItemError({ matchId, status: "not_found" });
        const match = { ...(snap.data() as any), id: matchId } as MatchLike & { fee?: number };
        if (hasResult(match)) {
          if (match.result === result) return { status: "unchanged" as const, match };
          throw new ItemError({ matchId, status: "conflict", existingResult: String(match.result) });
        }
        const e = resultEligibility(match, now);
        if (!e.eligible) throw new ItemError({ matchId, status: "not_eligible", reason: e.reason });
        tx.update(ref, { result, updatedAt: FieldValue.serverTimestamp() });
        await writeServerAudit(
          db,
          {
            actorId: actor.id,
            actorName: actor.name,
            action: "updated",
            entity: "match",
            entityId: matchId,
            entityLabel: `vs ${match.opponent || "Match"} (${match.date || ""})`,
            changes: [{ field: "result", oldValue: match.result || "Pending", newValue: result }],
            summary: `Result recorded (${source === "backfill" ? "historical backfill" : "weekend results prompt"}): ${result}.`,
          },
          tx,
        );
        return { status: "saved" as const, match: { ...match, result } };
      });
    } catch (err) {
      if (err instanceof ItemError) return err.outcome;
      console.error("[weekend-results] write failed for a match");
      return { matchId, status: "error", reason: "Could not save; try again." };
    }

    const out: Outcome = { matchId, status: saved.status, result };
    if (result === "Abandoned") {
      try {
        const w = await waiveAbandonedMatchObligations(db, saved.match, { actor });
        out.waiver = { status: "applied", waived: w.waivedList.length, paidPreserved: w.paidPreservedList.length };
      } catch {
        console.error("[weekend-results] abandoned-match transition failed; retry is safe");
        out.waiver = { status: "failed" };
      }
    }
    return out;
  };

  const outcomes = await Promise.all(list.map(recordOne));
  return NextResponse.json({ ok: true, outcomes });
}
