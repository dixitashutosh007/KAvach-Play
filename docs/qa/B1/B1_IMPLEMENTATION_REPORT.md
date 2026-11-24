# B1 Implementation Report: PX-1 Merchandise Order Ownership + FIN-004 Checkout Lifecycle

**Authorised scope:** `docs/implementation/R4_RIGHT_SIZED_ARCHITECTURE_PROPOSAL.md` §20 (revision 3, `6d95dd0`), B1 only.
**Branch:** `mig-mov`, base `6d95dd0160b371cead4aa9900851d3db2a68b9a4`. `main` unchanged at `f5739726e75a2e6594c7379bdbfc8a866c63f787`.
**Deployment:** none. No rules deployment, no workflow dispatch, no Razorpay call (the SDK is stubbed in tests; any network attempt throws).

## 1. Changes

| File | Change |
|---|---|
| `lib/merch-order-confirmation.ts` (new) | `merchOrderIdForIntent` (`mo_{intentId}`, the single source of the id format); `waitForServerOrder` (single-document polling, 2 s / 60 s, injectable reader / clock / sleep, abortable; absence and permission-denied = pending; never "failed") |
| `lib/razorpay-order.ts` | `buildMerchOrderPayload` allowlist + `MERCH_CHECKOUT_ORDER_STATUSES`; `derivePayableAmount` merch branch stores only allowlisted fields; player name from the player record; client `id` and payment fields dropped. Price and ownership checks unchanged |
| `lib/razorpay-webhook.ts` | `pickStoredMerchOrderFields` (non-throwing allowlist for legacy intents); `mo_{intentId}` read before writes; `transaction.create()` only; existing document → permanent `MERCH_ORDER_EXISTS` (dead-lettered by the existing R5 route, 200); unused `crypto` import removed |
| `lib/webhook-dead-letter.ts` | `MERCH_ORDER_EXISTS` → `data_integrity` |
| `app/api/razorpay/order/route.ts` | New-order response returns `intentId` (top level and `notes.intentId`) from the saved intent; reused-order responses also return the top-level `intentId` (values unchanged) |
| `components/ShopTab.tsx` | Razorpay success handler no longer calls `finalizeOrderPlacement`; it shows a "confirming" state and waits for `mo_{intentId}` via `getDoc`; polling aborts on unmount and on dialog close; post-order side effects (profile sync, MOQ, e-mails) in one non-fatal helper; ₹0 and manual / offline paths unchanged |
| `tests/b1-merch-order-confirmation.test.mjs` (new) | 22 unit + static tests |
| `tests/px1-merch-order-identity.emulator.test.mjs` (new) | 13 emulator tests through the real order and webhook routes |
| `tests/emulator-webhook-concurrency.test.mjs` | Merchandise case: expectation changed from "pre-existing order overwritten" (the PX-1 vulnerability) to "pre-existing order untouched; one `mo_` order created" |

No Firestore rules, configuration, workflow, migration or B2+ change.

## 2. Validation (executed 2026-11-24 in the session container)

| Command | Exit | Result |
|---|---|---|
| `npm run test:functional` | 0 | 1057 tests, 1057 pass, 0 fail. 22 emulator-only suites are skipped at suite level by design in this command (`FIRESTORE_EMULATOR_HOST` not set); they execute in the next row |
| `npm run test:emulator` | 0 | 416 tests, 416 pass, 0 fail, 0 skipped (previous baseline 403 + 13 new) |
| `npx tsc --noEmit` | 0 | no diagnostics |
| `npm run build` | 0 | compiled; no warnings; `next.config` has no error-suppression flags |

**Blocked:** end-to-end browser checkout. Payment operations are disabled outside production (`arePaymentOperationsEnabled`) and no staging deployment is authorised (O-6). Not bypassed.

## 3. Test mapping (§20.4)

