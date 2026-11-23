# R1 — Authentication Revocation and Session Security: Remediation Report

**Status:** IMPLEMENTED: automated verification passed; awaiting independent review (not ACCEPTED)
**Branch:** `mig-mov` (owner-approved, 2026-11-23)
**Base SHA:** `a654853`
**Date:** 2026-11-23
**Environment:** Local only (Firebase Auth + Firestore emulators). Nothing deployed. No production data, no real Razorpay calls.

---

## 1. Defect

`requireAuth()` verified Firebase ID tokens with `verifyIdToken(token)` and **no revocation check** (`lib/server-auth.ts:239` at base). Its three callers are all sensitive:

| Endpoint | Purpose |
|---|---|
| `POST /api/razorpay/order` | Payment initiation |
| `POST /api/player/link-account` | Link login to a player record (phone) |
| `POST /api/player/link-google` | Link login to a player record (Google email) |

An ID token lives for up to 1 hour. Until then, a user who had been revoked (signed out everywhere, or a password change on email login), **disabled in Firebase Auth**, or **deleted** could still create payment orders and link accounts. In-app `appUsers.status == "Disabled"` was already enforced and is unchanged.

## 2. Reproduction, and an emulator limitation found on the way

firebase-admin **always** checks revocation, disabled and deleted status when connected to the Auth emulator, whatever the code asks for (`node_modules/firebase-admin/lib/auth/base-auth.js:121`: `if (checkRevoked || isEmulator)`). **The Auth emulator therefore cannot reproduce R1.** Any emulator-only evidence about revocation can't tell fixed code from unfixed code. That includes the earlier `FINAL_SECURITY_PAYMENT_REMEDIATION_REPORT.md` claims, which relied on a mocked SDK.

The reproducer (`R1-P*` block) switches the same Auth instance that production code uses into **production verification mode**. Only Google's JWT signature check is replaced, because emulator tokens are unsigned. The revoked, disabled and deleted lookups run for real against the Auth emulator. Precondition test `R1-P0` proves that in this mode `verifyIdToken(token)` accepts a revoked token.

**Before the fix**, 12 of 24 tests failed (`docs/qa/R1/r1-emulator-before-fix.txt`):

| Test | Before fix |
|---|---|
| R1-P2 revoked token → `requireAuth` | **accepted** |
| R1-P3 Firebase-disabled account → `requireAuth` | **accepted** |
| R1-P4 deleted account → `requireAuth` | **accepted** |
| R1-P5 revoked player → order route | **400**: passed auth and reached currency validation |
| R1-P6 revoked user → link-account | **400**: passed auth and reached body validation |
| R1-P7 Firebase-disabled user → link-google | **403**: passed auth and reached linking logic |
| R1-03/04/05/10b/10d | Failed on missing `code` field (emulator masking means these check mapping, not access) |
| R1-11 Auth backend outage | Returned 401 instead of 503 |

## 3. Fix

| File | Change |
|---|---|
| `lib/server-auth.ts` | `requireAuth` now calls `verifyIdToken(token, true)`. New shared `tokenVerificationFailure()` used by `requireAuth`, `requireAdmin` and `requireRole`: 401 `"Invalid or expired token."` (unchanged text) plus a `code` (`TOKEN_REVOKED`, `ACCOUNT_DISABLED`, `ACCOUNT_NOT_FOUND`, `TOKEN_EXPIRED`, `TOKEN_INVALID`). Auth-backend unavailability (`auth/internal-error`, `app/network-error`, `app/network-timeout`) returns **503 `AUTH_UNAVAILABLE`** and fails closed; before, this was misreported as 401. Nothing from the token or raw error is returned or logged. |
| `lib/id-token-fetch.ts` (new) | `fetchWithIdToken()`: on 401, force-refreshes the ID token **once** and resends. If Firebase refuses the refresh (session genuinely ended), it throws `SessionEndedError` ("Your session has ended. Please sign in again."). No Firebase import, so it is unit-tested with production code. |
| `lib/authed-fetch.ts` | Delegates to `fetchWithIdToken`. Signature unchanged. |
| `app/page.tsx` | The two account-link calls used raw `fetch` with a manually attached token; they now use `authedFetch`, so they get the refresh-once behaviour. Request bodies and headers are otherwise identical. |
| `firebase.json`, `scripts/run-emulator-tests.mjs` | Auth emulator added (port 9099) to the emulator test run. |

