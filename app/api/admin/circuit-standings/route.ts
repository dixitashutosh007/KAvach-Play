/**
 * /api/admin/circuit-standings — Admin Club → Club Stats → Circuit Standings.
 *
 *   POST   { circuit, playerId, rank, value, asOf }        create a standing
 *   PUT    { id, circuit, playerId, rank, value, asOf }    edit a standing
 *   DELETE { id }                                         delete a standing
 *
 * Auth: Club Admin or Super Admin (requireClubAdmin — verified ID token, authoritative
 * appUsers record / admin claim; Finance Admins and players get 403). This route is
 * the ONLY writer of `circuitStandings`; Firestore rules deny all client writes.
 *
 * The server validates every field (lib/circuit-standings.ts), checks the player
 * exists and is active/not merged, snapshots the player's name, keeps one record per
 * (circuit, player) via the deterministic id, and audits every change in the same
 * transaction.
 */
import { NextResponse } from "next/server.js";
import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { requireClubAdmin } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { actorNameFor, writeServerAudit } from "../../../../lib/server-audit.ts";
import {
  CIRCUIT_STANDINGS_COLLECTION,
  circuitInfo,
  isSelectablePlayer,
  readStoredStanding,
  standingDocId,
  validateCircuitStandingInput,
} from "../../../../lib/circuit-standings.ts";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const ID_RE = /^[a-z-]+__[A-Za-z0-9_-]{1,128}$/;

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? b : null;
  } catch {
    return null;
  }
}

function label(circuit: string, playerName: string) {
  const c = circuitInfo(circuit);
  return `${c ? `${c.scope} – ${c.metric}` : circuit}: ${playerName}`;
}

function fail(err: unknown, what: string) {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(`[circuit-standings] ${what} failed`);
  return NextResponse.json({ error: `Could not ${what} the standing. Nothing was changed; try again.` }, { status: 500 });
}

async function guarded(req: Request) {
  const guard = await requireClubAdmin(req);
  if (!guard.ok) return { response: guard.response } as const;
  const body = await readJson(req);
  if (!body) return { response: NextResponse.json({ error: "Invalid request." }, { status: 400 }) } as const;
  return { uid: guard.uid, body } as const;
}

async function playerName(tx: Transaction, db: Firestore, playerId: string): Promise<string> {
  const snap = await tx.get(db.collection("players").doc(playerId));
  if (!snap.exists) throw new HttpError(400, "That player no longer exists.");
  const p = snap.data() || {};
  if (!isSelectablePlayer(p)) throw new HttpError(400, "That player is inactive or merged and cannot be ranked.");
  const name = typeof p.name === "string" ? p.name.trim() : "";
  return name || "Player";
}

