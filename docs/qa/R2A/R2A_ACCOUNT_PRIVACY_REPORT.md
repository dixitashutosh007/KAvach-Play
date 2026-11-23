# R2-A / R2-C — Account and Membership-History Privacy, Webhook Data Minimisation

**Status:** IMPLEMENTED: automated verification passed; awaiting independent review (not ACCEPTED)
**Branch:** `mig-mov` (owner-approved)
**Base SHA:** `459bf21`
**Date:** 2026-11-23
**Environment:** Local Firestore emulator only. **Rules are not deployed anywhere** (see §6).

R2-B (splitting private fields out of `players`) is a separate, later workstream and is **not** addressed here.

---

## 1. Defects

| ID | Defect | Location at base |
|---|---|---|
| R2-A | Any signed-in user could read **every** `appUsers` document (name, email, mobile, roles, status, linked playerId), by direct get, full listing or filtered query. The app only loaded the list for admins, but nothing enforced it. | `firestore.rules:118` `allow read: if isSignedIn();` |
| R2-C1 | Any signed-in user could read **all** Studio membership history (who paid, how much, plan, expiry). | `firestore.rules:401` `allow read: if isSignedIn();` |
| R2-C2 | The webhook stored Razorpay's **entire** event payload on the intent (`rawPayload`), including payer email, phone, UPI VPA and card details. Server-only collection, so not exposed, but unnecessary PII at rest. Nothing reads it. | `lib/razorpay-webhook.ts:526` |

## 2. Reproduction (before fix)

`npm run test:emulator -- tests/r2a-account-privacy.emulator.test.mjs`: **9 of 17 failed** (`docs/qa/R2A/r2a-emulator-before-fix.txt`). A player could read another player's account (R2A-02), list all accounts (R2A-03), filter accounts by admin flag, email or playerId (R2A-04), list all membership history and read another player's (R2C-01/02). Designer-only and *disabled* admins could list accounts (R2A-06/07). The stored intent contained `rawPayload` (R2C-07). All positive and regression cases already passed.

## 3. Fix

| File | Change |
|---|---|
| `firestore.rules`: `appUsers` | `allow get` if own doc **or** `isAnyAdmin()`; `allow list` only `isAnyAdmin()`. Write rules unchanged. |
| `firestore.rules`: `subscriptionHistory` | `allow read` if `isAnyAdmin()` **or** the record's `playerId` belongs to the caller (`isSelf`). Create/update/delete unchanged (admin create, immutable). |
| `lib/razorpay-webhook.ts` | Intent stores `gatewayEvent: { event, orderId, paymentId, amountPaise, currency }` instead of `rawPayload`. The parameter is kept, renamed `_rawPayload`, so callers do not change. |
| `app/page.tsx` | The admin-only listeners for all accounts and membership history now start only for roles the rules allow (Super/Club/Finance and the legacy Match/Studio flags). A **Designer-only** account is an admin for navigation but does not subscribe, so it no longer runs a listener that would always be denied. `DesignTab` uses neither collection (checked). |

`isAnyAdmin()` = active account with the `admin` claim or `isClubAdmin` / `isFinanceAdmin` / `isMatchAdmin` / `isStudioAdmin`. Designer is deliberately excluded. Disabled accounts are excluded.

**Existing data:** intents already holding `rawPayload` are **not** modified. Removing it is a production data write and needs separate owner approval (proposed as an optional, dry-run-first cleanup script).

## 4. Test evidence (executed 2026-11-23, local)

| Command | Executed | Pass | Fail | Skipped |
|---|---|---|---|---|
| R2-A/C file, before fix | 17 | 8 | **9** | 0 |
| R2-A/C file, after fix | 17 | 17 | 0 | 0 |
| `npm run test:emulator` (full) | 370 | 370 | 0 | 0 |
| `npm run test:functional` (full) | 1035 | 1035 | 0 | 0 |
| `npx tsc --noEmit` | n/a | exit 0 | n/a | n/a |
| `npm run build` | n/a | exit 0 | n/a | n/a |
| `npx eslint app/page.tsx <test>` | n/a | 0 errors (`app/page.tsx` is ignored by the current ESLint config, as before) | n/a | n/a |

Rules tests use the app's real query shapes: `collection("appUsers")` (ensureAllAppUsers), `doc("appUsers", uid)` (self listener, AuthProvider, onboarding) and `collection("subscriptionHistory")` (ensureSubscriptionHistory). They also cover attacker shapes: filtered queries and other-player IDs. R2C-07 runs the production `processWebhookIntentTransaction` against the emulator via firebase-admin. Nothing is mocked.

| Required scenario | Test |
|---|---|
| Player A cannot read Player B's account data | R2A-02, R2A-04 |
| Unauthorised collection queries fail | R2A-03, R2A-04, R2C-01, R2C-02 |
| Authorised admins can read what they need | R2A-05, R2C-04 |
| Role/privilege fields still protected from client modification | R2A-09 |
| Own account and onboarding flows still work | R2A-01, R2A-10, R2C-03 |
| Webhook stores no unnecessary PII | R2C-07 |

## 5. Security, finance and data impact

- **Security:** closes cross-account and membership-history enumeration for ordinary players, Designer-only accounts and disabled admins.
- **Finance:** webhook fulfilment logic is unchanged; only the stored audit field changed. Payment identifiers, amount and currency are still recorded.
- **Data:** no schema migration, and existing documents are untouched.

## 6. Deployment status and caution

- **Local only.** `firestore.rules` changes take effect only when rules are deployed. `.github/workflows/deploy-firestore-rules.yml` deploys **only on push to `main`** (or manual dispatch), so pushing to `mig-mov` does not deploy rules.
- `firebase.json` maps **both** Firestore databases (production `ai-studio-…` and `kavach-play-db-ext`) to the same `firestore.rules`, so any rules deployment updates both.
- Pushes to `mig-mov` may trigger an Amplify app build if that branch is connected in Amplify. The client change is harmless without the rules (it only narrows which accounts subscribe). Amplify branch mapping could not be verified from the repository.

## 7. Limitations and residual risk

1. **R2-B is still open:** `players` documents, including mobile, email, DOB, blood group and emergency contact, remain readable by every signed-in user, and the app loads them all. This is the larger privacy gap and needs the planned data split.
2. Not verified in a browser or staging environment, as none has been identified.
3. Independent QA has not run.
4. Existing `rawPayload` values in production intents remain until an approved cleanup.
