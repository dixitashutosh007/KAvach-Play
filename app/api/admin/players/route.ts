import crypto from "node:crypto";
import { NextResponse } from "next/server.js";
import { FieldValue } from "firebase-admin/firestore";
import { requireClubAdmin } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { actorNameFor, writeServerAudit } from "../../../../lib/server-audit.ts";
import { allocateNextKavachId } from "../../../../lib/kavach-id.ts";

/**
 * Authoritative Club Admin player lifecycle API (`POST` create, `PATCH` disable/restore, `DELETE` delete).
 * Every mutation commits its `auditLogs` entry atomically in the same Firestore transaction.
 */
export async function POST(req: Request) {
  const auth = await requireClubAdmin(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const mobile = typeof body.mobile === "string" ? body.mobile.trim() : "";
  if (!name || !mobile) {
    return NextResponse.json({ error: "name and mobile are required." }, { status: 400 });
  }

  const rawId = typeof body.id === "string" ? body.id.trim() : "";
  const id = rawId && /^[a-zA-Z0-9_-]{1,128}$/.test(rawId) ? rawId : crypto.randomUUID();
  const db = getServerFirestore();

  let kavachId = typeof body.kavachId === "string" && body.kavachId.trim() ? body.kavachId.trim() : "";
  if (!kavachId) {
    const allocated = await allocateNextKavachId(db, { year: new Date().getFullYear() });
    kavachId = allocated.kavachId;
  }

  const actorName = await actorNameFor(db, auth.uid);
  const playerRef = db.collection("players").doc(id);

  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(playerRef);
      if (existing.exists) {
        throw new Error("PLAYER_ALREADY_EXISTS");
      }
      const allowedFields: Record<string, unknown> = {
        id,
        name,
        mobile,
        kavachId,
        inviteStatus: typeof body.inviteStatus === "string" && body.inviteStatus ? body.inviteStatus : "Unverified",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      for (const k of [
        "email", "dob", "locality", "bloodGroup", "emergencyContact",
        "battingStyle", "bowlingStyle", "isWicketKeeper", "chestSize",
        "waistSize", "jerseyNumber", "jerseyName", "photoURL", "kavachJoining", "isGuest",
      ]) {
        if (body[k] !== undefined) allowedFields[k] = body[k];
      }
      tx.create(playerRef, allowedFields);
      await writeServerAudit(
        db,
        {
          actorId: auth.uid,
          actorName,
          actorType: "admin",
          action: "created",
          entity: "player",
          entityId: id,
          entityLabel: name,
          changes: [{ field: "kavachId", newValue: kavachId }],
          summary: `Added player "${name}"`,
          id: `player_create_${id}`,
        },
        tx as any,
      );
    });
    return NextResponse.json({ ok: true, id, kavachId });
  } catch (err) {
    if (err instanceof Error && err.message === "PLAYER_ALREADY_EXISTS") {
      return NextResponse.json({ error: "Player already exists." }, { status: 409 });
    }
    console.error("[admin/players] POST failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not create player." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const auth = await requireClubAdmin(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const playerId = typeof body.playerId === "string" ? body.playerId.trim() : "";
  if (!playerId || playerId.includes("/")) {
    return NextResponse.json({ error: "Valid playerId is required." }, { status: 400 });
  }
  if (typeof body.disabled !== "boolean") {
    return NextResponse.json({ error: "disabled boolean is required." }, { status: 400 });
  }

  const db = getServerFirestore();
  const actorName = await actorNameFor(db, auth.uid);
  const playerRef = db.collection("players").doc(playerId);
  const opNonce = crypto.randomUUID().slice(0, 12);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(playerRef);
      if (!snap.exists) throw new Error("PLAYER_NOT_FOUND");
      const data = snap.data() || {};
      const wasDisabled = data.disabled === true;
      tx.update(playerRef, {
        disabled: body.disabled,
        ...(body.disabled ? { disabledAt: new Date().toISOString() } : { restoredAt: new Date().toISOString() }),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeServerAudit(
        db,
        {
          actorId: auth.uid,
          actorName,
          actorType: "admin",
          action: "status_change",
          entity: "player",
          entityId: playerId,
          entityLabel: String(data.name || playerId),
          changes: [{ field: "disabled", oldValue: String(wasDisabled), newValue: String(body.disabled) }],
          summary: `${body.disabled ? "Disabled" : "Restored"} player "${String(data.name || playerId)}"`,
          id: `player_status_${playerId}_${opNonce}`,
        },
        tx as any,
      );
    });
    return NextResponse.json({ ok: true, playerId, disabled: body.disabled });
  } catch (err) {
    if (err instanceof Error && err.message === "PLAYER_NOT_FOUND") {
      return NextResponse.json({ error: "Player not found." }, { status: 404 });
    }
    console.error("[admin/players] PATCH failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not update player status." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const auth = await requireClubAdmin(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const playerId = (url.searchParams.get("playerId") || "").trim();
  if (!playerId || playerId.includes("/")) {
    return NextResponse.json({ error: "Valid playerId is required." }, { status: 400 });
  }

  const db = getServerFirestore();
  const actorName = await actorNameFor(db, auth.uid);
  const playerRef = db.collection("players").doc(playerId);
  const opNonce = crypto.randomUUID().slice(0, 12);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(playerRef);
      if (!snap.exists) throw new Error("PLAYER_NOT_FOUND");
      const data = snap.data() || {};
      tx.delete(playerRef);
      if (typeof data.authUid === "string" && data.authUid) {
        tx.delete(db.collection("appUsers").doc(data.authUid));
      }
      await writeServerAudit(
        db,
        {
          actorId: auth.uid,
          actorName,
          actorType: "admin",
          action: "deleted",
          entity: "player",
          entityId: playerId,
          entityLabel: String(data.name || playerId),
          changes: [],
          summary: `Deleted player "${String(data.name || playerId)}"`,
          id: `player_delete_${playerId}_${opNonce}`,
        },
        tx as any,
      );
    });
    return NextResponse.json({ ok: true, playerId });
  } catch (err) {
    if (err instanceof Error && err.message === "PLAYER_NOT_FOUND") {
      return NextResponse.json({ error: "Player not found." }, { status: 404 });
    }
    console.error("[admin/players] DELETE failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not delete player." }, { status: 500 });
  }
}