export async function POST(req: Request) {
  const g = await guarded(req);
  if ("response" in g) return g.response;
  const parsed = validateCircuitStandingInput(g.body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;
  const db = getServerFirestore();
  try {
    const actorName = await actorNameFor(db, g.uid);
    const id = standingDocId(v.circuit, v.playerId);
    const result = await db.runTransaction(async (tx) => {
      const ref = db.collection(CIRCUIT_STANDINGS_COLLECTION).doc(id);
      const existing = await tx.get(ref);
      const name = await playerName(tx, db, v.playerId);
      if (existing.exists) throw new HttpError(409, `${name} already has a standing in this circuit. Edit that record instead.`);
      tx.create(ref, { ...v, playerName: name, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: g.uid });
      await writeServerAudit(
        db,
        {
          actorId: g.uid,
          actorName,
          action: "created",
          entity: "circuit_standing",
          entityId: id,
          entityLabel: label(v.circuit, name),
          changes: [
            { field: "rank", newValue: String(v.rank) },
            { field: "value", newValue: String(v.value) },
            { field: "asOf", newValue: v.asOf },
          ],
          summary: `Added circuit standing ${label(v.circuit, name)} (#${v.rank}, ${v.value}).`,
        },
        tx,
      );
      return { id, playerName: name };
    });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    return fail(err, "add");
  }
}

export async function PUT(req: Request) {
  const g = await guarded(req);
  if ("response" in g) return g.response;
  const { id: rawId, ...rest } = g.body;
  if (typeof rawId !== "string" || !ID_RE.test(rawId)) return NextResponse.json({ error: "Missing or invalid standing id." }, { status: 400 });
  const parsed = validateCircuitStandingInput(rest);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;
  const db = getServerFirestore();
  try {
    const actorName = await actorNameFor(db, g.uid);
    const newId = standingDocId(v.circuit, v.playerId);
    const result = await db.runTransaction(async (tx) => {
      const col = db.collection(CIRCUIT_STANDINGS_COLLECTION);
      const oldRef = col.doc(rawId);
      const oldSnap = await tx.get(oldRef);
      if (!oldSnap.exists) throw new HttpError(404, "That standing no longer exists. Refresh and try again.");
      const before = readStoredStanding(rawId, oldSnap.data());
      const newRef = col.doc(newId);
      if (newId !== rawId && (await tx.get(newRef)).exists) {
        throw new HttpError(409, "That player already has a standing in this circuit. Edit that record instead.");
      }
      const name = await playerName(tx, db, v.playerId);
      const changes: { field: string; oldValue?: string; newValue?: string }[] = [];
      const cmp: [string, unknown, unknown][] = [
        ["circuit", before?.circuit, v.circuit],
        ["player", before?.playerName, name],
        ["rank", before?.rank, v.rank],
        ["value", before?.value, v.value],
        ["asOf", before?.asOf, v.asOf],
      ];
      for (const [field, o, n] of cmp) if (String(o ?? "") !== String(n)) changes.push({ field, oldValue: o === undefined ? undefined : String(o), newValue: String(n) });
      if (!changes.length) return { id: rawId, changed: false, playerName: name };

      const data = { ...v, playerName: name, updatedAt: FieldValue.serverTimestamp(), updatedBy: g.uid };
      if (newId === rawId) {
        tx.update(oldRef, data);
      } else {
        // Circuit or player changed: the record moves to its new (circuit, player) id.
        tx.create(newRef, { ...data, createdAt: oldSnap.data()?.createdAt ?? FieldValue.serverTimestamp() });
        tx.delete(oldRef);
      }
      await writeServerAudit(
        db,
        {
          actorId: g.uid,
          actorName,
          action: "updated",
          entity: "circuit_standing",
          entityId: newId,
          entityLabel: label(v.circuit, name),
          changes,
          summary: `Edited circuit standing ${label(v.circuit, name)}.`,
        },
        tx,
      );
      return { id: newId, changed: true, playerName: name };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return fail(err, "save");
  }
}

export async function DELETE(req: Request) {
  const g = await guarded(req);
  if ("response" in g) return g.response;
  const { id } = g.body;
  if (typeof id !== "string" || !ID_RE.test(id) || Object.keys(g.body).length !== 1) {
    return NextResponse.json({ error: "Missing or invalid standing id." }, { status: 400 });
  }
  const db = getServerFirestore();
  try {
    const actorName = await actorNameFor(db, g.uid);
    await db.runTransaction(async (tx) => {
      const ref = db.collection(CIRCUIT_STANDINGS_COLLECTION).doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpError(404, "That standing no longer exists.");
      const s = readStoredStanding(id, snap.data());
      tx.delete(ref);
      await writeServerAudit(
        db,
        {
          actorId: g.uid,
          actorName,
          action: "deleted",
          entity: "circuit_standing",
          entityId: id,
          entityLabel: s ? label(s.circuit, s.playerName) : id,
          changes: s
            ? [
                { field: "rank", oldValue: String(s.rank) },
                { field: "value", oldValue: String(s.value) },
                { field: "asOf", oldValue: s.asOf },
              ]
            : [],
          summary: `Deleted circuit standing ${s ? label(s.circuit, s.playerName) : id}.`,
        },
        tx,
      );
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return fail(err, "delete");
  }
}
