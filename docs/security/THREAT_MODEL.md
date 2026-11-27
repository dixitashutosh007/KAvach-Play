# KAvach Play — Application Threat Model

**Governing Policy:** [`docs/security/SECURITY_BASELINE.md`](SECURITY_BASELINE.md)  
**Application Context:** Private cricket club management application (~300 members), Firebase Auth + Cloud Firestore + Next.js App Router API routes + Razorpay.  
**Scope Note:** This threat model evaluates realistic threats for KAvach Play's actual user population and architecture. Theoretical risks are explicitly distinguished from confirmed weaknesses.

---

## Threat Matrix Overview

| ID | Threat Category | Primary Threat Actor | Current Posture |
|---|---|---|---|
| **TM-01** | Unauthorized player access | Unauthenticated user or disabled account | Mitigated by Firebase Auth + `isAccountActive()` + `checkRevoked: true` |
| **TM-02** | Player attempting admin or finance operations | Authenticated club member | Mitigated by server RBAC (`lib/server-auth.ts`) + `firestore.rules` |
| **TM-03** | Privilege escalation | Authenticated member or single-domain admin | Mitigated by claim-only Super Admin, server-only `roleKeys()`, D-22 retirement of legacy flags |
| **TM-04** | Account takeover and identity-linking abuse | Authenticated user / onboarding user | Mitigated by transactional `uidIndex`/`phoneIndex`, verified email/phone checks, merge locks |
| **TM-05** | Payment manipulation, replay, and duplicate transactions | Authenticated payer or external HTTP caller | Mitigated by server `derivePayableAmount`, `paymentReservations`, webhook HMAC + idempotent `gatewayPayments` |
| **TM-06** | Unauthorized financial record modification | Authenticated player or non-Finance admin | Mitigated by `firestore.rules` on `payments`/`otherFees` + `paymentFinanceGuards` + server routes |
| **TM-07** | Firestore data exposure (PII & finances) | Authenticated player or Finance Admin (for PII) | Mitigated by scoped `players` rules, `/api/players/public`, `/api/finance/players`, collection-group restrictions |
| **TM-08** | Unauthorized player data modification or deletion | Authenticated player or Club Admin | Mitigated by `affectedKeys().hasOnly(...)` self-updates + `DELETE /api/admin/players` 20-query history guard |
| **TM-09** | Administrative account compromise | External attacker or rogue/compromised admin device | Partially mitigated (revocation, fail-closed `pendingRevokes`, audit logs); MFA/device security is operational |
| **TM-10** | Abuse of public or semi-public endpoints | Unauthenticated caller or authenticated scraper | Mitigated by auth guards, shared rate limiter (`rateLimits`), bounded cursor pagination, Razorpay HMAC |

---

## Detailed Threat Scenarios

### TM-01: Unauthorized Player Access
- **Affected Assets:** Player profiles, match availability, dues, payment receipts, club feed, member directory.
- **Realistic Attack Path:**
  1. An unauthenticated visitor attempts to call `/api/players/public`, `/api/finance/*`, or `/api/admin/*`, or query Firestore directly.
  2. A previously removed/disabled club member (`appUsers/{uid}.status === "Disabled"` or `players/{id}.disabled === true`) uses a still-cached browser session or ID token to access player data or submit availability.
- **Impact:** Unauthorized access to club schedules, member directory, or club operations by non-members or suspended members.
- **Expected Controls:**
  - All private API routes enforce `requireAuth(req)` with `verifyIdToken(token, true)` (`checkRevoked: true`) and fail closed (`503`) on auth/DB outages (`lib/server-auth.ts`).
  - `firestore.rules` enforces `isSignedIn()`, `isAccountActive()`, and `isSelf(playerId)` (which also checks `players/{playerId}.disabled != true`).
  - Public unauthenticated reads in `firestore.rules` are limited to intentionally public non-PII club data (`appConfig`, `paymentLinks`, `grounds`, and `matches`) — **Note:** these 4 open-read rules produce pre-existing ESLint warnings and are tracked as accepted/contextual risks in `ACCEPTED_RISKS.md`.

