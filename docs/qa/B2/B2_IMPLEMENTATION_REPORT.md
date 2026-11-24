# B2 Implementation Report: Core Duplicate-Settlement Protection (all categories)

**Authorised scope:** `docs/implementation/R4_RIGHT_SIZED_ARCHITECTURE_PROPOSAL.md` revision 3 (`6d95dd0`), batch B2.
**Branch:** `mig-mov`, base `b8f0e80200043340c00ee660f513a1e056f51c6f` (B1). `main` unchanged at `f5739726e75a2e6594c7379bdbfc8a866c63f787`.
**Deployment:** none. No Firestore rules change or deployment, no workflow dispatch, no migration, no Razorpay call (SDK stubbed in tests; any network attempt throws).

## 1. What changed

| File | Change |
|---|---|
| `lib/payment-decision.ts` (new, pure) | P1–P7 `decidePaymentApplication`; §15 classifiers (match fee, other fee, dues merch, shop merch); §18 interim late-fee guard (same predicate as the dues screens); §16 `assessRenewal` (basis compare-and-set, `max(basis, club today) + duration`, never shrinks); bundle rule (all payable → APPLY; all blocked SETTLED → DUPLICATE; else HOLD; empty → HOLD) |
| `lib/razorpay-webhook.ts` | `processWebhookPayment`: ONE Firestore transaction reads the registry record, intent, every obligation, reservation and dead-letter, decides, then performs exactly one write set. `processWebhookIntentTransaction` kept as a compatibility wrapper (throws the previous errors only after the record has committed). `resolveRenewalSubject`, `renewalAnchorId` |
| `lib/webhook-dead-letter.ts` | `planWebhookDeadLetter` (read now, write later, inside the caller's transaction); new reasons and classifications (`duplicate_payment`, `held_for_review`, `identity_conflict`) |
| `app/api/razorpay/webhook/route.ts` | Uses `processWebhookPayment`; 200 only after commit; non-applied outcomes → `recorded_for_reconciliation` with `decision` and `code`; failures → 503 |
| `lib/razorpay-order.ts` | Subscription intents carry an immutable `renewal` snapshot; the interim late-fee guard stops offering a late fee already recorded or exempted for (player, match) |
| Tests | 2 new files (15 unit + 28 emulator tests); fixture / mock-fidelity / expectation updates listed in §5 |

## 2. Data model

| Record | Change |
|---|---|
| `gatewayPayments/{paymentId}` (new, server-only; catch-all deny) | `{paymentId, orderId, amountPaise, currency, intentId, intentType, playerId, event, firstEventId, recordedAt, application: applied \| rejected_duplicate \| unmatched \| held_for_review, reasons[], appliedTo[] (APPLY), followUps[] (renewal mirror notes), source: webhook \| pre_cutover_replay}`. Created once with `create()`; never updated |
| `razorpayIntents/{id}` | New statuses `paid_unapplied` (DUPLICATE) and `exception` (HOLD), with `razorpayPaymentId` and `exceptionReason`. Subscription intents gain `renewal {version, subjectKind, subjectId, planId, planName, durationDays, amountPaise, basisExpiry}` |
| `subscriptionHistory/sub_<sha256>` | Deterministic renewal anchor per (subject, basis expiry), `create()` only; adds `subjectKind`, `renewalBasis`, `durationDays`, `amountPaise`, `intentId` to the existing history fields |
| Obligation documents | APPLY also writes `gatewayPaymentId`. Existing fields are unchanged (including today's `feeCollectedAmount` semantics) |
| `paymentReservations/{key}` | DUPLICATE / HOLD set `status: exception` + `exceptionReason` (the rejected order is never re-offered) |
| `webhookDeadLetters` | New reason codes and classifications; identity conflicts use `conflict_<paymentId>_<hash>` so the original record is untouched |

## 3. Transaction and concurrency guarantees

- One transaction per captured payment, all reads before writes. Registry record, obligation writes, intent status, reservation status and dead-letter commit together or not at all.
- Two payments for one obligation serialise on the obligation document: one APPLY, the other DUPLICATE (B2-01, B2-02 × 5).
- Duplicate deliveries serialise on the registry document; a `create()` collision (`ALREADY_EXISTS`) re-runs once and resolves to REPLAY (B2-03).
- Studio renewal: anchor `create()` + expiry compare-and-set in the same transaction (B2-S2, B2-S3).
- Failure before commit → 503, nothing recorded (B2-16, B2-17). Lost acknowledgement → redelivery is a zero-write REPLAY (B2-18).
- Logs and responses report "recorded" only after the commit.

## 4. Validation (executed 2026-11-24 in the session container)

| Command | Exit | Result |
|---|---|---|
| `npm run test:functional` | 0 | 1072 tests, 1072 pass, 0 fail. 23 emulator-only suites skip at suite level by design in this command (`FIRESTORE_EMULATOR_HOST` not set); they run in the next row |
| `npm run test:emulator` | 0 | 444 tests, 444 pass, 0 fail, 0 skipped (B1 baseline 416 + 28 new) |
| `npx tsc --noEmit` | 0 | no diagnostics |
| `npm run build` | 0 | compiled, no warnings |

**Observed once, not reproduced:** during development, B2-S2 (two concurrent renewals for one period) failed in one run of `tests/b2-duplicate-settlement.emulator.test.mjs`. The failure output had no diff detail, and the same run also had an unrelated S8 failure (since fixed). In 9 subsequent consecutive runs and the full suite run, S2 passed. The cause is not established. The test now writes the full responses to stderr if the outcome is ever not exactly one "processed" + one "duplicate".

**Blocked:** end-to-end browser checkout (payments disabled outside production; no staging authorised).

## 5. Existing tests changed (and why)

| Test | Change | Reason |
|---|---|---|
| `razorpay-webhook-concurrency` (2), `emulator-webhook-concurrency` (match), `r3` R3-17, `remediation1f` S65/S83/S84/S85 | Fixtures now include the match document and payer that every real match intent has | Before B2 a missing obligation was silently skipped and the intent marked paid; B2 holds it (owner rule: never skip) |
| `server-security-phase5` Scenario 9 (4), `razorpay-webhook-negative`, `razorpay-webhook-concurrency` | Mocks model `create()`, collection reads and per-collection documents | The transaction now reads several documents; a mock returning the intent for every read made a replay look like an identity conflict |
| `r5` R5-04, R5-12 | A redelivery of an already-recorded payment is a zero-write REPLAY; the dead-letter keeps its first sighting | Registry absorbs redeliveries (§3.4 REPLAY: no writes) |
| `r5` R5-10 | Store outage → 503 `INFRASTRUCTURE` (was 503 `DEAD_LETTER_WRITE_FAILED`) | The record is written inside the payment transaction; still never 200 |
| `px1` B1-09 | Existing `mo_` → recorded as duplicate (`rejected_duplicate`, intent `paid_unapplied`); order still untouched | §15: an existing shop order classifies as SETTLED |

No assertion was removed or loosened to obtain a pass. Every changed expectation describes the B2 behaviour.

## 6. Deviations from revision 3 (for review)

1. **Compatibility wrapper.** `processWebhookIntentTransaction` remains (direct callers and tests use it). It throws the previous errors after the record has committed. The route uses `processWebhookPayment`.
2. **Renewal subject.** The subject is the linked player (`appUsers.playerId`, a player keyed by the uid, or exactly one player with `authUid` = uid, following merges). If there is no player, the subject is the account document (account-only Studio members), not MISSING. Revision 3 §16 assumed a player always exists.
3. **Snapshot scope.** B2 uses the existing server-derived intent fields (per-item amounts, match fee = amount − late fees) as the immutable snapshot for match fees, other fees, late fees and merchandise. Only subscriptions get a new explicit `renewal` snapshot. The generalised `obligations[]` snapshot remains B6.
4. **Order-route rejections not in B2.** The 409 `OBLIGATION_NOT_PAYABLE` for unpayable selections and the ≤ 20 bundle limit are B6 (unchanged plan); the webhook already never skips or partially applies.
5. **Reservation after DUPLICATE / HOLD.** Set to `exception`. The existing acquisition logic treats it like a released reservation, so a still-unpaid obligation can be paid with a **new** order; the rejected order is never re-offered.
6. **Studio writes.** The renewal now updates the linked player document (previously only `players/{uid}`, which exists only when the player id equals the uid), and a missing `appUsers` document is no longer created (§16).

## 7. Known gaps and observations

- Finance sees every non-applied capture through the existing R5 dead-letter list. `gatewayPayments` has no client read rule (rules unchanged in B2); a Finance read rule belongs with the Phase 3 dashboard.
- Late fees keep their per-intent `lf_` identity until B3; B2 adds the interim guard only.
- P4 orphan-order adoption is B7: an intent without an order id is still UNMATCHED.
- Observed, not changed: for a match intent, `feeCollectedAmount` is set to the whole intent amount, including late fees that are also recorded as separate late-fee documents (pre-existing behaviour, kept unchanged in B2).
- Single unreproduced S2 failure (§4).
