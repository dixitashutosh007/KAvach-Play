/**
 * POST /api/admin/matches/payment-action
 *
 * Server-authoritative, transactional handler for match squad & payment
 * operations that previously wrote to Firestore from the client and failed
 * audit logging with 403 (`entity: "payment"`).
 *
 * Actions:
 *   - addSquadPlayer     (clubAdmin | superAdmin | financeAdmin)
 *   - updatePaymentStatus (squad Unpaid/Not Playing: clubAdmin+; Paid/Waived/fees: financeAdmin+)
 *   - clearFeeOverride   (financeAdmin | superAdmin)
 *   - assignProxyPayment (financeAdmin | superAdmin)
 *   - applyLegacyPlan    (financeAdmin | superAdmin)
 *
 * Every action executes business writes and `writeServerAudit()` inside a single
 * Firestore transaction, deriving `actorId` and `actorName` authoritatively.
 */
import crypto from "crypto";
import { NextResponse } from "next/server.js";
import { FieldValue } from "firebase-admin/firestore";
import { requireRole } from "../../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../../lib/server-db.ts";
import { actorNameFor, writeServerAudit } from "../../../../../lib/server-audit.ts";
import { isSafeId } from "../../../../../lib/weekend-ops-server.ts";

class RequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const SQUAD_ROLES = ["clubAdmin", "superAdmin", "financeAdmin"] as const;
const FINANCE_ROLES = ["financeAdmin", "superAdmin"] as const;
const VALID_STATUSES = new Set(["Paid", "Unpaid", "Not Playing", "Waived"]);

function safeAuditIdFromKey(
  rawKey: unknown,
  uid: string,
  action: string,
  matchId: string,
  resourceId: string,
): string | undefined {
  if (typeof rawKey !== "string") return undefined;
  const trimmed = rawKey.trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(trimmed)) return undefined;
  const scoped = crypto
    .createHash("sha256")
    .update(`${uid}:${action}:${matchId}:${resourceId}:${trimmed}`)
    .digest("hex")
    .slice(0, 32);
  return `payact_${scoped}`;
}