### TM-02: Player Attempting Administrator or Finance Operations
- **Affected Assets:** Match ledgers, fee plans, reminders, Club roster, Design Studio, Access Control, `auditLogs`.
- **Realistic Attack Path:**
  - An authenticated player inspects client JavaScript, switches local UI state to look like an admin, or sends direct HTTP requests to `/api/admin/*`, `/api/finance/*`, `/api/email/send`, or `/api/whatsapp/send`, or issues direct Firestore writes to `matches`, `feePlans`, `subscriptionHistory`, or `auditLogs`.
- **Impact:** Unauthorized match/roster tampering, unauthorized reminder blasts, or financial ledger manipulation.
- **Expected Controls:**
  - Persona toggle (`Player`/`Admin`) is strictly UI presentation.
  - Every admin/finance API route enforces `requireSuperAdmin`, `requireClubAdmin`, `requireFinanceAdmin`, or `requireRole` (`lib/server-auth.ts`).
  - `firestore.rules` independently enforces `isSuperAdmin()`, `isClubAdmin()`, `isFinanceAdmin()`, or `isAnyAdmin()` on all admin-managed collections and denies all client writes to `auditLogs`, `circuitStandings`, `roleTransitions`, `migrationRuns`, `mergeJobs`, `uidIndex`, and `phoneIndex`.

### TM-03: Privilege Escalation
- **Affected Assets:** `appUsers/{uid}` role fields, Firebase Auth custom claim (`admin: true`), `accessControl/superAdmins`, operational migration runner.
- **Realistic Attack Path:**
  1. **Client self-write:** A user writes `role: "admin"`, `isClubAdmin: true`, `isFinanceAdmin: true`, or legacy `isMatchAdmin: true` / `isStudioAdmin: true` / `isDesigner: true` to their own `appUsers/{uid}` document.
  2. **Stale claim window after revocation:** A Super Admin is revoked, but continues using a cached Firebase ID token (up to 60 min) to perform Super Admin actions.
  3. **Partial transition failure:** Firestore role update commits while Firebase Auth `setCustomUserClaims` fails, leaving split-brain authorization.
  4. **In-app migration abuse:** A web route or forged JSON payload invokes `runRoleConsolidation()` to elevate roles.
- **Impact:** Full administrative takeover of club operations, finances, or user accounts.
- **Expected Controls:**
  - `firestore.rules` blocks all client writes (even by Super Admin) to `roleKeys()` on `appUsers`.
  - Retired flags (`isMatchAdmin`, `isStudioAdmin`, `isDesigner`, `canDesign`, `role: "admin"`) grant zero authority anywhere (`firestore.rules`, `lib/server-auth.ts`, client).
  - `/api/admin/access` (`lib/access-control-server.ts`) is Super-Admin-only, tracks durable `roleTransitions`, enforces last-Super-Admin protection, writes `accessControl/superAdmins.pendingRevokes` on revocation so `firestore.rules` (`hasPendingSuperRevoke()`) and `getUserAccount()` fail closed immediately, and revokes Firebase refresh tokens.
  - `lib/role-consolidation-runner.ts` rejects `process.env.NEXT_RUNTIME`, requires a non-forgeable `Symbol` + `WeakSet` `MigrationExecutionAuth` minted only from verified `serviceAccountKey.json` or `FIRESTORE_EMULATOR_HOST`, and uses atomic transaction lease fencing + SHA-256 `planFingerprint`.

### TM-04: Account Takeover and Identity-Linking Abuse
- **Affected Assets:** `appUsers.playerId`, `players.authUid`, `uidIndex`, `phoneIndex`, `mergeJobs`, player financial/gameplay history.
- **Realistic Attack Path:**
  1. A newly signed-in user attempts to link their Firebase account to another club member's `players/{playerId}` record by guessing a phone number or supplying a target `playerId` in `/api/player/link-account` or `/api/player/link-google`.
  2. A player merge (`merge-players`) or player delete (`DELETE /api/admin/players`) leaves stale `appUsers.playerId`, `uidIndex`, or `phoneIndex` entries pointing to a merged/deleted player, allowing login hijacking or broken access.
- **Impact:** Account takeover of a club member's profile and financial/payment history, or permanent lockout of legitimate members.
- **Expected Controls:**
  - `lib/account-linking.ts` performs transactional reads/writes across `players`, `appUsers`, `uidIndex`, and `phoneIndex`, rejecting cross-player collisions with HTTP `409`.
  - Google linking validates verified email/token ownership; client direct writes to `authUid`, `mergedInto`, `mergeStatus`, `mergeJobId` on `players` and `playerId` on `appUsers` are blocked in `firestore.rules`.
  - Player merge uses leased, fenced `mergeJobs` (`fencingToken`) and reparents `appUsers`/`uidIndex`/`phoneIndex`; player deletion (`DELETE /api/admin/players`) checks `inspectAndUnlinkPlayerIdentityInTx` and requires validated `?unlink=true`.

