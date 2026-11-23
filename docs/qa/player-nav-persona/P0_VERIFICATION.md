# P0 Security / Financial Verification — Pre-Implementation Gate

**Workstream:** Player Persona Navigation (D-16), branch `fix/player-nav-persona`
**Base:** `mig-mov` @ `c0e089eb86f86ef774610f61e6c51ca2059b0df0` (verified clean, equal to `origin/mig-mov`)
**Date:** 2026-11-23
**Performed by:** implementation agent (self-verification; **not** independent QA)
**Environment:** local container only — Firebase Firestore Emulator, synthetic data. No production or development database access, no Razorpay calls.

## 1. P0 checklist sources

| Source | P0 items |
|---|---|
| `AGENTS.md` §5 | SEC-001, SEC-002, FIN-001 |
| `docs/implementation/SECURITY-RISK-REGISTER.md` | CRIT-01, CRIT-04 (plus SEC-001, SEC-002, FIN-001 in summary matrix) |
| `docs/implementation/PHASE_5_6_INDEPENDENT_AUDIT_PREPARATION.md` §9 | IDT-003 listed as "P0 / High" (AGENTS.md §5 lists it as P2 — severity conflict) |
| `docs/implementation/TEST-BASELINE.md` | P0 test gaps: no Firestore rules tests; no Razorpay webhook tests |

## 2. Results

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| SEC-001 | User-editable role must never grant admin authority | **Closed (verified in source + emulator)** | `firestore.rules:35-41` `isSuperAdmin()` = `admin` custom claim only; `firestore.rules:117-135` self create/update of `appUsers` cannot write `role`, `is*Admin`, `isDesigner`, `canDesign`, `status`, `playerId`. `lib/server-auth.ts:165` super admin from verified token claim only. Note: `lib/server-auth.ts:141-148` still accepts `role === "clubAdmin"` etc. as granular role sources; `role` is not self-writable under current rules (super-admin only), so not an escalation path, but it is a second authority field to retire later (P3 observation). |
| SEC-002 / CRIT-01 | Player cannot self-mark a match payment Paid | **Closed** | `firestore.rules:662-689` player self-update only allows status transitions within `Unpaid`/`Not Playing`; unconditional `status == 'Paid'` clause no longer present. Match Admin manual collection restricted by `isMatchAdminPaymentUpdate` (`firestore.rules:276-292`). Collection-group reads restricted (`firestore.rules:421-427`). |
| FIN-001 | Server derives Razorpay amount | **Closed** | `app/api/razorpay/order/route.ts:81-84` uses `derivePayableAmount()`; client `amount` discarded. Tamper tests pass (`tests/razorpay-tamper.test.mjs`). |
| CRIT-04 | Abandoned matches not billed (D-01 Option A) | **Closed** | `lib/player-dues.ts:62-63` excludes non-billable matches via `isMatchBillable`; `tests/abandoned-match-accounting.test.mjs` passes. |
| Test gap: rules tests | Emulator rules suite exists | **Closed** | 329/329 emulator tests passed (see §3). |
| Test gap: webhook tests | Webhook tests exist | **Closed for covered paths** | `tests/razorpay-webhook-negative.test.mjs`, `razorpay-lifecycle`, `emulator-webhook-concurrency` pass — but see SUB-001 for an uncovered path. |
| **IDT-003** | Subscription webhook resolves canonical `playerId` | **OPEN — reproduced** | See §4. |
| **SUB-001 (new)** | First Studio subscription payment is fulfilled server-side | **OPEN — reproduced** | See §4. |

## 3. Commands executed

| Command | Result |
|---|---|
| `node --test tests/server-auth.test.mjs tests/server-security-phase5.test.mjs tests/razorpay-tamper.test.mjs tests/razorpay-webhook-negative.test.mjs tests/razorpay-lifecycle.test.mjs tests/abandoned-match-accounting.test.mjs tests/finance-d4-rules-static.test.mjs` | 99 tests, 99 pass, 0 fail, 0 skipped |
| `node scripts/run-emulator-tests.mjs` (all `tests/*emulator*.test.mjs` + `tests/firestore-rules.test.mjs`) | 329 tests, 329 pass, 0 fail, 0 skipped |
| Scratch reproduction tests (§4) via `firebase emulators:exec --only firestore` | Both fail, reproducing the defects |

## 4. Open defects

### SUB-001 — First Studio subscription payment cannot be fulfilled (proposed P0)

- **Location:** `lib/razorpay-webhook.ts:469-481` (line 476) writes `oldExpiryDate: currentExpiry || undefined` into `subscriptionHistory`. The Admin SDK is not configured with `ignoreUndefinedProperties` (no occurrence in `lib/` or `app/`), so the transaction throws whenever the player has no prior `studioExpiryDate`/`studioEndDate`.
- **Effect:** `app/api/razorpay/webhook/route.ts:72-80` returns HTTP 400 on every delivery; the transaction rolls back; the intent stays `pending`; the membership is never applied. The player's money is captured by Razorpay but the club record shows no subscription. The error is deterministic, so Razorpay retries cannot succeed.
- **Reproduction (emulator, synthetic):** player `same_id_1` with no expiry, intent `{type:"subscription", userId:"same_id_1", amount:2500}`, `processWebhookIntentTransaction(payment.captured, 250000 paise INR)` → throws `Cannot use "undefined" as a Firestore value (found in field "oldExpiryDate")`; intent status `pending`; player expiry `null`.
- **Why tests missed it:** `tests/emulator-webhook-concurrency.test.mjs` seeds the player with an existing expiry (`2026-12-01`).

### IDT-003 — Subscription identity assumes `playerId === Firebase UID` (proposed P0 per Phase 5/6 audit; P2 per AGENTS.md §5)

- **Location:** `lib/razorpay-order.ts:1531-1555` stores only `userId: authUid` on subscription intents (no canonical `playerId`); `lib/razorpay-webhook.ts:275-283` and `452-455` look up `players/{intent.userId}`.
- **Effect for linked players whose player ID differs from their UID:** the player document is not found. Today this also hits SUB-001 and throws (no fulfilment). If SUB-001 alone were fixed, the webhook would write `subscriptionHistory.playerId = <UID>` and skip the player record — a silent misapplication.
- **Reproduction (emulator, synthetic):** `players/player_repro_1 {authUid: uid_repro_1}`, `appUsers/uid_repro_1 {playerId: player_repro_1}`, subscription intent `userId: uid_repro_1` → same `oldExpiryDate` exception; player expiry unchanged.

## 5. Deployment relevance (not verified)

`cloud.md` states Razorpay is disabled on `mig-mov`. The production deployment commit on `main` has **not** been verified, so whether production carries this webhook code is unknown. Owner should confirm before assessing live impact.

## 6. Gate outcome

Per `AGENTS.md` §10 and the owner's instruction, UX implementation for D-16 is **not started**. Owner decision required on severity and sequencing of SUB-001 / IDT-003.