export async function POST(req: Request) {
  const auth = await requireRole(req, [...SQUAD_ROLES]);
  if (!auth.ok) return auth.response;

  let body: Record<string, any>;
  try {
    body = (await req.json()) as Record<string, any>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = typeof body?.action === "string" ? body.action.trim() : "";
  const matchId = typeof body?.matchId === "string" ? body.matchId.trim() : "";
  if (!isSafeId(matchId)) {
    return NextResponse.json({ error: "Valid matchId is required." }, { status: 400 });
  }

  const isFinanceActor =
    auth.roles.has("financeAdmin") || auth.roles.has("superAdmin");

  const requiresFinanceRole =
    action === "clearFeeOverride" ||
    action === "assignProxyPayment" ||
    action === "applyLegacyPlan" ||
    (action === "updatePaymentStatus" &&
      (body.status === "Paid" ||
        body.status === "Waived" ||
        body.paymentMethod !== undefined ||
        body.manualMethod !== undefined ||
        body.feeCollectedAmount !== undefined ||
        body.feeOffsetAmount !== undefined));

  if (requiresFinanceRole && !isFinanceActor) {
    return NextResponse.json(
      { error: "Only Finance Admins or Super Admins can perform this payment action." },
      { status: 403 },
    );
  }

  const db = getServerFirestore();
  const actorName = await actorNameFor(db, auth.uid);
  const matchRef = db.collection("matches").doc(matchId);
  const resourceId = String(body.paymentId || body.sourcePaymentId || body.playerId || "").trim();
  const safeAuditId = safeAuditIdFromKey(body?.idempotencyKey, auth.uid, action, matchId, resourceId);
  const requestHash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        action,
        matchId,
        paymentId: typeof body.paymentId === "string" ? body.paymentId.trim() : null,
        playerId: typeof body.playerId === "string" ? body.playerId.trim() : null,
        status: typeof body.status === "string" ? body.status.trim() : null,
        availability: typeof body.availability === "string" ? body.availability.trim() : null,
        guestName: typeof body.guestName === "string" ? body.guestName.trim() : null,
        paymentMethod: typeof body.paymentMethod === "string" ? body.paymentMethod.trim() : null,
        manualMethod: typeof body.manualMethod === "string" ? body.manualMethod.trim() : null,
        feeCollectedAmount: body.feeCollectedAmount !== undefined && body.feeCollectedAmount !== null ? Number(body.feeCollectedAmount) : null,
        feeOffsetAmount: body.feeOffsetAmount !== undefined && body.feeOffsetAmount !== null ? Number(body.feeOffsetAmount) : null,
        sourcePaymentId: typeof body.sourcePaymentId === "string" ? body.sourcePaymentId.trim() : null,
        targetPlayerId: typeof body.targetPlayerId === "string" ? body.targetPlayerId.trim() : null,
        feeOverride: body.feeOverride !== undefined && body.feeOverride !== null ? Number(body.feeOverride) : null,
        planTag: typeof body.planTag === "string" ? body.planTag.trim() : null,
      }),
    )
    .digest("hex");

  try {
    const result = await db.runTransaction(async (tx) => {
      if (safeAuditId) {
        const auditSnap = await tx.get(db.collection("auditLogs").doc(safeAuditId));
        if (auditSnap.exists) {
          if (auditSnap.data()?.requestHash === requestHash) {
            return { deduplicated: true };
          }
          throw new RequestError(409, "Idempotency key already used with a different payload.");
        }
      }

      const matchSnap = await tx.get(matchRef);
      if (!matchSnap.exists) {
        throw new RequestError(404, `Match ${matchId} not found.`);
      }
      const match = matchSnap.data() || {};
      const matchLabel = match.opponent ? `vs ${match.opponent}` : matchId;

      if (action === "addSquadPlayer") {
        if (match.financeStatus === "closed") {
          throw new RequestError(409, "Match finances are closed; cannot add squad players.");
        }
        const playerId = typeof body.playerId === "string" ? body.playerId.trim() : "";
        if (!isSafeId(playerId)) {
          throw new RequestError(400, "Valid playerId is required.");
        }
        const status = typeof body.status === "string" && VALID_STATUSES.has(body.status)
          ? body.status
          : "Unpaid";
        if ((status === "Paid" || status === "Waived") && !isFinanceActor) {
          throw new RequestError(403, "Only Finance Admins can add a player directly as Paid or Waived.");
        }
        const availability = typeof body.availability === "string" && body.availability.trim()
          ? body.availability.trim()
          : "Confirmed";
        const guestName = typeof body.guestName === "string" && body.guestName.trim()
          ? body.guestName.trim().slice(0, 120)
          : undefined;

        const playerSnap = await tx.get(db.collection("players").doc(playerId));
        if (!playerSnap.exists) {
          throw new RequestError(404, `Player ${playerId} not found.`);
        }
        const pName = String(playerSnap.data()?.name || playerId);

        const paymentId = typeof body.paymentId === "string" && isSafeId(body.paymentId.trim())
          ? body.paymentId.trim()
          : crypto.randomUUID();
        const payRef = matchRef.collection("payments").doc(paymentId);
        const existingPay = await tx.get(payRef);
        if (existingPay.exists) {
          throw new RequestError(409, `Payment record ${paymentId} already exists.`);
        }

        const docData: Record<string, unknown> = {
          id: paymentId,
          matchId,
          playerId,
          status,
          availability,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (guestName) docData.guestName = guestName;
        tx.create(payRef, docData);

        await writeServerAudit(
          db,
          {
            ...(safeAuditId ? { id: safeAuditId } : {}),
            requestHash,
            actorId: auth.uid,
            actorName,
            action: "created",
            entity: "payment",
            entityId: paymentId,
            entityLabel: `${pName} - ${match.opponent || matchId}`,
            changes: [
              { field: "status", newValue: status },
              { field: "availability", newValue: availability },
              ...(guestName ? [{ field: "guestName", newValue: guestName }] : []),
            ],
            summary: `Added ${guestName ? `guest "${guestName}"` : pName} to match ${matchLabel}`,
          },
          tx,
        );
        return { paymentId, status, availability };
      }

      if (action === "updatePaymentStatus") {
        const paymentId = typeof body.paymentId === "string" ? body.paymentId.trim() : "";
        const status = typeof body.status === "string" ? body.status.trim() : "";
        if (!isSafeId(paymentId) || !VALID_STATUSES.has(status)) {
          throw new RequestError(400, "Valid paymentId and status are required.");
        }

        const payRef = matchRef.collection("payments").doc(paymentId);
        const paySnap = await tx.get(payRef);
        if (!paySnap.exists) {
          throw new RequestError(404, `Payment record ${paymentId} not found.`);
        }
        const prev = paySnap.data() || {};
        if (match.financeStatus === "closed" && prev.status === "Not Playing" && status !== "Not Playing") {
          throw new RequestError(409, "Match finances are closed; cannot reactivate Not Playing row.");
        }

        const playerSnap = prev.playerId ? await tx.get(db.collection("players").doc(String(prev.playerId))) : null;
        const pName = String(playerSnap?.data()?.name || prev.playerId || "Player");

        const updates: Record<string, unknown> = {
          status,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (typeof body.availability === "string" && body.availability.trim()) {
          updates.availability = body.availability.trim();
        }
        if (typeof body.paymentMethod === "string" && body.paymentMethod.trim()) {
          updates.paymentMethod = body.paymentMethod.trim();
        }
        if (typeof body.manualMethod === "string" && body.manualMethod.trim()) {
          updates.manualMethod = body.manualMethod.trim();
        }
        // Never trust client-supplied manualBy; derive from authenticated server actor.
        if (status === "Paid" || updates.paymentMethod === "manual" || updates.manualMethod !== undefined) {
          updates.manualBy = actorName;
        }
        if (body.feeCollectedAmount !== undefined && Number.isFinite(Number(body.feeCollectedAmount))) {
          updates.feeCollectedAmount = Number(body.feeCollectedAmount);
        }
        if (body.feeOffsetAmount !== undefined && Number.isFinite(Number(body.feeOffsetAmount))) {
          updates.feeOffsetAmount = Number(body.feeOffsetAmount);
        }

        tx.update(payRef, updates);

        const changes: { field: string; oldValue?: string; newValue?: string }[] = [];
        if (prev.status !== status) {
          changes.push({ field: "status", oldValue: String(prev.status || ""), newValue: status });
        }
        if (updates.availability && prev.availability !== updates.availability) {
          changes.push({
            field: "availability",
            ...(prev.availability ? { oldValue: String(prev.availability) } : {}),
            newValue: String(updates.availability),
          });
        }
        if (updates.paymentMethod && prev.paymentMethod !== updates.paymentMethod) {
          changes.push({
            field: "paymentMethod",
            ...(prev.paymentMethod ? { oldValue: String(prev.paymentMethod) } : {}),
            newValue: String(updates.paymentMethod),
          });
        }
        if (updates.manualMethod && prev.manualMethod !== updates.manualMethod) {
          changes.push({
            field: "manualMethod",
            ...(prev.manualMethod ? { oldValue: String(prev.manualMethod) } : {}),
            newValue: String(updates.manualMethod),
          });
        }
        if (updates.manualBy && prev.manualBy !== updates.manualBy) {
          changes.push({
            field: "manualBy",
            ...(prev.manualBy ? { oldValue: String(prev.manualBy) } : {}),
            newValue: String(updates.manualBy),
          });
        }
        if (updates.feeCollectedAmount !== undefined && prev.feeCollectedAmount !== updates.feeCollectedAmount) {
          changes.push({
            field: "feeCollectedAmount",
            ...(prev.feeCollectedAmount !== undefined ? { oldValue: `₹${prev.feeCollectedAmount}` } : {}),
            newValue: `₹${updates.feeCollectedAmount}`,
          });
        }
        if (updates.feeOffsetAmount !== undefined && prev.feeOffsetAmount !== updates.feeOffsetAmount) {
          changes.push({
            field: "feeOffsetAmount",
            ...(prev.feeOffsetAmount !== undefined ? { oldValue: `₹${prev.feeOffsetAmount}` } : {}),
            newValue: `₹${updates.feeOffsetAmount}`,
          });
        }

        await writeServerAudit(
          db,
          {
            ...(safeAuditId ? { id: safeAuditId } : {}),
            requestHash,
            actorId: auth.uid,
            actorName,
            action: status === "Paid" ? "paid" : "status_change",
            entity: "payment",
            entityId: paymentId,
            entityLabel: `${pName} - ${match.opponent || matchId}`,
            changes,
            summary: `${pName} ${status === "Paid" ? "paid" : `status → ${status}`} for match ${matchLabel}`,
          },
          tx,
        );
        return { paymentId, status };
      }

      if (action === "clearFeeOverride") {
        if (match.financeStatus === "closed") {
          throw new RequestError(409, "Match finances are closed; cannot clear fee override.");
        }
        const paymentId = typeof body.paymentId === "string" ? body.paymentId.trim() : "";
        if (!isSafeId(paymentId)) {
          throw new RequestError(400, "Valid paymentId is required.");
        }
        const payRef = matchRef.collection("payments").doc(paymentId);
        const paySnap = await tx.get(payRef);
        if (!paySnap.exists) {
          throw new RequestError(404, `Payment record ${paymentId} not found.`);
        }
        const prev = paySnap.data() || {};
        const playerSnap = prev.playerId ? await tx.get(db.collection("players").doc(String(prev.playerId))) : null;
        const playerName = String(playerSnap?.data()?.name || prev.playerId || "Player");

        const shouldRevertToUnpaid =
          prev.status === "Paid" &&
          (prev.manualMethod === "club_sponsored" ||
            prev.manualMethod === "part_of_plan" ||
            Boolean(prev.sponsoredBy));

        const clearFields: Record<string, unknown> = {
          feeOverride: FieldValue.delete(),
          planTag: FieldValue.delete(),
          feeOffsetAmount: FieldValue.delete(),
          feeCollectedAmount: FieldValue.delete(),
          sponsoredBy: FieldValue.delete(),
          sponsoring: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (shouldRevertToUnpaid) {
          clearFields.status = "Unpaid";
          clearFields.paymentMethod = FieldValue.delete();
          clearFields.manualMethod = FieldValue.delete();
          clearFields.manualBy = FieldValue.delete();
        }

        let clearedSponsorId: string | null = null;
        if (prev.sponsoredBy) {
          const sponsorSnap = await tx.get(
            matchRef.collection("payments").where("playerId", "==", String(prev.sponsoredBy)).limit(1),
          );
          if (!sponsorSnap.empty) {
            const sponsorDoc = sponsorSnap.docs[0];
            clearedSponsorId = sponsorDoc.id;
            tx.update(sponsorDoc.ref, {
              feeOverride: FieldValue.delete(),
              sponsoring: FieldValue.delete(),
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
        }
        tx.update(payRef, clearFields);

        const changes: { field: string; oldValue?: string; newValue?: string }[] = [
          {
            field: "feeOverride",
            ...(prev.feeOverride !== undefined ? { oldValue: `₹${prev.feeOverride}` } : {}),
            newValue: "standard",
          },
        ];
        if (shouldRevertToUnpaid) {
          changes.push({ field: "status", oldValue: String(prev.status), newValue: "Unpaid" });
        }
        if (prev.planTag) {
          changes.push({ field: "planTag", oldValue: String(prev.planTag), newValue: "cleared" });
        }

        await writeServerAudit(
          db,
          {
            ...(safeAuditId ? { id: safeAuditId } : {}),
            requestHash,
            actorId: auth.uid,
            actorName,
            action: "updated",
            entity: "payment",
            entityId: paymentId,
            entityLabel: `${playerName} fee reset`,
            changes,
            summary: `Reset fee to standard for ${playerName} (${matchLabel})`,
          },
          tx,
        );
        return { paymentId, shouldRevertToUnpaid, clearedSponsorId };
      }

      if (action === "assignProxyPayment") {
        if (match.financeStatus === "closed") {
          throw new RequestError(409, "Match finances are closed; cannot assign proxy payment.");
        }
        const sourcePaymentId = typeof body.sourcePaymentId === "string" ? body.sourcePaymentId.trim() : "";
        const targetPlayerId = typeof body.targetPlayerId === "string" ? body.targetPlayerId.trim() : "";
        if (!isSafeId(sourcePaymentId) || !isSafeId(targetPlayerId)) {
          throw new RequestError(400, "Valid sourcePaymentId and targetPlayerId are required.");
        }

        const sourceRef = matchRef.collection("payments").doc(sourcePaymentId);
        const sourceSnap = await tx.get(sourceRef);
        if (!sourceSnap.exists) {
          throw new RequestError(404, `Source payment ${sourcePaymentId} not found in match ${matchId}.`);
        }
        const sourcePrev = sourceSnap.data() || {};
        if (sourcePrev.matchId && sourcePrev.matchId !== matchId) {
          throw new RequestError(409, "Source payment does not belong to the requested match.");
        }
        if (sourcePrev.playerId === targetPlayerId) {
          throw new RequestError(400, "Cannot assign a player as their own proxy sponsor.");
        }
        if (sourcePrev.status === "Paid" || sourcePrev.sponsoredBy) {
          throw new RequestError(409, "Source payment is already paid or sponsored.");
        }
        if (sourcePrev.sponsoring) {
          throw new RequestError(409, "Circular sponsorship is not allowed: source player is already sponsoring another player.");
        }

        const targetQuerySnap = await tx.get(
          matchRef.collection("payments").where("playerId", "==", targetPlayerId).limit(1),
        );
        if (targetQuerySnap.empty) {
          throw new RequestError(404, `Target player payment for ${targetPlayerId} not found in match ${matchId}.`);
        }
        const targetDoc = targetQuerySnap.docs[0];
        if (targetDoc.id === sourcePaymentId) {
          throw new RequestError(400, "Source and target payment records cannot be identical.");
        }
        const targetPrev = targetDoc.data() || {};
        if (targetPrev.matchId && targetPrev.matchId !== matchId) {
          throw new RequestError(409, "Target payment does not belong to the requested match.");
        }
        if (targetPrev.sponsoredBy) {
          throw new RequestError(409, "Circular sponsorship is not allowed: target player is already sponsored.");
        }

        // Derive authoritative amounts strictly from server-side match and payment records.
        const authoritativeMatchFee = Number(match.fee ?? 0);
        const authoritativeSourceFee =
          sourcePrev.feeOverride !== undefined ? Number(sourcePrev.feeOverride) : authoritativeMatchFee;
        const authoritativeTargetBaseFee =
          targetPrev.feeOverride !== undefined ? Number(targetPrev.feeOverride) : authoritativeMatchFee;
        if (
          !Number.isFinite(authoritativeMatchFee) ||
          !Number.isFinite(authoritativeSourceFee) ||
          authoritativeSourceFee < 0 ||
          !Number.isFinite(authoritativeTargetBaseFee) ||
          authoritativeTargetBaseFee < 0
        ) {
          throw new RequestError(409, "Invalid authoritative fee configuration on match or payment record.");
        }

        const [srcPlayerSnap, tgtPlayerSnap] = await Promise.all([
          sourcePrev.playerId ? tx.get(db.collection("players").doc(String(sourcePrev.playerId))) : null,
          tx.get(db.collection("players").doc(targetPlayerId)),
        ]);
        const sourcePlayerName = String(srcPlayerSnap?.data()?.name || sourcePrev.playerId || "Player");
        const targetPlayerName = String(tgtPlayerSnap.data()?.name || targetPlayerId);

        const newTargetFee = authoritativeTargetBaseFee + authoritativeSourceFee;
        const sourcePlanTag = `Sponsored by ${targetPlayerName}`;
        const targetSponsoring = `Paying for ${sourcePlayerName}`;

        tx.update(sourceRef, {
          feeOverride: 0,
          planTag: sourcePlanTag,
          sponsoredBy: targetPlayerId,
          status: "Paid",
          manualBy: actorName,
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.update(targetDoc.ref, {
          feeOverride: newTargetFee,
          sponsoring: targetSponsoring,
          updatedAt: FieldValue.serverTimestamp(),
        });

        await writeServerAudit(
          db,
          {
            ...(safeAuditId ? { id: safeAuditId } : {}),
            requestHash,
            actorId: auth.uid,
            actorName,
            action: "updated",
            entity: "payment",
            entityId: sourcePaymentId,
            entityLabel: `${sourcePlayerName} sponsored by ${targetPlayerName}`,
            changes: [
              { field: "source.sponsoredBy", ...(sourcePrev.sponsoredBy ? { oldValue: String(sourcePrev.sponsoredBy) } : {}), newValue: targetPlayerName },
              { field: "source.feeOverride", oldValue: `₹${authoritativeSourceFee}`, newValue: "₹0" },
              { field: "source.status", oldValue: String(sourcePrev.status || ""), newValue: "Paid" },
              { field: "target.feeOverride", oldValue: `₹${authoritativeTargetBaseFee}`, newValue: `₹${newTargetFee}` },
              { field: "target.sponsoring", ...(targetPrev.sponsoring ? { oldValue: String(targetPrev.sponsoring) } : {}), newValue: targetSponsoring },
            ],
            summary: `${targetPlayerName} is now sponsoring ${sourcePlayerName}'s ₹${authoritativeSourceFee} match fee (${matchLabel})`,
          },
          tx,
        );
        return { sourcePaymentId, targetPaymentId: targetDoc.id, newTargetFee, sourceFee: authoritativeSourceFee };
      }

      if (action === "applyLegacyPlan") {
        if (match.financeStatus === "closed") {
          throw new RequestError(409, "Match finances are closed; cannot apply fee plan.");
        }
        const paymentId = typeof body.paymentId === "string" ? body.paymentId.trim() : "";
        const feeOverride = Number(body.feeOverride);
        const planTag = typeof body.planTag === "string" ? body.planTag.trim().slice(0, 120) : "";
        if (!isSafeId(paymentId) || !Number.isFinite(feeOverride) || !planTag) {
          throw new RequestError(400, "Valid paymentId, feeOverride, and planTag are required.");
        }

        const payRef = matchRef.collection("payments").doc(paymentId);
        const paySnap = await tx.get(payRef);
        if (!paySnap.exists) {
          throw new RequestError(404, `Payment record ${paymentId} not found.`);
        }
        const prev = paySnap.data() || {};
        const playerSnap = prev.playerId ? await tx.get(db.collection("players").doc(String(prev.playerId))) : null;
        const playerName = String(playerSnap?.data()?.name || prev.playerId || "Player");

        const updates: Record<string, unknown> = {
          feeOverride,
          planTag,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (body.feeOffsetAmount !== undefined && Number.isFinite(Number(body.feeOffsetAmount))) {
          updates.feeOffsetAmount = Number(body.feeOffsetAmount);
        }
        if (body.feeCollectedAmount !== undefined && Number.isFinite(Number(body.feeCollectedAmount))) {
          updates.feeCollectedAmount = Number(body.feeCollectedAmount);
        }
        if (typeof body.status === "string" && VALID_STATUSES.has(body.status)) {
          updates.status = body.status;
        }
        if (typeof body.paymentMethod === "string" && body.paymentMethod.trim()) {
          updates.paymentMethod = body.paymentMethod.trim();
        }
        if (typeof body.manualMethod === "string" && body.manualMethod.trim()) {
          updates.manualMethod = body.manualMethod.trim();
        }
        if (updates.status === "Paid" || updates.paymentMethod === "manual" || updates.manualMethod !== undefined) {
          updates.manualBy = actorName;
        }

        tx.update(payRef, updates);

        const changes: { field: string; oldValue?: string; newValue?: string }[] = [
          {
            field: "feeOverride",
            ...(prev.feeOverride !== undefined ? { oldValue: `₹${prev.feeOverride}` } : {}),
            newValue: `₹${feeOverride}`,
          },
          {
            field: "planTag",
            ...(prev.planTag ? { oldValue: String(prev.planTag) } : {}),
            newValue: planTag,
          },
        ];
        if (updates.status && prev.status !== updates.status) {
          changes.push({ field: "status", oldValue: String(prev.status || ""), newValue: String(updates.status) });
        }

        await writeServerAudit(
          db,
          {
            ...(safeAuditId ? { id: safeAuditId } : {}),
            requestHash,
            actorId: auth.uid,
            actorName,
            action: "updated",
            entity: "payment",
            entityId: paymentId,
            entityLabel: `${playerName} fee plan`,
            changes,
            summary: `Applied fee plan "${planTag}" (Fee: ₹${feeOverride}, Status: ${String(updates.status || prev.status || "Unpaid")}) to ${playerName}`,
          },
          tx,
        );
        return { paymentId };
      }

      throw new RequestError(400, `Unsupported action: ${action}`);
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err?.code === 6 || String(err?.message || "").includes("ALREADY_EXISTS")) {
      return NextResponse.json({ ok: true, deduplicated: true });
    }
    console.error("[payment-action] failed:", err?.message || err);
    return NextResponse.json({ error: "Could not complete payment action." }, { status: 500 });
  }
}
