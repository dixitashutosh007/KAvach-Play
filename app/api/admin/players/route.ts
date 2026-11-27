import crypto from "node:crypto";
import { NextResponse } from "next/server.js";
import { FieldValue } from "firebase-admin/firestore";
import { requireClubAdmin } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { actorNameFor, writeServerAudit } from "../../../../lib/server-audit.ts";
import { allocateNextKavachId } from "../../../../lib/kavach-id.ts";
import { inspectAndUnlinkPlayerIdentityInTx, LinkingError } from "../../../../lib/account-linking.ts";

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
  const allowUnlink = url.searchParams.get("unlink") === "true";
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
      const [
        paymentsSnap,
        feesSnap,
        groupFeesSnap,
        ordersSnap,
        subHistorySnap,
        statsSnap,
        badgesSnap,
        catchSnap,
        outOfPlaySnap,
        commentsSnap,
        captainMatchesSnap,
        potmMatchesSnap,
        topPerfMatchesSnap,
        potmStringMatchesSnap,
        bestBatMatchesSnap,
        bestBowlMatchesSnap,
        potwPostsSnap,
        pollResponsesSnap,
        reservationsSnap,
        clubLeadsSnap,
      ] = await Promise.all([
        tx.get(db.collectionGroup("payments").where("playerId", "==", playerId).limit(1)),
        tx.get(playerRef.collection("otherFees").limit(1)),
        tx.get(db.collectionGroup("otherFees").where("playerId", "==", playerId).limit(1)),
        tx.get(db.collection("merchOrders").where("playerId", "==", playerId).limit(1)),
        tx.get(db.collection("subscriptionHistory").where("playerId", "==", playerId).limit(1)),
        tx.get(db.collection("playerStats").where("playerId", "==", playerId).limit(1)),
        tx.get(db.collection("badges").where("playerId", "==", playerId).limit(1)),
        tx.get(db.collection("catchLog").where("playerId", "==", playerId).limit(1)),
        tx.get(db.collection("outOfPlays").where("playerId", "==", playerId).limit(1)),
        tx.get(db.collectionGroup("comments").where("playerId", "==", playerId).limit(1)),
        tx.get(db.collection("matches").where("captainId", "==", playerId).limit(1)),
        tx.get(db.collection("matches").where("potmId", "==", playerId).limit(1)),
        tx.get(db.collection("matches").where("topPerformerIds", "array-contains", playerId).limit(1)),
        tx.get(db.collection("matches").where("playerOfTheMatch", "==", playerId).limit(1)),
        tx.get(db.collection("matches").where("bestBatsman", "==", playerId).limit(1)),
        tx.get(db.collection("matches").where("bestBowler", "==", playerId).limit(1)),
        tx.get(db.collection("posts").where("potw.playerId", "==", playerId).limit(1)),
        tx.get(db.collection("pollResponses").where("playerId", "==", playerId).limit(1)),
        tx.get(db.collection("paymentReservations").where("playerId", "==", playerId).limit(1)),
        tx.get(db.collection("clubLeads").where("convertedPlayerId", "==", playerId).limit(1)),
      ]);
      const data = snap.data() || {};
      const hasPlanAssignments = Array.isArray(data.feePlanIds) && data.feePlanIds.length > 0;
      if (
        !paymentsSnap.empty ||
        !feesSnap.empty ||
        !groupFeesSnap.empty ||
        !ordersSnap.empty ||
        !subHistorySnap.empty ||
        !statsSnap.empty ||
        !badgesSnap.empty ||
        !catchSnap.empty ||
        !outOfPlaySnap.empty ||
        !commentsSnap.empty ||
        !captainMatchesSnap.empty ||
        !potmMatchesSnap.empty ||
        !topPerfMatchesSnap.empty ||
        !potmStringMatchesSnap.empty ||
        !bestBatMatchesSnap.empty ||
        !bestBowlMatchesSnap.empty ||
        !potwPostsSnap.empty ||
        !pollResponsesSnap.empty ||
        !reservationsSnap.empty ||
        !clubLeadsSnap.empty ||
        hasPlanAssignments
      ) {
        throw new Error("PLAYER_HAS_HISTORY");
      }
      await inspectAndUnlinkPlayerIdentityInTx(db, tx as any, {
        playerId,
        playerData: data,
        allowUnlink,
        actorUid: auth.uid,
        actorName,
        auditId: `player_unlink_${playerId}_${opNonce}`,
      });
      tx.delete(playerRef);
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
    if (err instanceof LinkingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Error && err.message === "PLAYER_NOT_FOUND") {
      return NextResponse.json({ error: "Player not found." }, { status: 404 });
    }
    if (err instanceof Error && err.message === "PLAYER_HAS_HISTORY") {
      return NextResponse.json(
        { error: "Player has historical financial or match records; disable instead of deleting." },
        { status: 409 },
      );
    }
    console.error("[admin/players] DELETE failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not delete player." }, { status: 500 });
  }
}
