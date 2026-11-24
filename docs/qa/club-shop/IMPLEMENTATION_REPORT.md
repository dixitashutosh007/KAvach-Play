# Club Shop — Player & Admin Club Integration

**Branch:** `feat/club-shop`, from `mig-mov` @ `e2c7b32`. The final SHA is in the delivery message.
**Verification:** done by the implementation agent: unit tests, Firestore-emulator tests and Playwright with synthetic sessions. **Not independent QA. Not deployed.**

## 1. What was found first

The Shop already existed: catalogue, cart/order, Razorpay checkout, webhook-created paid orders, admin products and orders, and a WhatsApp report. It also had an on/off flag, `appConfig/default.features.shop`, toggled today in Settings. Four defects or gaps were found:

1. **The player Shop screen loaded nothing.** The `shop` tab was in neither loading set, so players saw no products and no orders.
2. **Player Shop orders never loaded anywhere.** The order listener was an *unfiltered* collection query, started only on the admin Club tab. The rules let a player read only their own orders, so an unfiltered player query is rejected. As a result:
   - My Orders was empty;
   - Payment History (which already lists Shop orders as "Shop: …") never showed them.
3. **Disabling the Shop only hid the UI.**
   - `/api/razorpay/order` still accepted new Shop purchases.
   - The `merchOrders` create rule still let a player write an unpaid order directly.
4. **Admins lost Shop management when the Shop was off.** The admin Club → Shop section was gated by the same player-facing flag.

## 2. Changes

**Player:**
- **Club tab:** a Club Shop card appears after the tiles **only while the Shop is enabled**. There is no placeholder when it is off.
- The Shop is not in the bottom navigation (still Home · Club · Matches). Its back link now returns to Club. Home Quick Access keeps its existing, flag-gated Shop entry.
- **Shop screen:** loads the catalogue and the player's **own** orders, filtered by player ID (the same pattern as payments).
- **My Payments / Profile history:** now loads the player's own Shop orders, so purchases appear as **"Shop: <item>"**. This reuses the existing history; no new records are created.
- Opening the Shop directly while it's disabled redirects through the existing feature guard.

**Admin (Club Admin / Super Admin):**
- **Club Menu** (⋯ button beside the Club title): a sheet on mobile and a pop-over on desktop, listing the Club sections the admin may use, including **Club Shop**.
- **Club Shop panel** at the top of Club → Shop:
  - status badge (Enabled / Disabled);
  - **Enable Shop (visible to players)** switch;
  - **Products** (count), **Orders** (new / open count), **Activity & Reports** (the existing WhatsApp report) and **View Shop** (as player).
  - These open the existing Shop admin views directly through a new `initialView` prop on `ShopTab`.
- The Shop section is **always available to Club and Super Admins**, enabled or not. Products and all existing orders stay manageable.
- Finance-only admins have no Club → Shop. That is the existing Club Admin capability (D-19); unchanged.

**Server and rules:**
- `POST /api/admin/shop {enabled}`:
  - Club or Super Admin only, verified server-side.
  - Flips **only** the existing `features.shop` flag, in a transaction with an audit entry (`entity: "shop"`). Idempotent.
  - `appConfig` client writes stay Super-Admin-only. This is a narrow, audited path instead of loosening that rule.
- `lib/razorpay-order.ts` (`merch_order`): `assertShopOpen(db)` refuses new purchases while the Shop is disabled. The route returns **403 `SHOP_CLOSED`**.
  - No Razorpay order or intent is created.
  - Paying an *existing* unpaid Shop order from dues, and webhooks for payments already started, are unaffected.
- `firestore.rules`: `merchOrders` **create** now also requires `isShopEnabled()`. This is a tightening; reads and updates are unchanged.

**Disabling never deletes products, cancels orders, alters payments or touches history** (emulator test SHOP-05).

## 3. Files

- **New:**
  - `lib/shop-config.ts`, `app/api/admin/shop/route.ts`, `components/club/ClubShopPanel.tsx`
  - `tests/club-shop.test.mjs`, `tests/club-shop.emulator.test.mjs`, `e2e/club-shop.spec.ts`
  - this report and screenshots
- **Modified:**
  - `components/club/PlayerClubTab.tsx` (Shop card), `components/ClubTab.tsx` (Club Menu + Shop panel), `components/ShopTab.tsx` (`initialView` only)
  - `lib/admin-navigation.ts` (admin Shop section no longer flag-gated), `lib/player-navigation.ts` (Shop parent → Club)
  - `app/page.tsx` (loader sets + player-scoped orders + persona re-scope)
  - `hooks/useStore.ts` (`ensureMerchOrders(playerId?)`)
  - `lib/razorpay-order.ts` and `app/api/razorpay/order/route.ts` (closed-Shop check, 403)
  - `firestore.rules` (create guard)
  - Three existing tests updated for the intended placement change: `player-nav-persona`, `home-screen-fixes`, `admin-nav-realignment`

**Reused, not rebuilt:**
- The `features.shop` flag, `ShopTab` (catalogue, cart, checkout, admin products and orders, report), `/api/razorpay/order` and the webhook.
- `FinanceTab` payment history, the `merchOrders` and `merchandises` collections, `requireClubAdmin`, `writeServerAudit`.
- **No new collections or schema changes.**

