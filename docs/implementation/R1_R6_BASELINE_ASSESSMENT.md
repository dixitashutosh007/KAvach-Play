# KAvach Play — R1–R6 Security & Payment Remediation: Baseline Assessment

**Type:** Read-only baseline assessment (no application code, rules, data or config changed)
**Date:** 2026-11-23
**Branch:** `mig-mov`
**Assessed HEAD:** `338a2db02269cffd4b5e2840058cd49efceaea1a`
**Requested baseline:** `a10d3b71` (5 commits behind assessed HEAD; see §1)
**Reviewer of record:** ChatGPT (independent). Every status below is self-assessed: nothing here is ACCEPTED.

---

## 1. Repository state

| Item | Value |
|---|---|
| Remote | `https://github.com/dixitashutosh007/KAvach-Play` |
| Local checkout at session start | `c0e089e`, which was **10 commits behind** `origin/mig-mov` (stale clone, not user work) |
| Action taken | `git merge --ff-only` to `origin/mig-mov`. This was a non-destructive fast-forward: the working tree was clean and nothing was overwritten |
| Assessed HEAD | `338a2db` (`docs(qa): record D-19 full e2e and build results`) |
| `a10d3b71..338a2db` | 5 commits, all D-18/D-19 admin-navigation UX and docs |
| Security-relevant delta since `a10d3b71` | **None.** `git diff a10d3b7..HEAD` is empty for `lib/server-auth.ts`, `firestore.rules`, `app/api/**`, `lib/razorpay*` |
| Working tree | Clean (only this document added) |

Conclusion: the R1–R6 findings apply to the current HEAD exactly as they applied to `a10d3b71`. No recent commit addresses any of them.

---

## 2. Baseline matrix