**Design decisions**

- **No opt-out parameter on `requireAuth`.** All three current callers are sensitive, so revocation is always checked. If a future low-risk endpoint needs to avoid the extra lookup, add an explicit option then, with justification.
- **Persistent login is unchanged.** Firebase client persistence (`lib/firebase.ts:40`, IndexedDB/local) and silent token refresh are untouched. Users stay signed in until they sign out or are deliberately removed. Tests R1-06 and R1-P8 show that a user can sign in again after a revocation.
- **Cost:** one Firebase Auth `getUser` lookup per call on the three endpoints. Admin routes already paid this.
- **Recent-authentication (step-up) for sensitive actions:** reviewed and **not added**. The owner wants persistent login and has not asked for re-authentication prompts. Recorded as a residual consideration, not a defect.

## 4. Test evidence (all executed 2026-11-23, local)

| Command | Executed | Pass | Fail | Skipped |
|---|---|---|---|---|
| `npm run test:emulator -- tests/r1-token-revocation.emulator.test.mjs` (before fix) | 24 | 12 | **12** | 0 |
| same (after fix) | 24 | 24 | 0 | 0 |
| `node --test tests/r1-id-token-fetch.test.mjs` | 6 | 6 | 0 | 0 |
| `npm run test:emulator` (full emulator suite incl. R1; Auth emulator now running for all files) | 353 | 353 | 0 | 0 |
| `npm run test:functional` (all `tests/*.test.mjs`) | 1035 | 1035 | 0 | 0 |
| `npx tsc --noEmit` | n/a | exit 0 | n/a | n/a |
| `npm run build` | n/a | exit 0 (`✓ Compiled successfully`) | n/a | n/a |
| `npx eslint <changed files>` | n/a | 0 errors | n/a | n/a |

Notes:

- Under `npm run test:functional`, the emulator-only R1 file is a no-op: it skips at suite level because the emulators are not running. Under `npm run test:emulator`, a missing Auth emulator **throws** rather than skipping.
- ESLint ignores `lib/*.ts` ("no matching configuration"). This pre-dates R1 and is recorded, not fixed here.
- Mocked elements: R1-11 (Auth outage, mocked SDK error code) and the JWT signature step in the R1-P block. Everything else runs against real emulators and the real route handlers.

Test files: `tests/r1-token-revocation.emulator.test.mjs` (R1-01 … R1-11, R1-P0 … R1-P8), `tests/r1-id-token-fetch.test.mjs`.

Required scenarios from the brief:

| Required test | Covered by |
|---|---|
| Valid token succeeds | R1-01, R1-P1, R1-10a/d/e (valid) |
| Expired token fails | R1-02 |
| Revoked token fails | R1-03, R1-P2 |
| Disabled account fails | R1-04, R1-P3 (Firebase), R1-07 (in-app) |
| Deleted account fails | R1-05, R1-P4 |
| Player cannot access admin endpoints | R1-09 |
| Revoked player cannot initiate Razorpay order | R1-10b, R1-P5 |
| Revoked user cannot link another account | R1-10d, R1-P6, R1-P7 |
| Legitimate Player and Admin workflows still work | R1-01/06/09/10a, R1-P1/P8, full regression suites |

## 5. Security, finance and data impact

- **Security:** closes the post-revocation access window on payment initiation and account linking. Auth outages now fail closed with an accurate 503.
- **Finance:** no change to amounts, reservations or webhooks. A revoked user can no longer *start* an order.
- **Data:** no schema or data changes. No migration.

## 6. Limitations and residual risk

1. **Firestore direct client access is not covered.** Firestore security rules cannot check token revocation, so a revoked token still works against Firestore directly until it expires (≤1 h). In-app `Disabled` status *is* enforced in rules (`isAccountActive()`). This is a Firebase platform limit.
2. Production-mode verification was exercised with the signature step replaced. Real Google signature verification was not exercised: it needs a real project and real tokens.
3. Not tested in a browser or staging: no staging environment has been identified. The client retry is unit-tested only.
4. Independent QA has not run.

## 7. Deployment status

Local only. Not deployed to staging or production.