## 4. Tests executed

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors, 4 pre-existing warnings |
| `GIT_BRANCH=mig-mov npm run build` | Pass (32 / 32 pages) |
| `tests/club-shop.test.mjs` | 8 / 8 |
| `tests/club-shop.emulator.test.mjs` | 8 / 8 |
| Existing Shop/payment emulator tests (`px1-merch-order-identity`, `razorpay-reservation-emulator`, `r3-webhook-route`) plus the above | 57 / 57 |
| `e2e/club-shop.spec.ts`, Desktop + Mobile Chrome | 16 / 16 |
| Full functional suite | 1150 tests: 1129 pass, 21 fail. **No new failures** compared with the pre-Shop commit `e2c7b32` (same failing set) |

The 21 failures are the existing tests that encode the retired role model. They predate this work and are listed in `docs/qa/access-control-centre/IMPLEMENTATION_REPORT.md` §7.

**Emulator scenarios** (each with a mutation check: removing the server check fails SHOP-03; removing the rule fails SHOP-R2):

| ID | Scenario |
|---|---|
| SHOP-01 | Toggle: anonymous 401; player, Finance Admin and retired Match Admin 403 |
| SHOP-02 | Only `features.shop` changes, other flags untouched, audited, idempotent; Super Admin can toggle |
| SHOP-03 | **Disabled: a direct API purchase returns 403 `SHOP_CLOSED`; no Razorpay order, no intent** |
| SHOP-04 | Enabled: one Razorpay order at the server price (₹499 from the catalogue, not the client's ₹1) |
| SHOP-05 | Disabling leaves products, orders and payment status unchanged |
| SHOP-R1 | Rules: enabled, a player may create their own unpaid order |
| SHOP-R2 | Rules: disabled, the same direct write is denied |
| SHOP-R3 | Rules: a player can still read existing orders when disabled |

**e2e scenarios:**
- Player, enabled: Club card → Shop with products and My Orders (1); navigation remains three items.
- Player, disabled: no card, no "Club Shop" text, a direct route is redirected.
- Payment history shows "Shop: Club Cap".
- At 390 px: no horizontal scroll.
- Admin:
  - Club Menu → Club Shop;
  - panel counts (2 products, 1 new order);
  - the toggle calls the server route and the switch settles;
  - Orders and Products open the existing views.
- Admin with the Shop disabled: panel, products and existing orders still reachable.
- A Finance-only admin has no Club Shop.
- Mobile bottom-sheet Club Menu.

## 5. Acceptance criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | Enabled → player sees Shop in Club | e2e |
| 2 | Disabled → hidden, no placeholder | e2e |
| 3 | Disabled → direct API can't create orders | SHOP-03 (route), SHOP-R2 (rules) |
| 4 | Admin manages Shop regardless of the switch | e2e "Shop disabled for players" + unit |
| 5–6 | Admin adds/edits products and manages orders | Existing `ShopTab` admin views reached from the panel (e2e opens Products, "New Item", Orders). **Add/edit saves were not re-exercised end-to-end.** |
| 7 | Existing orders accessible after disabling | e2e + SHOP-05 / SHOP-R3 |
| 8 | Player completes a purchase when enabled | Server side: SHOP-04 (order created at the server price), plus the existing webhook tests (`px1`, `r3`). **Razorpay checkout in the browser was not exercised** (no live/test gateway here). |
| 9 | Purchase appears in Payment History | e2e (existing history, now loaded for players) |
| 10 | No duplicate payment/order records | Existing reservation and webhook idempotency tests pass; this change adds no writers |
| 11 | Unauthorized users can't reach Shop management APIs | SHOP-01; product/order writes remain rules-protected (`isAnyAdmin`) |
| 12 | Mobile and desktop | e2e at 390 px + desktop; screenshots |
| 13–14 | No regressions in existing Shop or Club features | Shop emulator suites 57 / 57; no new functional failures |

## 6. Screenshots (`docs/qa/club-shop/screenshots/`)

| Files | Shows |
|---|---|
| `01`, `05` | Player Club with the Shop card (desktop, 390 px) |
| `02` | Player Shop |
| `03` | Player Club with the Shop disabled |
| `04` | Payment history "Shop: Club Cap" |
| `06`, `11` | Club Menu (desktop, 390 px) |
| `07`, `10` | Admin Club Shop panel (desktop, 390 px) |
| `08` | Panel → Orders |
| `09` | Admin view with the Shop disabled |

## 7. Limitations

1. **Rules must be deployed** to `kavach-play-db-ext` for the direct-write block (SHOP-R2). The server-side block (SHOP-03) works without it.
2. **Orders stored under the login UID** instead of the player ID (legacy) aren't loaded by the player-scoped query. The rules allow both; the query uses the player ID, like payments.
3. **Pre-existing:**
   - Admin "Cash / Manual order" writes `merchOrders` from the browser, and the create rule has no admin branch, so those writes are likely rejected. Unchanged here; it needs a rules decision or a server route.
   - Zero-price items try to create a `Paid` order from the browser, which the rule rejects (it requires `Unpaid`).
   - Both are noted for a follow-up.
4. **Admin Club layout:** the reference's player-style overview (At a Glance + cards) for the admin Club landing was not rebuilt. Admin Club keeps its existing sections, with the Club Menu and the Shop management card added. Shop Activity & Reports opens the existing WhatsApp report; there is no separate analytics view.
5. **Finance Admin:** the Shop toggle and Club → Shop are Club and Super Admin only, as in D-19. Finance Admins still see Shop purchases in Finance; the rules also still allow them product and order writes (`isAnyAdmin`, pre-existing).