| Finding | Existing implementation (verified) | Reproducible? | Proposed correction | Regression risk |
|---|---|---|---|---|
| **R1** Token revocation | `requireAuth()` calls `verifyIdToken(token)` **without** `checkRevoked` (`lib/server-auth.ts:239`). `requireAdmin()` (`:353`) and `requireRole()` (`:498`) pass `true`. `requireAuth` is used by `app/api/razorpay/order/route.ts:38`, `app/api/player/link-account/route.ts:7` and `app/api/player/link-google/route.ts:13`. These are the payment and account-linking endpoints. | **Confirmed in source.** A revoked, deleted or Firebase-Auth-disabled user keeps a working token for up to 1 h on these three endpoints. App-level `appUsers.status == "Disabled"` *is* enforced (`:256-270`). Runtime reproduction is pending: Auth emulator test not yet written. | Add an explicit revocation policy to `requireAuth` (default `checkRevoked: true`, plus an opt-out parameter for documented low-risk callers). Map `auth/id-token-revoked`, `auth/user-disabled` and `auth/user-not-found` to 401, and map Auth-backend unavailability to 503 (fail closed). Signature stays backward compatible. | **Low.** One extra Auth backend lookup per call on three endpoints. Risk: an Auth-backend outage now blocks payment initiation (fail-closed, intended). |
| **R2-A** `appUsers` enumeration | `allow read: if isSignedIn()` (`firestore.rules:118`). The client already loads the full collection only for admins (`app/page.tsx:480-485`, `hooks/useStore.ts:1053`), but the **rule** permits any player to `getDocs(collection(db,"appUsers"))` from the console. | **Confirmed in source.** No emulator test asserts a cross-user `appUsers` read in either direction. | `allow get: if request.auth.uid == userId \|\| isAnyAdmin()`; `allow list: if isAnyAdmin()`. Write rules unchanged. | **Low–Medium.** Non-admin code paths read only their own doc (`useStore.ts:257,441`, `AuthProvider.tsx:87`, onboarding screens). A full grep for other-user reads is still needed. |
| **R2-B** `players` PII | `allow read: if isSignedIn()` (`firestore.rules:573`). `hooks/useStore.ts:478` subscribes to the **entire** `players` collection for **every** signed-in user at load, which ships `mobile`, `email`, `dob`, `bloodGroup`, `emergencyContact`, `locality` and sizes (`lib/types.ts:80-105, 233-260`) to every browser. Directory, squad and match screens display `mobile` (`PlayersTab.tsx:113,269,424`; `MatchesTab.tsx:1750,2724,2879`). | **Confirmed in source and by design.** This is not a rule bug alone: the client data model depends on it. | Firestore rules cannot filter fields, so this needs a **data split**: keep public directory fields on `players/{id}` and move private fields to `players/{id}/private/profile` (or `playerPrivate/{id}`), readable by self and the authorised roles only. Requires a server migration (dry-run, idempotent, ID-preserving), dual-read compatibility, client changes and an **owner decision on which role sees which field** (see §5). | **High.** Touches the registration, profile, directory, squad, match, Studio CRM, dues/reminders (mobile for WhatsApp), merge and identity code. Must be staged: (1) add private doc and dual-write, (2) migrate, (3) switch readers, (4) strip fields from public doc and tighten rules. |
| **R2-C** related collections (found during assessment) | `subscriptionHistory` `allow read: if isSignedIn()` (`firestore.rules:401`), although the client comment says non-admins never load it. `razorpayIntents.rawPayload` stores the full gateway payload (payer email/contact/method) (`lib/razorpay-webhook.ts:526`). That collection is server-only by default-deny, so it is a data-minimisation issue, not an exposure. | Confirmed in source. | Tighten `subscriptionHistory` reads to self + Studio/Finance/Super Admin. Stop persisting `rawPayload`; keep only the identifiers needed. | Low. |
| **R3** Webhook error classification | `route.ts:69-82`: **every** exception from `processWebhookIntentTransaction` returns **400**. That covers Firestore/infra errors, contention exhaustion, "Intent not found", validation mismatches, and `"merge is currently in progress; retry requested"` (`lib/razorpay-webhook.ts:246`), which explicitly *wants* a retry. Malformed JSON after a valid signature falls to the outer catch and returns **500** (backwards). A non-success result also returns 400. Signature handling is sound: raw body, HMAC-SHA256, `timingSafeEqual` with a length guard (`route.ts:35-56`). | **Confirmed in source.** No test calls the webhook **route**. `tests/razorpay-webhook-negative.test.mjs` exercises the library helpers only and makes no HTTP status assertions. | Add typed errors (`PermanentWebhookError` / `TransientWebhookError` / `RetryableStateError`). Classify Firestore gRPC codes (`UNAVAILABLE`, `DEADLINE_EXCEEDED`, `ABORTED`, `RESOURCE_EXHAUSTED`, `INTERNAL`) as transient → 503. Validation mismatches → durable record + non-fulfilment. Malformed JSON → 400. Add a correlation ID and a safe log line, with no secrets or payload. | **Medium.** Behaviour change is visible to the gateway. **Must verify first:** Razorpay's documented retry policy reportedly retries on *any* non-2xx and may disable a webhook after sustained failures. If so, "400 = permanent" is a false premise: permanent failures should return 2xx *after* a durable dead-letter record, and transient ones 5xx. Design depends on this check. |
| **R4** External order duplication | Reservation design is solid for Firestore state: deterministic key, random token, monotonically increasing `fenceVersion`, 60 s lease renewed every 5 s during `orders.create` (`route.ts:513-536`), `leaseLost` → 409 without returning the order, paid/reconciliation states never taken over (`lib/razorpay-order.ts:330-352`), expired *active* orders reconciled not replaced (`:362-407`), multi-order reconciliation conflict detection (`:860-878`). **Gap:** an **expired `reserving`** reservation is taken over **without reconciling against Razorpay first** (`lib/razorpay-order.ts:410-435` falls through to fresh acquisition), even when `intentId` was already stored (`setReservationIntentId`, called before `orders.create` at `route.ts:495`). This proves the old holder reached the gateway call. The receipt is deterministic per obligation (`:189-195`), and Razorpay does not enforce receipt uniqueness, so A and B create **two orders with the same receipt**. The existing test `razorpay-concurrent-orders.test.mjs:229` reproduces this takeover but asserts only Firestore fencing. It never counts gateway orders. | **Confirmed in source; not yet reproduced with a counting mock gateway.** Trigger needs A's lease renewals to stop for ≥60 s while its gateway call later succeeds: process/function kill or timeout after the request was sent, or Firestore unreachable from A only. The stale A never returns its order to the browser (409 or 500), so **double collection through the normal UI is unlikely**. The concrete harm: orphan gateway orders, and a later `orders.all({receipt})` reconciliation hitting the "multiple orders → manual intervention" path, which **blocks that obligation from being paid**. Webhook fulfilment is idempotent per *intent*, not per *obligation*, so if both orders were ever paid, two intents would fulfil the same obligation. | On takeover of an expired `reserving` reservation that has `intentId` set, move to `reconciliation_required` and reconcile by receipt **before** creating a new order. Adopt a found order if exactly one valid one exists. Make the webhook obligation-idempotent: a second paid intent for an already-paid reservation goes to the dead-letter/refund-review path rather than fulfilling again. Document the guarantee honestly: *at-most-one payable order exposed to the client; duplicate gateway orders detectable and non-fulfilling*, not exactly-once creation. Verify whether Razorpay Orders supports an idempotency header (believed not; to confirm). | **Medium–High** (financial path). Mitigated by the 329-test emulator suite plus new counting-gateway scenarios. |
| **R5** Unmatched webhooks | `route.ts:60-64`: valid-signature `payment.captured`/`order.paid` with no `notes.intentId` → **200 "No intentId attached"**, with no record. Unknown intent → throws `Intent not found` → 400, no record. Paid intent receiving a **different** `paymentId` → throws `Conflicting payment ID replay` (`lib/razorpay-webhook.ts:202-208`) → 400, no record. **That is real captured money with no ledger entry.** Other event types (`payment.failed`, `refund.*`) → 200 silently. | **Confirmed in source.** No dead-letter collection exists (grep: none). | New server-only collection `webhookDeadLetters/{eventKey}` keyed by `x-razorpay-event-id` (fallback: `event:paymentId`), created idempotently with order ID, payment ID, event, amounts, timestamp, classification and reason. No raw payload or PII. Never touches ledgers. Add a Finance/Super-Admin-only list/resolve API with a recorded outcome (`resolved_linked`, `refund_initiated`, `ignored_test`, …). Rules: read for `isFinanceAdmin() \|\| isSuperAdmin()`, no client writes. | **Low–Medium.** Additive. Response-code policy depends on the R3 Razorpay retry check. |
| **R6** Integration & regression tests | Strong existing base: **329/329 emulator tests pass, 0 skipped** (`npm run test:emulator`, run 2026-11-23). Targeted unit files: `server-auth` 10/10, `razorpay-webhook-negative` 19/19, `razorpay-webhook-concurrency` 9/9, `razorpay-concurrent-orders` 29/29, `razorpay-lifecycle` 9/9, `razorpay-tamper` 16/16. **Gaps:** (a) no Auth-emulator test for revoked/disabled/deleted tokens: `server-auth.test.mjs` mocks `verifyIdToken` and covers `requireAdmin` only, **not `requireAuth`**; (b) no rules test for cross-player `players`/`appUsers` reads; (c) no HTTP-level webhook route tests with status assertions; (d) no gateway-order **count** assertions in concurrency tests; (e) no dead-letter tests. | n/a | Add, per phase: Auth-emulator guard tests (R1); rules tests using the app's real query shapes, including `collection("players")`, `collection("appUsers")`, `collectionGroup` (R2); route-level webhook tests via `POST(new NextRequest(...))` with real HMAC against the emulator (R3/R5); counting mock gateway with controllable delay/loss/kill (R4). Each new test must be shown failing on the pre-fix code. | Low. CI already runs emulator tests (`.github/workflows/ci.yml`). The Auth emulator must be added to `firebase.json`. |