### TM-05: Payment Manipulation, Replay, and Duplicate Transactions
- **Affected Assets:** Razorpay orders, `paymentReservations`, `gatewayPayments`, `webhookDeadLetters`, match payments, `otherFees`, `subscriptionHistory`, `merchOrders`.
- **Realistic Attack Path:**
  1. **Amount/currency tampering:** A payer modifies the client request to `/api/razorpay/order` to send `amount: 1` (₹1) or a cheaper currency for a ₹500 match fee or merchandise order.
  2. **Double checkout race:** A user clicks "Pay" twice concurrently, creating two active Razorpay orders for the same fee and paying both.
  3. **Fake webhook / replay:** An attacker posts a forged `payment.captured` payload to `/api/razorpay/webhook`, or replays a valid webhook to credit multiple obligations.
  4. **Abandoned tab:** A user completes Razorpay checkout and closes the browser before client-side finalization runs.
- **Impact:** Underpayment, unrecorded/lost payments, duplicate charges, or fraudulent `Paid` status without settlement.
- **Expected Controls:**
  - `/api/razorpay/order` ignores client-supplied amounts, computes `derivePayableAmount()` server-side from Firestore records, enforces `INR`, and acquires a deterministic `paymentReservations` lease.
  - `/api/razorpay/webhook` verifies HMAC-SHA256 `x-razorpay-signature` over the raw body, checks captured amount/currency/order/intent inside a transaction, records idempotent `gatewayPayments`, fulfills all payment types (including merchandise) server-side, and records permanent mismatches in `webhookDeadLetters` before returning `200` (returning `503` on transient failures for Razorpay retry).
  - Live payment order creation is blocked on non-production databases (`arePaymentOperationsEnabled()`).

### TM-06: Unauthorized Financial Record Modification
- **Affected Assets:** `matches/{matchId}/payments/{paymentId}`, `players/{playerId}/otherFees/{feeId}`, `feePlans`, `feeTemplates`, `matches` finance fields.
- **Realistic Attack Path:**
  - A player (or a Club Admin without Finance Admin rights) uses Firestore SDK calls in browser DevTools to set `status: "Paid"`, alter `amount`, remove a `Late Fee`, or modify `reversals`/`financeSnapshot` on a closed match.
- **Impact:** Fraudulent debt erasure or corruption of club accounting and match settlement totals.
- **Expected Controls:**
  - `firestore.rules` restricts `otherFees` writes to `isFinanceAdmin() || isSuperAdmin()`.
  - `matches/{matchId}/payments/{paymentId}` allows players only to create/update their own availability/notes while status remains in `['Unpaid', 'Not Playing']`; `Paid`/financial fields require `isFinanceAdmin()` (or tightly constrained `isMatchAdminPayment*` rules) and `paymentFinanceGuards(matchId)` protects closed-match locks, `reversals`, and `financeSnapshot`.
  - **Note on `isMatchAdminPayment*` vs D-22:** Confirmed in `firestore.rules` (`isMatchAdmin()` aliases `isClubAdmin()`), meaning Club Admins retain legacy `isMatchAdminPaymentCreate`/`Update` rule scope in Firestore; whether any residual Club Admin payment-field scope exceeds D-22 intent is tracked for verification/acceptance rather than assumed.

### TM-07: Firestore Data Exposure (PII & Finances)
- **Affected Assets:** `players` (`mobile`, `email`, `dob`, `bloodGroup`, `emergencyContact`, `locality`), `appUsers`, `payments`, `otherFees`, `subscriptionHistory`, `auditLogs`.
- **Realistic Attack Path:**
  - An authenticated player runs `getDocs(collection(db, "players"))` or `collectionGroup(db, "payments")` from the browser console to harvest all 300 members' phone numbers, emails, emergency contacts, or financial dues.
  - A Finance Admin (who should not access unrelated player PII) attempts to list `players` directly.
