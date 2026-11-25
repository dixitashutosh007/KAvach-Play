/**
 * Finance Plan assignments API (`/api/finance/assignments`).
 *
 * GET  — list every assignment (Finance Admin and Super Admin only).
 * POST — change assignments (Finance Admin and Super Admin only):
 *   { action: "assign",     planId, playerIds[], startDate, endDate|null }
 *   { action: "end",        assignmentId, endDate, reason }
 *   { action: "cancel",     assignmentId, reason }             (not started yet)
 *   { action: "endLegacy",  playerId, planId, endDate, reason } (legacy feePlanIds entry)
 *
 * Authorisation is enforced here with the Admin SDK (not by the UI). Records
 * are never deleted: ending sets endDate, cancelling sets `cancelled`, and a
 * legacy plan id is converted into a dated, ended record before it is removed
 * from `player.feePlanIds`. Overlapping assignments for a player are rejected
 * (the whole request fails, nothing is written). Every change is audited.
 */
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireFinanceAdmin } from "@/lib/server-auth";
import { getServerFirestore } from "@/lib/server-db";
import { actorNameFor, writeServerAudit } from "@/lib/server-audit";
import { getClubCalendarDate } from "@/lib/utils";
import {
  conflictMessage,
  findConflict,
  isDateKey,
  legacyAssignmentsFor,
  validateAssignmentRange,
} from "@/lib/finance-plans";
import type { FeePlan, FinancePlanAssignment } from "@/lib/types";

const COLLECTION = "financePlanAssignments";
const MAX_PLAYERS_PER_REQUEST = 100;

export async function GET(req: Request) {
  const guard = await requireFinanceAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const db = getServerFirestore();
    const snap = await db.collection(COLLECTION).get();
    const assignments = snap.docs.map((d) => {
      const data = d.data();
      return {
        ...data,
        id: d.id,
        createdAt: data.createdAt?.toMillis?.() ?? null,
        endedAt: data.endedAt?.toMillis?.() ?? null,
      };
    });
    return NextResponse.json({ assignments });
  } catch (err) {
    console.error("[finance/assignments] GET failed", err);
    return NextResponse.json({ error: "Could not load plan assignments." }, { status: 500 });
  }
}

class RequestError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const cleanReason = (r: unknown) => (typeof r === "string" ? r.trim().slice(0, 300) : "");

export async function POST(req: Request) {
  const guard = await requireFinanceAdmin(req);
  if (!guard.ok) return guard.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const db = getServerFirestore();
  const actorId = guard.uid;
  const actorName = await actorNameFor(db, actorId);
  const todayKey = getClubCalendarDate().dateString;

  try {
    switch (body?.action) {
      case "assign":
        return NextResponse.json(await assign(db, body, actorId, actorName));
      case "end":
        return NextResponse.json(await endAssignment(db, body, actorId, actorName));
      case "cancel":
        return NextResponse.json(await cancelAssignment(db, body, actorId, actorName, todayKey));
      case "endLegacy":
        return NextResponse.json(await endLegacy(db, body, actorId, actorName));
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
    }
    console.error("[finance/assignments] POST failed", err);
    return NextResponse.json({ error: "The change could not be saved. Nothing was changed." }, { status: 500 });
  }
}