---

## 3. Environment and test readiness

| Capability | Status in this session |
|---|---|
| `npm ci` | Works |
| Firestore emulator (Java present) | Works: 329/329 |
| Firebase **Auth** emulator | Not configured in `firebase.json` (only `firestore`); needed for R1 |
| Staging environment | **Not identified.** `play.kavachcricket.com` is production. No browser/E2E testing against a live environment will be done |
| Real Razorpay | Not used. All gateway behaviour will be mocked |
| Build / `tsc --noEmit` | Not yet run in this assessment; will run before the first commit |

---

## 4. Dependencies and proposed sequence

```
R1 (auth guard)  ──────────────┐
R2-A, R2-C (rules, low risk) ──┤
R3 (error taxonomy) ──► R5 (dead-letter uses R3's classes) ──► R4 (dup orders route to dead-letter)
R2-B (PII split: migration) ───┘                                        │
                                   R6: tests built per phase, plus final cross-cutting regression pass
```

Proposed order:

1. **R1**: smallest, isolated, P1, no data impact.
2. **R2-A + R2-C**: rule-only tightening with emulator tests.
3. **R3**: after confirming Razorpay's retry semantics.
4. **R5**: needs R3's classification. Closes the unrecorded-captured-money gap.
5. **R4**: needs R5's dead-letter path for duplicate paid orders.
6. **R2-B**: largest change. Needs the owner's field-visibility decision and a migration plan approved **before** any code; proposed as its own design doc + migration dry-run first.
7. **R6**: final regression, build, tsc, full emulator and functional suites.

R2-B is moved after the payment work because it requires a data migration and owner decisions, while R3–R5 do not.

---

## 5. Owner decisions

| # | Decision | Status |
|---|---|---|
| 1 | **Branch:** remediation commits go directly to `mig-mov` (owner, 2026-11-23). This overrides the `AGENTS.md §11` default for this programme. | **Decided** |
| 2 | **R1 scope:** apply revocation checks to all three `requireAuth` callers (order, link-account, link-google). The owner asked for an explanation (given in session); approval is pending. | **Pending** |
| 3 | **R2-B:** "Players should not see other players' data" (owner, 2026-11-23). Ordinary players get **no** private fields of other players (`mobile`, `email`, `dob`, `bloodGroup`, `emergencyContact`, `locality`, sizes). This removes other players' mobile numbers from player-facing directory and squad screens. | **Decided** (principle) |
| 3a | **R2-B public fields:** working assumption is that players still see name, photo, jersey name/number, playing role/styles, badges and stats, which the Directory, squads, leaderboard and match cards need. Owner to confirm. | **To confirm** |
| 3b | **R2-B admin field access** under D-19 (Match Admin and Studio Admin retired → Club Admin). Proposed: Self, Super Admin and Club Admin: all fields. Finance Admin: `mobile`, `email` only (reminders/receipts), with no `dob`/`bloodGroup`/`emergencyContact`/sizes. Designer: none. | **To confirm** before R2-B design |

## 6. Additional observations (not new vulnerabilities; tracked here)

- No more serious vulnerability was found that would require stopping before R1.
- `getUserAccount` still honours legacy `appUsers.role == "clubAdmin"` etc. (`lib/server-auth.ts:139-148`). This is safe only because `firestore.rules:119-135` blocks self-writes of `role`. R6 should include an emulator test pinning that invariant.
