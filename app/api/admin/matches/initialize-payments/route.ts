/**
 * POST /api/admin/matches/initialize-payments
 *
 * Concurrency-safe, idempotent initialization of missing
 * `matches/{matchId}/payments` rows for all chargeable club players using the
 * Firebase Admin SDK inside Firestore transactions.
 *
 * Concurrency & preservation guarantees:
 * - Reads `matches/{matchId}` and `matches/{matchId}/payments` inside a
 *   Firestore transaction so simultaneous requests are serialized and never
 *   create duplicate `(matchId, playerId)` rows.
 * - Preserves all existing payment documents and their original IDs (including
 *   Paid, Waived, and manually overridden rows).
 * - Uses deterministic doc ID (`player.id`) with `tx.create()` for newly
 *   initialized rows so concurrent writers converge on the exact same document.
 */
import { NextResponse } from "next/server.js";
import { FieldValue } from "firebase-admin/firestore";
import { requireRole } from "../../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../../lib/server-db.ts";
import { isSafeId } from "../../../../../lib/weekend-ops-server.ts";

const INITIALIZE_PAYMENTS_ROLES = ["clubAdmin", "superAdmin", "financeAdmin"] as const;
const TX_WRITE_LIMIT = 450;

export async function POST(req: Request) {
  const guard = await requireRole(req, [...INITIALIZE_PAYMENTS_ROLES]);
  if (!guard.ok) return guard.response;

  let body: { matchId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const matchId = typeof body?.matchId === "string" ? body.matchId.trim() : "";
  if (!isSafeId(matchId)) {
    return NextResponse.json({ error: "Valid matchId is required." }, { status: 400 });
  }

  const db = getServerFirestore();
  const matchRef = db.collection("matches").doc(matchId);
  const playersSnap = await db.collection("players").get();

  const chargeablePlayers = playersSnap.docs
    .map((d): Record<string, any> => ({ id: d.id, ...(d.data() as Record<string, any>) }))
    .filter(
      (p) =>
        !p.disabled &&
        !p.mergedInto &&
        p.mergeStatus !== "in_progress" &&
        p.inviteStatus !== "Rejected" &&
        p.inviteStatus !== "Pending",
    );

  let createdCount = 0;
  let existingCount = 0;
  let initialExistingRecorded = false;

  try {
    while (true) {
      const chunkResult = await db.runTransaction(async (tx) => {
        const matchSnap = await tx.get(matchRef);
        if (!matchSnap.exists) {
          return { status: 404 as const, error: `Match ${matchId} not found.` };
        }

        const matchData = matchSnap.data() || {};
        if (matchData.financeStatus === "closed") {
          return {
            status: 409 as const,
            error: "Match finances are closed; cannot initialize new payment rows.",
          };
        }
        if (matchData.isArchived === true) {
          return {
            status: 409 as const,
            error: "Match is archived; cannot initialize payment rows.",
          };
        }
        if (matchData.result === "Abandoned") {
          return {
            status: 409 as const,
            error: "Match is abandoned; cannot initialize payment rows.",
          };
        }

        const existingPaymentsSnap = await tx.get(matchRef.collection("payments"));
        const existingPlayerIds = new Set(
          existingPaymentsSnap.docs
            .map((d) => String(d.data()?.playerId || "").trim())
            .filter(Boolean),
        );

        const missingPlayers = chargeablePlayers.filter(
          (p) => !existingPlayerIds.has(p.id),
        );
        const batchSlice = missingPlayers.slice(0, TX_WRITE_LIMIT);

        for (const p of batchSlice) {
          const payId = p.id;
          tx.create(matchRef.collection("payments").doc(payId), {
            id: payId,
            matchId,
            playerId: p.id,
            status: "Not Playing",
            availability: "Pending",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        return {
          status: 200 as const,
          batchCreated: batchSlice.length,
          existingInTx: existingPlayerIds.size,
          hasMore: missingPlayers.length > batchSlice.length,
        };
      });

      if (chunkResult.status !== 200) {
        return NextResponse.json(
          { error: chunkResult.error },
          { status: chunkResult.status },
        );
      }

      if (!initialExistingRecorded) {
        existingCount = chunkResult.existingInTx;
        initialExistingRecorded = true;
      }
      createdCount += chunkResult.batchCreated;

      if (!chunkResult.hasMore) break;
    }
  } catch (err: any) {
    console.error("[initialize-payments] transaction failed:", err?.message || err);
    return NextResponse.json(
      { error: "Could not initialize player payment rows. Please retry." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    matchId,
    createdCount,
    existingCount,
    alreadyInitializedCount: existingCount,
  });
}
