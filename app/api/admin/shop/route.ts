/**
 * POST /api/admin/shop  { enabled: boolean } — Club Menu → Club Shop toggle.
 *
 * Auth: Club Admin or Super Admin (the Shop is a Club Admin capability, D-19/D-22),
 * verified server-side. Writes ONLY the existing flag appConfig/default.features.shop
 * (no new flag) in a transaction with an audit entry. appConfig stays Super-Admin-only
 * for client writes; this route is the narrow, audited path for the Shop switch.
 *
 * Disabling never touches products, orders, payments or history; it only stops new
 * player purchases (enforced in /api/razorpay/order and the merchOrders create rule).
 */
import { NextResponse } from "next/server.js";
import { requireClubAdmin } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { actorNameFor, writeServerAudit } from "../../../../lib/server-audit.ts";
import { SHOP_CONFIG_DOC, isShopEnabled } from "../../../../lib/shop-config.ts";

export async function POST(req: Request) {
  const guard = await requireClubAdmin(req);
  if (!guard.ok) return guard.response;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "enabled must be true or false." }, { status: 400 });
  const enabled: boolean = body.enabled;
  const db = getServerFirestore();
  try {
    const actorName = await actorNameFor(db, guard.uid);
    const result = await db.runTransaction(async (tx) => {
      const ref = db.collection(SHOP_CONFIG_DOC.collection).doc(SHOP_CONFIG_DOC.doc);
      const snap = await tx.get(ref);
      const before = isShopEnabled(snap.exists ? snap.data() : null);
      if (before === enabled) return { changed: false, enabled };
      // Dotted path: changes only features.shop, keeps every other feature flag.
      if (snap.exists) tx.update(ref, { "features.shop": enabled });
      else tx.set(ref, { features: { shop: enabled } }, { merge: true });
      await writeServerAudit(
        db,
        {
          actorId: guard.uid,
          actorName,
          action: "updated",
          entity: "shop",
          entityId: "club-shop",
          entityLabel: "Club Shop",
          changes: [{ field: "features.shop", oldValue: before ? "Enabled" : "Disabled", newValue: enabled ? "Enabled" : "Disabled" }],
          summary: `Club Shop ${enabled ? "enabled" : "disabled"} for players.`,
        },
        tx,
      );
      return { changed: true, enabled };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch {
    console.error("[shop] toggle failed");
    return NextResponse.json({ error: "Could not change the Shop setting. Nothing was changed; try again." }, { status: 500 });
  }
}
