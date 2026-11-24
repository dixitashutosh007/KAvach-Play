/**
 * /api/admin/circuit-standings — Admin Club → Club Stats → Circuit Standings.
 *
 * The club's own rank and total in each of the four circuits.
 *   PUT    { circuit, rank, value }   set (create or update) that circuit's standing
 *   DELETE { circuit }                clear that circuit's standing
 *
 * Auth: Club Admin or Super Admin (requireClubAdmin — verified ID token, authoritative
 * appUsers record / admin claim; Finance Admins and players get 403). This route is
 * the ONLY writer of `circuitStandings`; Firestore rules deny all client writes.
 * Every change is audited in the same transaction.
 */
import { NextResponse } from "next/server.js";
import { FieldValue } from "firebase-admin/firestore";
import { requireClubAdmin } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { actorNameFor, writeServerAudit } from "../../../../lib/server-audit.ts";
import {
  CIRCUIT_STANDINGS_COLLECTION,
  circuitInfo,
  formatStanding,
  isCircuitKey,
  readStoredStanding,
  validateCircuitStandingInput,
} from "../../../../lib/circuit-standings.ts";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function guarded(req: Request) {
  const guard = await requireClubAdmin(req);
  if (!guard.ok) return { response: guard.response } as const;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { response: NextResponse.json({ error: "Invalid request." }, { status: 400 }) } as const;
  }
  return { uid: guard.uid, body: body as Record<string, unknown> } as const;
}

function fail(err: unknown, what: string) {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(`[circuit-standings] ${what} failed`);
  return NextResponse.json({ error: `Could not ${what} the standing. Nothing was changed; try again.` }, { status: 500 });
}

const label = (circuit: string) => {
  const c = circuitInfo(circuit)!;
  return `${c.scope} – ${c.metric}`;
};

export async function PUT(req: Request) {
  const g = await guarded(req);
  if ("response" in g) return g.response;
  const parsed = validateCircuitStandingInput(g.body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;
  const db = getServerFirestore();
  try {
    const actorName = await actorNameFor(db, g.uid);
    const result = await db.runTransaction(async (tx) => {
      const ref = db.collection(CIRCUIT_STANDINGS_COLLECTION).doc(v.circuit);
      const snap = await tx.get(ref);
      const before = snap.exists ? readStoredStanding(v.circuit, snap.data()) : null;
      if (before && before.rank === v.rank && before.value === v.value) return { changed: false };
      tx.set(ref, { circuit: v.circuit, rank: v.rank, value: v.value, updatedAt: FieldValue.serverTimestamp(), updatedBy: g.uid });
      const changes: { field: string; oldValue?: string; newValue?: string }[] = [];
      // Firestore rejects `undefined`, so a first save records only the new values.
      if (before?.rank !== v.rank) changes.push({ field: "rank", ...(before ? { oldValue: String(before.rank) } : {}), newValue: String(v.rank) });
      if (before?.value !== v.value) changes.push({ field: "value", ...(before ? { oldValue: String(before.value) } : {}), newValue: String(v.value) });
      await writeServerAudit(
        db,
        {
          actorId: g.uid,
          actorName,
          action: before ? "updated" : "created",
          entity: "circuit_standing",
          entityId: v.circuit,
          entityLabel: label(v.circuit),
          changes,
          summary: `Circuit standing ${label(v.circuit)} set to ${formatStanding(v)}.`,
        },
        tx,
      );
      return { changed: true };
    });
    return NextResponse.json({ ok: true, ...v, ...result });
  } catch (err) {
    return fail(err, "save");
  }
}

export async function DELETE(req: Request) {
  const g = await guarded(req);
  if ("response" in g) return g.response;
  const { circuit } = g.body;
  if (!isCircuitKey(circuit) || Object.keys(g.body).length !== 1) {
    return NextResponse.json({ error: "Choose one of the four circuits." }, { status: 400 });
  }
  const db = getServerFirestore();
  try {
    const actorName = await actorNameFor(db, g.uid);
    await db.runTransaction(async (tx) => {
      const ref = db.collection(CIRCUIT_STANDINGS_COLLECTION).doc(circuit);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpError(404, "That circuit has no standing to clear.");
      const before = readStoredStanding(circuit, snap.data());
      tx.delete(ref);
      await writeServerAudit(
        db,
        {
          actorId: g.uid,
          actorName,
          action: "deleted",
          entity: "circuit_standing",
          entityId: circuit,
          entityLabel: label(circuit),
          changes: before
            ? [
                { field: "rank", oldValue: String(before.rank) },
                { field: "value", oldValue: String(before.value) },
              ]
            : [],
          summary: `Circuit standing ${label(circuit)} cleared.`,
        },
        tx,
      );
    });
    return NextResponse.json({ ok: true, circuit });
  } catch (err) {
    return fail(err, "clear");
  }
}