- **Impact:** Disclosure of member phone numbers, emails, DOBs, blood groups, emergency contacts, and personal financial history.
- **Expected Controls:**
  - `firestore.rules` restricts `players` `list` to `isClubAdmin()` (including Super Admin) and `get` to `isClubAdmin() || isSelf(playerId)`.
  - `appUsers` `get` is owner or `isAnyAdmin()`, `list` is `isAnyAdmin()`.
  - Collection-group `payments` and `otherFees`, plus `subscriptionHistory`, restrict reads to `isFinanceAdmin() || isSuperAdmin()` (or `isAnyAdmin()` for `subscriptionHistory`) or `isSelf(resource.data.playerId)`.
  - Directory APIs enforce strict projections: `/api/players/public` (`PUBLIC_PLAYER_FIELDS` only) and `/api/finance/players` (`FINANCE_PLAYER_FIELDS` only).

### TM-08: Unauthorized Player Data Modification or Deletion
- **Affected Assets:** `players/{playerId}`, historical match/squad/scorecard/payment/subscription/lead references.
- **Realistic Attack Path:**
  1. A player modifies another player's profile or alters protected fields (`authUid`, `mergedInto`, `kavachId`, `disabled`) on their own profile.
  2. A Club Admin accidentally or maliciously hard-deletes a player who has historical payments, match appearances, squads, scorecards, badges, or `clubLeads` references, breaking historical integrity.
- **Impact:** Loss of historical cricket statistics/financial audit trails, or profile defacement.
- **Expected Controls:**
  - `players` self-update in `firestore.rules` enforces `isSelf(playerId)` and an explicit `affectedKeys().hasOnly(...)` allowlist + `isValidPlayerSelfUpdate`.
  - `DELETE /api/admin/players` (Club Admin / Super Admin) executes 20 historical-reference queries + `feePlanIds` check inside a transaction (`409 PLAYER_HAS_HISTORY` if any exist), enforces `inspectAndUnlinkPlayerIdentityInTx` (`?unlink=true` required if linked), and writes atomic audit entries. Direct Firestore `players` delete is `isClubAdmin()`, while UI routes lifecycle through `/api/admin/players`.

### TM-09: Administrative Account Compromise
- **Affected Assets:** Super Admin, Club Admin, and Finance Admin Google/Firebase accounts; `serviceAccountKey.json` on operator workstations.
- **Realistic Attack Path:**
  - An admin's personal Google account or device is compromised, or an admin leaves the club committee and is not promptly de-privileged.
  - Operational `serviceAccountKey.json` is accidentally leaked or mishandled.
- **Impact:** Broad unauthorized changes to club data, financial records, or role assignments (blast radius bounded by 3-role separation of duties).
- **Expected Controls:**
  - Separation of Super Admin, Club Admin, and Finance Admin limits single-role blast radius.
  - Immediate Super Admin revocation via Settings → Access Control (`pendingRevokes` + token revocation).
  - All privileged mutations write server-authoritative `auditLogs` visible to Super Admin.
  - `serviceAccountKey.json` is gitignored and never stored in source control; operational MFA on admin Google accounts is an operational practice (see `ACCEPTED_RISKS.md`).

### TM-10: Abuse of Public or Semi-Public Endpoints
- **Affected Assets:** `/api/players/public`, `/api/razorpay/webhook`, `/api/audit/log`, `/api/email/send`, `/api/whatsapp/send`, Firestore read/write quotas.
- **Realistic Attack Path:**
  - An authenticated user loops calls to `/api/players/public` with large `limit` or `search` values to scrape data or exhaust Firestore read quotas.
  - A user submits forged `actorId` or `payment`/`access` audit records to `/api/audit/log` to poison `auditLogs`.
- **Impact:** Firestore cost spike, API degradation, or audit-log pollution.
- **Expected Controls:**
  - `/api/players/public` and `/api/finance/players` enforce `MAX_PAGE_SIZE = 200`, `MAX_SCAN_DOCS = 250`, input length/sort validation, and `/api/players/public` enforces `checkSharedRateLimit` (Firestore-backed SHA-256 hashed fixed window with TTL).
  - `/api/audit/log` requires `requireRole`, ignores client-supplied actor/timestamp, redacts PII/secret fields, and blocks `SERVER_AUTHORITATIVE_ONLY_ENTITIES`.
  - Email/WhatsApp endpoints require appropriate Finance or Club Admin roles.
