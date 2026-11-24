/**
 * Club Shop availability (`lib/shop-config.ts`).
 *
 * Single source of truth: the EXISTING flag `appConfig/default.features.shop`
 * (absent = enabled, matching isFeatureEnabled in app/page.tsx). No new flag.
 * Disabling the Shop only stops NEW player purchases — products, orders,
 * payments and history are never changed.
 */
export const SHOP_CONFIG_DOC = { collection: "appConfig", doc: "default" } as const;

export function isShopEnabled(config: { features?: { shop?: unknown } } | null | undefined): boolean {
  return config?.features?.shop !== false;
}

/** Thrown when a new Shop purchase is attempted while the Shop is disabled. */
export class ShopClosedError extends Error {
  readonly code = "SHOP_CLOSED";
  constructor() {
    super("The Club Shop is currently closed. New orders can't be placed right now.");
    this.name = "ShopClosedError";
  }
}

/** Server check (Admin SDK Firestore): throws ShopClosedError when the Shop is disabled. */
export async function assertShopOpen(db: { collection: (c: string) => any }): Promise<void> {
  const snap = await db.collection(SHOP_CONFIG_DOC.collection).doc(SHOP_CONFIG_DOC.doc).get();
  if (!isShopEnabled(snap.exists ? snap.data() : null)) throw new ShopClosedError();
}
