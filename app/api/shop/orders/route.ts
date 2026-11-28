/**
 * POST /api/shop/orders
 *
 * Server-authoritative, transactional shop order creation endpoint.
 * - Requires existing, active `players/{playerId}` document.
 * - For player-created orders, validates account-linking (`userData.playerId` or `uid`).
 * - For admin-created orders, records `createdByUid` / `createdByName` separately.
 * - Rejects unknown custom option keys, invalid choices, missing required options,
 *   and negative/invalid option prices.
 * - Derives `basePrice`, itemized `priceBreakdown`, `totalPrice`, `orderStatus`, and
 *   `paymentStatus: "Unpaid"` exclusively on the server.
 */
import crypto from "crypto";
import { NextResponse } from "next/server.js";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { writeServerAudit } from "../../../../lib/server-audit.ts";
import { isSafeId } from "../../../../lib/weekend-ops-server.ts";

class OrderRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function stableNormalize(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (Array.isArray(val)) return val.map(stableNormalize);
  if (typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(val as Record<string, unknown>).sort()) {
      out[k] = stableNormalize((val as Record<string, unknown>)[k]);
    }
    return out;
  }
  return val;
}

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, any>;
  try {
    body = (await req.json()) as Record<string, any>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const merchId = typeof body?.merchId === "string" ? body.merchId.trim() : "";
  const playerId = typeof body?.playerId === "string" ? body.playerId.trim() : "";
  if (!isSafeId(merchId) || !isSafeId(playerId)) {
    return NextResponse.json({ error: "Valid merchId and playerId are required." }, { status: 400 });
  }

  const rawQty = body?.quantity !== undefined ? Number(body.quantity) : 1;
  if (!Number.isInteger(rawQty) || rawQty < 1 || rawQty > 20) {
    return NextResponse.json({ error: "Quantity must be an integer between 1 and 20." }, { status: 400 });
  }
  const quantity = rawQty;

  const db = getServerFirestore();
  const userSnap = await db.collection("appUsers").doc(auth.uid).get();
  const userData = userSnap.exists ? (userSnap.data() || {}) : {};
  const isClubOrHigher =
    Boolean(auth.roles?.has("superAdmin") || auth.roles?.has("clubAdmin") || auth.roles?.has("financeAdmin")) ||
    Boolean(userData.isClubAdmin || userData.isFinanceAdmin || userData.isSuperAdmin);

  // Account-linking check for non-admin players
  if (!isClubOrHigher) {
    const linkedPlayerId = typeof userData.playerId === "string" ? userData.playerId.trim() : "";
    const matchesLinked = linkedPlayerId ? playerId === linkedPlayerId : playerId === auth.uid;
    if (!matchesLinked) {
      return NextResponse.json(
        { error: "You can only place shop orders for your own linked player account." },
        { status: 403 },
      );
    }
  }

  const rawKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  const safeAuditId =
    rawKey && /^[a-zA-Z0-9_-]{1,100}$/.test(rawKey)
      ? `shop_order_${crypto.createHash("sha256").update(`${auth.uid}:shop_order:${merchId}:${playerId}:${rawKey}`).digest("hex").slice(0, 32)}`
      : undefined;

  if (
    body?.customSelections !== undefined &&
    (typeof body.customSelections !== "object" || body.customSelections === null || Array.isArray(body.customSelections))
  ) {
    return NextResponse.json({ error: "customSelections must be a key-value object." }, { status: 400 });
  }
  const customSelections = body?.customSelections as Record<string, unknown> | undefined;

  const requestHash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        stableNormalize({
          merchId,
          playerId,
          quantity,
          size: typeof body.size === "string" ? body.size.trim() : null,
          spec: typeof body.spec === "string" ? body.spec.trim() : null,
          customSelections: customSelections ?? null,
          jerseyName: typeof body.jerseyName === "string" ? body.jerseyName.trim() : null,
          jerseyNumber: body.jerseyNumber !== undefined && body.jerseyNumber !== null && body.jerseyNumber !== "" ? String(body.jerseyNumber).trim() : null,
          isManual: isClubOrHigher && body.isManual === true,
        }),
      ),
    )
    .digest("hex");

  const actorName = String(userData.name || "Player").slice(0, 120);

  try {
    const out = await db.runTransaction(async (tx) => {
      if (safeAuditId) {
        const auditSnap = await tx.get(db.collection("auditLogs").doc(safeAuditId));
        if (auditSnap.exists) {
          if (auditSnap.data()?.requestHash === requestHash) {
            return { deduplicated: true, id: String(auditSnap.data()?.entityId || "") };
          }
          throw new OrderRequestError(409, "Idempotency key already used with a different payload.");
        }
      }

      const [merchSnap, configSnap, playerSnap, existingOrdersSnap] = await Promise.all([
        tx.get(db.collection("merchandises").doc(merchId)),
        tx.get(db.collection("appConfig").doc("default")),
        tx.get(db.collection("players").doc(playerId)),
        tx.get(db.collection("merchOrders").where("merchId", "==", merchId)),
      ]);

      if (!playerSnap.exists) {
        throw new OrderRequestError(404, `Player ${playerId} not found.`);
      }
      const playerData = playerSnap.data() || {};
      if (playerData.disabled === true) {
        throw new OrderRequestError(409, "Orders cannot be placed for a disabled player account.");
      }

      if (!merchSnap.exists) {
        throw new OrderRequestError(404, `Product ${merchId} not found.`);
      }
      const merch = merchSnap.data() || {};
      if (merch.available === false || merch.inStock === false || merch.isArchived === true || merch.status === "Disabled") {
        throw new OrderRequestError(409, "This product is currently unavailable.");
      }

      const shopEnabled = configSnap.exists ? configSnap.data()?.features?.shop !== false : true;
      if (!shopEnabled && !isClubOrHigher) {
        throw new OrderRequestError(403, "Club Shop is currently disabled.");
      }

      const basePrice = Number(merch.basePrice ?? merch.price);
      if (!Number.isFinite(basePrice) || basePrice < 0) {
        throw new OrderRequestError(409, "Product has an invalid configured base price.");
      }

      // Normalize both `customFields` (production schema) and `customOptions` into one strict map.
      const fieldMap = new Map<
        string,
        {
          required: boolean;
          options: Map<string, number>;
        }
      >();

      if (Array.isArray(merch.customFields)) {
        for (const f of merch.customFields as any[]) {
          const fname = typeof f?.name === "string" ? f.name.trim() : typeof f?.label === "string" ? f.label.trim() : "";
          if (!fname) continue;
          const optMap = new Map<string, number>();
          for (const opt of Array.isArray(f.options) ? f.options : []) {
            const val = typeof opt?.value === "string" ? opt.value : typeof opt?.label === "string" ? opt.label : "";
            if (!val) continue;
            const rawMod =
              opt.priceModifierType === "Add"
                ? Number(opt.priceModifierValue ?? 0)
                : opt.priceModifierType === "Subtract"
                  ? -1
                  : Number(opt.priceModifierValue ?? opt.price ?? 0);
            if (!Number.isFinite(rawMod) || rawMod < 0) {
              throw new OrderRequestError(409, `Product option '${fname}:${val}' has an invalid or negative price.`);
            }
            optMap.set(val, rawMod);
          }
          fieldMap.set(fname, { required: f.required !== false, options: optMap });
        }
      }

      if (Array.isArray(merch.customOptions)) {
        for (const opt of merch.customOptions as any[]) {
          const fname = typeof opt?.label === "string" ? opt.label.trim() : typeof opt?.name === "string" ? opt.name.trim() : "";
          if (!fname) continue;
          const optMap = new Map<string, number>();
          if (Array.isArray(opt.choices)) {
            for (const c of opt.choices) {
              const label = typeof c?.label === "string" ? c.label : typeof c?.value === "string" ? c.value : "";
              if (!label) continue;
              const p = Number(c?.price ?? 0);
              if (!Number.isFinite(p) || p < 0) {
                throw new OrderRequestError(409, `Product option '${fname}:${label}' has an invalid or negative price.`);
              }
              optMap.set(label, p);
            }
          } else {
            const p = Number(opt?.price ?? 0);
            if (!Number.isFinite(p) || p < 0) {
              throw new OrderRequestError(409, `Product option '${fname}' has an invalid or negative price.`);
            }
            optMap.set(fname, p);
          }
          fieldMap.set(fname, { required: opt.required !== false, options: optMap });
        }
      }

      // 1. Reject unknown custom option keys
      if (customSelections) {
        for (const key of Object.keys(customSelections)) {
          if (!fieldMap.has(key)) {
            throw new OrderRequestError(400, `Unknown custom option key: '${key}'.`);
          }
        }
      }

      // 2. Validate required options, allowed choice labels, and option prices
      let customPriceAdditions = 0;
      const sanitizedSelections: Record<string, string> = {};
      const breakdownItems: { field: string; choice: string; priceAdd: number }[] = [];

      for (const [fname, def] of fieldMap.entries()) {
        const rawSel = customSelections ? customSelections[fname] : undefined;
        const selStr = rawSel !== undefined && rawSel !== null ? String(rawSel).trim() : "";
        if (def.required && !selStr) {
          throw new OrderRequestError(400, `Missing required custom option: '${fname}'.`);
        }
        if (selStr) {
          if (!def.options.has(selStr)) {
            throw new OrderRequestError(400, `Invalid choice '${selStr}' for custom option '${fname}'.`);
          }
          const add = def.options.get(selStr)!;
          if (!Number.isFinite(add) || add < 0) {
            throw new OrderRequestError(409, `Invalid option price for '${fname}:${selStr}'.`);
          }
          customPriceAdditions += add;
          sanitizedSelections[fname] = selStr;
          breakdownItems.push({ field: fname, choice: selStr, priceAdd: add });
        }
      }

      const unitPrice = basePrice + customPriceAdditions;
      const authoritativePrice = Math.round(unitPrice * quantity);
      if (!Number.isFinite(authoritativePrice) || authoritativePrice < 0) {
        throw new OrderRequestError(409, "Calculated order price is invalid.");
      }

      const merchName = String(merch.name || "Merchandise").slice(0, 160);
      const playerName = String(playerData.name || actorName).slice(0, 120);

      // Server-authoritative paymentStatus and workflow orderStatus
      const paymentStatus = "Unpaid";
      const minOrderQuantity = Math.max(1, Number(merch.minOrderQuantity) || 1);
      const existingQty = existingOrdersSnap.docs.reduce(
        (sum, d) => sum + (Number(d.data()?.quantity) || 1),
        0,
      );
      const orderStatus =
        existingQty + quantity >= minOrderQuantity
          ? "Ready to Place Order"
          : "Awaiting Min Order Qnty";

      const orderId = crypto.randomUUID();
      const orderPayload: Record<string, unknown> = {
        id: orderId,
        merchId,
        merchName,
        playerId,
        playerName,
        createdByUid: auth.uid,
        createdByName: actorName,
        quantity,
        price: authoritativePrice,
        priceBreakdown: {
          basePrice,
          customAdditions: customPriceAdditions,
          unitPrice,
          quantity,
          totalPrice: authoritativePrice,
          items: breakdownItems,
        },
        ...(customPriceAdditions > 0 ? { customPriceAdditions } : {}),
        status: "Pending",
        orderStatus,
        paymentStatus,
        isManual: isClubOrHigher && body.isManual === true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (typeof body.size === "string" && body.size.trim()) orderPayload.size = body.size.trim().slice(0, 40);
      if (typeof body.spec === "string" && body.spec.trim()) orderPayload.spec = body.spec.trim().slice(0, 200);
      if (Object.keys(sanitizedSelections).length > 0) orderPayload.customSelections = sanitizedSelections;
      if (typeof body.jerseyName === "string" && body.jerseyName.trim()) orderPayload.jerseyName = body.jerseyName.trim().slice(0, 40);
      if (body.jerseyNumber !== undefined && body.jerseyNumber !== null && body.jerseyNumber !== "") {
        orderPayload.jerseyNumber = String(body.jerseyNumber).slice(0, 10);
      }

      tx.create(db.collection("merchOrders").doc(orderId), orderPayload);
      await writeServerAudit(
        db,
        {
          ...(safeAuditId ? { id: safeAuditId } : {}),
          requestHash,
          actorId: auth.uid,
          actorName,
          actorType: isClubOrHigher ? "admin" : "player",
          action: "created",
          entity: "merch_order",
          entityId: orderId,
          entityLabel: `${playerName} - ${merchName}`,
          changes: [
            { field: "merchName", newValue: merchName },
            { field: "quantity", newValue: String(quantity) },
            { field: "price", newValue: `₹${authoritativePrice}` },
            { field: "orderStatus", newValue: orderStatus },
            { field: "paymentStatus", newValue: paymentStatus },
          ],
          summary: `${actorName} created order for ${playerName}: "${merchName}" ×${quantity} (₹${authoritativePrice})`,
        },
        tx,
      );

      return { deduplicated: false, id: orderId, price: authoritativePrice, paymentStatus, orderStatus };
    });

    return NextResponse.json({ ok: true, ...out });
  } catch (err: any) {
    if (err instanceof OrderRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err?.code === 6 || String(err?.message || "").includes("ALREADY_EXISTS")) {
      return NextResponse.json({ ok: true, deduplicated: true });
    }
    console.error("[shop/orders] create failed:", err?.message || err);
    return NextResponse.json({ error: "Could not place shop order." }, { status: 500 });
  }
}