async function assign(db: FirebaseFirestore.Firestore, body: any, actorId: string, actorName: string) {
  const planId = typeof body.planId === "string" ? body.planId : "";
  const playerIds: string[] = Array.isArray(body.playerIds)
    ? Array.from(new Set(body.playerIds.filter((x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 128)))
    : [];
  const startDate = body.startDate;
  const endDate: string | null = body.endDate ? String(body.endDate) : null;
  if (!planId) throw new RequestError(400, "Choose a plan.");
  if (playerIds.length === 0) throw new RequestError(400, "Select at least one player.");
  if (playerIds.length > MAX_PLAYERS_PER_REQUEST) throw new RequestError(400, `Assign at most ${MAX_PLAYERS_PER_REQUEST} players at a time.`);

  return db.runTransaction(async (tx) => {
    const planSnap = await tx.get(db.collection("feePlans").doc(planId));
    if (!planSnap.exists) throw new RequestError(404, "That plan no longer exists.");
    const plan = { id: planSnap.id, ...(planSnap.data() as Omit<FeePlan, "id">) } as FeePlan;
    const rangeProblem = validateAssignmentRange(startDate, endDate, plan);
    if (rangeProblem) throw new RequestError(400, rangeProblem);

    const allPlansSnap = await tx.get(db.collection("feePlans"));
    const planNames = allPlansSnap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) || "Unknown plan" }));
    const playerSnaps = await Promise.all(playerIds.map((id) => tx.get(db.collection("players").doc(id))));
    const missing = playerSnaps.filter((s) => !s.exists).map((s) => s.id);
    if (missing.length) throw new RequestError(404, "Some selected players no longer exist.", { missing });

    // Existing assignments for these players (Firestore "in" takes ≤ 30 values).
    const existing: FinancePlanAssignment[] = [];
    for (let i = 0; i < playerIds.length; i += 30) {
      const chunk = playerIds.slice(i, i + 30);
      const snap = await tx.get(db.collection(COLLECTION).where("playerId", "in", chunk));
      snap.forEach((d) => existing.push({ id: d.id, ...(d.data() as Omit<FinancePlanAssignment, "id">) }));
    }

    const conflicts: { playerId: string; playerName: string; message: string }[] = [];
    for (const ps of playerSnaps) {
      const pdata = ps.data() || {};
      const name = (pdata.name as string) || "Player";
      if (pdata.disabled || pdata.mergedInto) {
        conflicts.push({ playerId: ps.id, playerName: name, message: `${name} is disabled or merged and can't be assigned.` });
        continue;
      }
      const legacy = legacyAssignmentsFor({ id: ps.id, feePlanIds: pdata.feePlanIds }, planNames);
      const conflict = findConflict([...existing, ...legacy], { playerId: ps.id, startDate: String(startDate), endDate });
      if (conflict) conflicts.push({ playerId: ps.id, playerName: name, message: conflictMessage(name, conflict) });
    }
    if (conflicts.length) {
      throw new RequestError(409, `${conflicts.length} player${conflicts.length === 1 ? " has" : "s have"} an overlapping plan. Nothing was assigned.`, { conflicts });
    }

    const created: string[] = [];
    for (const ps of playerSnaps) {
      const ref = db.collection(COLLECTION).doc();
      const name = (ps.data()?.name as string) || "Player";
      tx.set(ref, {
        id: ref.id,
        playerId: ps.id,
        planId: plan.id,
        planName: plan.name,
        startDate: String(startDate),
        endDate,
        createdBy: actorId,
        createdByName: actorName,
        createdAt: FieldValue.serverTimestamp(),
      });
      await writeServerAudit(
        db,
        {
          actorId,
          actorName,
          action: "created",
          entity: "fee_plan_assignment",
          entityId: ref.id,
          entityLabel: `${name} → ${plan.name}`,
          changes: [
            { field: "plan", newValue: plan.name },
            { field: "startDate", newValue: String(startDate) },
            { field: "endDate", newValue: endDate || "No end date" },
          ],
          summary: `Assigned ${name} to Finance Plan "${plan.name}" from ${startDate}${endDate ? ` to ${endDate}` : ""}`,
        },
        tx,
      );
      created.push(ref.id);
    }
    return { ok: true, created };
  });
}

async function endAssignment(db: FirebaseFirestore.Firestore, body: any, actorId: string, actorName: string) {
  const id = typeof body.assignmentId === "string" ? body.assignmentId : "";
  const endDate = body.endDate;
  if (!id) throw new RequestError(400, "Missing assignment.");
  if (!isDateKey(endDate)) throw new RequestError(400, "Choose a valid end date.");
  const reason = cleanReason(body.reason);
  return db.runTransaction(async (tx) => {
    const ref = db.collection(COLLECTION).doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new RequestError(404, "That assignment no longer exists.");
    const a = snap.data() as FinancePlanAssignment;
    if (a.cancelled) throw new RequestError(400, "This assignment was cancelled.");
    if (a.startDate && endDate < a.startDate) {
      throw new RequestError(400, "End date is before the start date. Cancel the assignment instead if it should not start.");
    }
    if (a.endDate && endDate > a.endDate) {
      throw new RequestError(400, `This assignment already ends on ${a.endDate}. Ending can only bring that date forward.`);
    }
    tx.update(ref, {
      endDate,
      endedBy: actorId,
      endedByName: actorName,
      endedAt: FieldValue.serverTimestamp(),
      endReason: reason,
    });
    await writeServerAudit(
      db,
      {
        actorId,
        actorName,
        action: "updated",
        entity: "fee_plan_assignment",
        entityId: id,
        entityLabel: a.planName,
        changes: [{ field: "endDate", oldValue: a.endDate || "No end date", newValue: endDate }],
        summary: `Ended Finance Plan "${a.planName}" for player ${a.playerId} on ${endDate}${reason ? ` — ${reason}` : ""}`,
      },
      tx,
    );
    return { ok: true };
  });
}