| §20.4 | Test |
|---|---|
| 1 foreign id cannot overwrite | B1-01 |
| 2 `/` and over-long ids | B1-02 |
| 3 payment / unknown fields | B1-03; unit allowlist tests |
| 4 orderStatus enum | B1-04; unit |
| 5 tampered price | B1-05 |
| 6 six concurrent deliveries | B1-06; updated FIN-002 merch case |
| 7 replay | B1-07 |
| 8 exact shop payload | B1-08 |
| 9 pre-existing `mo_` | B1-09 |
| 10 confirmation helper | unit suite (immediate, delayed, permission-denied, timeout = pending, invalid id, cancellation, unmount) + B1-12 / B1-13 against the emulator |
| 11 no browser write after success | static: handler and `confirmOnlineOrder` contain no order write |
| 12 other categories | full functional + emulator suites |
| Added | reused-order intent id (B1-11); new-order intent id with empty gateway notes (B1-10); ₹0 and manual paths still create orders (static) |

Static checks are labelled as such: the repository has no React renderer.

## 4. Security invariants (§20.3 + authorisation)

| Invariant | Evidence |
|---|---|
| No client value used as or inside a document id | `mo_{intentId}` from the server intent; B1-01, B1-02 |
| No client value sets `paymentStatus`, `price`, `isManual`, `razorpayPaymentId`, `id`, `intentId` | B1-03, B1-05, unit allowlist tests |
| `create()` only; never overwrite | B1-09 |
| ≤ 1 Paid online order per intent, created only by the signed webhook | B1-06, B1-07; static handler check |
| Browser never writes a Paid online order / is never authoritative | static checks; `confirmOnlineOrder` only reads |
| Delayed webhook or closed browser cannot lose the order | order created server-side by the webhook (B1-12); browser state not required |
| Absence never treated as payment failure | unit timeout / permission-denied tests; B1-13 |
| No rules change, no migration; other categories unchanged | diff; full suites |

## 5. Known limitations

- **FU-1 (follow-up finding, not fixed in B1):** `ensureMerchOrders` subscribes to the whole `merchOrders` collection (`hooks/useStore.ts:730–741`). The rules allow non-admins to read only their own orders and rules are not filters, so for players this list query is expected to be refused and "My Orders" to be empty. Source inspection only; not reproduced. B1 confirmation uses a single-document read and is unaffected. Recommended as a separate small batch.
- Profile sync, MOQ update and e-mails run in the browser after confirmation; if the browser closes first they are skipped (the order itself is safe). For players today the old flow failed at the rules-denied order write before e-mails, so this is not a regression.
- MOQ status is computed in the browser (bounded by the enum).
- If the webhook takes longer than 60 s, the player sees "being confirmed"; the order appears when the webhook commits.
- Online order ids change format (UUID → `mo_{intentId}`); no code depends on the format.

## 6. Rollback

Revert the B1 commit on `mig-mov`. No data migration or rules change; `mo_` orders created meanwhile keep the same field shape and remain valid. Nothing is deployed.

## 7. Read-only QA prompt (for a future, separately authorised staging run)

> You are an independent, read-only QA reviewer for KAvach Play B1 (PX-1 + FIN-004). Environment: [staging URL and deployed commit, supplied by the owner]. Razorpay **test mode** only. Do not modify code, configuration, rules, data or permissions; do not use live keys or real money.
> 1. As a player, buy one shop item online with a Razorpay test method. Expect: after the gateway success, a "Payment received, confirming order..." state, then a success message; exactly one Paid order for that purchase, with id beginning `mo_`.
> 2. Repeat and close the dialog during "confirming". Expect: an informational "being confirmed" message, no error, and the order still appears for an administrator.
> 3. Close the browser tab immediately after the gateway success. Expect: the order still exists (administrator view).
> 4. As an administrator, place an online order. Expect: exactly one Paid order (no unlinked duplicate).
> 5. Free (₹0) item and administrator manual / offline order: unchanged behaviour.
> 6. Report Pass / Fail / Blocked per step, with screenshots and console errors. Inaccessible steps are Blocked, not Passed.