async function cancelAssignment(db: FirebaseFirestore.Firestore, body: any, actorId: string, actorName: string, todayKey: string) {
  const id = typeof body.assignmentId === "string" ? body.assignmentId : "";
  if (!id) throw new RequestError(400, "Missing assignment.");
  const reason = cleanReason(body.reason);
  return db.runTransaction(async (tx) => {
    const ref = db.collection(COLLECTION).doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new RequestError(404, "That assignment no longer exists.");
    const a = snap.data() as FinancePlanAssignment;
    if (a.cancelled) return { ok: true };
    if (!a.startDate || a.startDate <= todayKey) {
      throw new RequestError(400, "This assignment has already started; end it instead of cancelling.");
    }
    tx.update(ref, { cancelled: true, endedBy: actorId, endedByName: actorName, endedAt: FieldValue.serverTimestamp(), endReason: reason });
    await writeServerAudit(
      db,
      {
        actorId,
        actorName,
        action: "status_change",
        entity: "fee_plan_assignment",
        entityId: id,
        entityLabel: a.planName,
        changes: [{ field: "status", oldValue: "scheduled", newValue: "cancelled" }],
        summary: `Cancelled scheduled Finance Plan "${a.planName}" for player ${a.playerId}${reason ? ` — ${reason}` : ""}`,
      },
      tx,
    );
    return { ok: true };
  });
}

async function endLegacy(db: FirebaseFirestore.Firestore, body: any, actorId: string, actorName: string) {
  const playerId = typeof body.playerId === "string" ? body.playerId : "";
  const planId = typeof body.planId === "string" ? body.planId : "";
  const endDate = body.endDate;
  if (!playerId || !planId) throw new RequestError(400, "Missing player or plan.");
  if (!isDateKey(endDate)) throw new RequestError(400, "Choose a valid end date.");
  const reason = cleanReason(body.reason);
  return db.runTransaction(async (tx) => {
    const playerRef = db.collection("players").doc(playerId);
    const ps = await tx.get(playerRef);
    if (!ps.exists) throw new RequestError(404, "That player no longer exists.");
    const ids: string[] = ps.data()?.feePlanIds || [];
    if (!ids.includes(planId)) throw new RequestError(409, "This legacy plan is no longer on the player.");
    const planSnap = await tx.get(db.collection("feePlans").doc(planId));
    const planName = (planSnap.data()?.name as string) || "Unknown plan";
    const ref = db.collection(COLLECTION).doc();
    // Preserve the legacy assignment as a record (no recorded start) before
    // removing it from the player's legacy list.
    tx.set(ref, {
      id: ref.id,
      playerId,
      planId,
      planName,
      startDate: null,
      endDate,
      legacy: true,
      createdBy: actorId,
      createdByName: actorName,
      createdAt: FieldValue.serverTimestamp(),
      endedBy: actorId,
      endedByName: actorName,
      endedAt: FieldValue.serverTimestamp(),
      endReason: reason,
    });
    tx.update(playerRef, { feePlanIds: FieldValue.arrayRemove(planId), updatedAt: FieldValue.serverTimestamp() });
    await writeServerAudit(
      db,
      {
        actorId,
        actorName,
        action: "updated",
        entity: "fee_plan_assignment",
        entityId: ref.id,
        entityLabel: `${ps.data()?.name || "Player"} → ${planName}`,
        changes: [
          { field: "legacyPlan", oldValue: planName, newValue: `Ends ${endDate}` },
        ],
        summary: `Converted legacy Finance Plan "${planName}" for ${ps.data()?.name || "player"} into a dated record ending ${endDate}${reason ? ` — ${reason}` : ""}`,
      },
      tx,
    );
    return { ok: true, created: ref.id };
  });
}
