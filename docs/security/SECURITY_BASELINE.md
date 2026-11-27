# KAvach Play — Authoritative Security Baseline

**Status:** Active Governing Security Policy  
**Repository:** `https://github.com/dixitashutosh007/KAvach-Play`  
**Branch Baseline:** `mig-mov` (HEAD `bf8e2c75735d27487e18892bd0a488efaa58b146`)  
**Product Owner:** KAvach Cricket Club  
**Live Application:** `https://play.kavachcricket.com`

> **Mandatory Instruction:** Every AI coding agent, security scanner, independent reviewer, and developer performing security-related work or assessment in this repository MUST read this document before scanning or recommending changes, and MUST also consult:
> - [`docs/security/THREAT_MODEL.md`](THREAT_MODEL.md)
> - [`docs/security/SECURITY_REVIEW_HISTORY.md`](SECURITY_REVIEW_HISTORY.md)
> - [`docs/security/ACCEPTED_RISKS.md`](ACCEPTED_RISKS.md)
>
> If any of these documents cannot be accessed, ask the owner for clarification rather than silently assuming an enterprise SaaS threat model. This baseline takes precedence over generic enterprise SaaS assumptions while never overriding essential security protections.

---

## 1. Application Purpose and Deployment Context

KAvach Play is a **private cricket club operations and financial management web application** built for **KAvach Cricket Club**.

- **Scale:** Approximately **300 club members and users** (players, guests, captains, club administrators, finance administrators, and super administrators).
- **Non-Goals:** It is **not** a public multi-tenant SaaS product, **not** an open internet marketplace, and **not** an enterprise platform with multi-organization tenant isolation, SSO/SAML federation, or SOC 2 enterprise compliance mandates.
- **Stack:** Next.js 15 App Router, React 19, TypeScript, Firebase Authentication, Cloud Firestore (branch-aware database selection via `lib/database-config.ts` / `next.config.ts`), Firebase Admin SDK for privileged server routes, Razorpay for online INR payments, Nodemailer/SMTP and WhatsApp helpers for club communications, and Playwright + Node/Firebase Emulator test suites.
- **Deployment:** Single-club deployment (`https://play.kavachcricket.com` in production). Staging/preview separation is governed by owner confirmation (`OD-01`).

---

## 2. User Population and User Roles

### 2.1 User Population
- **Club Players & Members (~300):** Authenticated club members who view upcoming matches, submit availability/PNA, view squads/results/stats/leaderboards, pay match/studio/merchandise fees, and manage their own profile.
- **Guest / Unlinked / Pending Players:** Player records created by Club Admins (e.g., for match participation or onboarding) that may exist before a Firebase Auth account is linked (`appUsers.playerId` is `null` or unlinked).
- **Administrators:** Trusted club officials operating in the **Admin persona** (Player persona is shown by default; persona switch is a UI presentation boundary only, never a security boundary).

### 2.2 Authoritative Role Model (Decision D-22)
Exactly **three active administrative roles** exist:

1. **Super Admin**
   - **Authoritative Source:** Firebase Auth custom claim `admin: true` (`request.auth.token.admin == true` in `firestore.rules`, verified with `checkRevoked: true` in `lib/server-auth.ts`).
   - **Fail-Closed Revocation:** Denied if `appUsers/{uid}.status == "Disabled"` or `uid` appears in `accessControl/superAdmins.pendingRevokes`.
   - **Capabilities:** Full administrative authority, including **Settings → Access Control** (`/api/admin/access`), viewing `auditLogs`, and reconciling failed role transitions. Cannot remove the last active Super Admin or modify own Super Admin status.
2. **Club Admin**
   - **Authoritative Source:** Server-written `appUsers/{uid}.isClubAdmin === true` (and active account status) or Super Admin inheritance.
   - **Capabilities (per D-19 & D-22):** Match Center (matches, grounds, tournaments, results), Club operations (player roster/lifecycle, player merge, Studio memberships, Pulse, Leaderboard & Stats, Announcements, Badges, Shop, Invite), and Design Studio.
   - **Restrictions:** Cannot grant/revoke roles (`/api/admin/access`), cannot access `auditLogs` directly unless Super Admin, and cannot perform Finance-only operations (recording/settling match ledgers, reminders, webhook dead-letter reconciliation, sponsorship/finance reports).
3. **Finance Admin**
   - **Authoritative Source:** Server-written `appUsers/{uid}.isFinanceAdmin === true` (and active account status) or Super Admin inheritance.
   - **Capabilities:** Match fee ledgers (`/api/finance/match-ledger`), fee plans/assignments (`/api/finance/assignments`, `/api/finance/match-plans`), subscriptions (`/api/finance/subscriptions`), sponsorship/financial reports (`/api/finance/reports/sponsorship`), due reminders (`/api/email/send`, `/api/whatsapp/send` for `due_reminder`), `webhookDeadLetters` / `/api/finance/webhook-reconciliation`, and bounded financial player projection (`/api/finance/players`).
   - **Restrictions:** Cannot read/write full player PII (`players` collection list/PII fields are restricted to Club Admin / Super Admin) and cannot manage admin roles.
4. **Player (Standard Authenticated User)**
   - **Authoritative Source:** Authenticated Firebase user with active `appUsers/{uid}` account (`status != "Disabled"`).
   - **Capabilities:** Read public/club data, read/update own `appUsers/{uid}` and linked `players/{playerId}` allowlisted self-service fields, submit own match availability/notes, initiate own Razorpay orders, and view own payment history/receipts.

**Retired Roles (D-22):** `isMatchAdmin`, `isStudioAdmin`, `isDesigner`, `canDesign`, and `role: "admin"` are **retired** and MUST NEVER grant any privilege on client, server API, or Firestore rules. Role keys (`roleKeys()`) on `appUsers` are server-written only via `/api/admin/access` or the CLI role-consolidation runner (`scripts/migrate-role-consolidation.mjs`).

---

## 3. Security Objectives and Protected Assets

1. **Financial & Payment Integrity:** Razorpay orders, payment statuses (`Paid`, `Pending`, `Waived`), match ledgers, `otherFees`, `subscriptionHistory`, `merchOrders`, `gatewayPayments`, `paymentReservations`, and `webhookDeadLetters`.
2. **Authorization & Role Integrity:** Firebase Auth custom claims (`admin: true`), `accessControl/superAdmins`, `roleTransitions`, `migrationRuns`, and role fields on `appUsers`.
3. **Member Personal Data (PII):** `mobile`, `email`, `dob`, `bloodGroup`, `emergencyContact`, `locality`, and sizing/identity fields in `players` and `appUsers`.
4. **Identity & Account Linkage:** `appUsers.playerId`, `players.authUid`, `uidIndex`, `phoneIndex`, and `mergeJobs` (preventing account takeover, duplicate identity theft, or orphaned logins).
5. **Historical & Audit Integrity:** `auditLogs` (immutable, server-written, create-only for custom IDs), match scorecards, and historical financial records (no unguarded hard deletes of referenced records).

---

## 4. Application-Specific Threat Model Summary

The primary realistic threats for KAvach Play are:
- **Authenticated insider/member abuse:** A signed-in club player attempting to read another player's PII or financial records, self-mark dues as `Paid`, or invoke Club/Finance/Super Admin endpoints.
- **Payment workflow manipulation:** Tampering with client-supplied Razorpay order amounts, currencies, or intents; replaying webhooks; or racing concurrent checkouts.
- **Identity linking & lifecycle abuse:** Claiming another player's phone/UID link during onboarding or Google linking, or leaving stale `uidIndex`/`phoneIndex`/`appUsers.playerId` links after player merge or deletion.
- **Privilege escalation & stale authority:** Client-side role field tampering, stale cached claims after Super Admin revocation, or retired role flags accidentally remaining authoritative.
- **Administrative / operational compromise:** Unauthorized invocation of destructive or bulk operations (player merge, player hard delete, role consolidation migration).

Detailed attack paths and controls are maintained in [`docs/security/THREAT_MODEL.md`](THREAT_MODEL.md).

---

## 5. Authentication Requirements

1. **Sole Identity Provider:** Firebase Authentication (Google OAuth, Email/Password, Phone/OTP as configured) MUST remain the authentication system. Do not introduce Cognito or parallel auth systems.
2. **Server Token Verification:** All protected API routes (`lib/server-auth.ts`) MUST verify Firebase ID tokens with `checkRevoked: true` so revoked, disabled, or deleted Firebase Auth users fail closed immediately.
3. **Account Status Enforcement:** Disabled `appUsers` (`status === "Disabled"`) and disabled `players` (`disabled === true`) MUST be denied privileged and self-service mutations across both API routes and `firestore.rules`.
4. **Fail-Closed Outage Behavior:** Auth-backend or authoritative `appUsers` lookup errors MUST fail closed (`503`), never falling back to permissive defaults.
5. **Test Auth Isolation:** `x-test-*` bypass headers (`isTestAuthBypassAllowed()`) MUST remain strictly disabled when `NODE_ENV === "production"` and require both `NODE_ENV === "test"` and `KAVACH_TEST_AUTH_BYPASS === "true"`.

---

## 6. Authorization and Role-Based Access Requirements

1. **Server & Rules as Security Boundary:** UI navigation and persona toggles (`Player`/`Admin`) are presentation-only. Every privileged action MUST be enforced in `firestore.rules` and/or server API routes (`requireSuperAdmin`, `requireClubAdmin`, `requireFinanceAdmin`, `requireRole`).
2. **Strict Separation of Club vs. Finance Duties:** Club Admins manage cricket/club operations and player PII; Finance Admins manage ledgers, plans, reminders, and reconciliation; neither can escalate into the other's domain or into Super Admin.
3. **No Client Role Writes:** `firestore.rules` MUST forbid all client writes (including by Super Admin) to `roleKeys()` on `appUsers` (`role`, `isSuperAdmin`, `isClubAdmin`, `isFinanceAdmin`, retired flags, `roleMigration`, `rolesUpdatedAt`, `rolesUpdatedBy`).
4. **Atomic Durable Role Transitions:** Super Admin claim grants and revocations via `/api/admin/access` (`lib/access-control-server.ts`) MUST track `roleTransitions` state, enforce last-Super-Admin protection, block concurrent transitions, fail closed on `pendingRevokes`, revoke refresh tokens on revocation, and support Super-Admin reconciliation.

---

## 7. Firebase Authentication and Firestore Security Requirements

1. **Default-Deny Baseline:** `match /{document=**} { allow read, write: if false; }` remains the root rule.
2. **Additive Rule Awareness:** Because matching `allow` rules in Firestore are additive, collection-group rules (`/{path=**}/payments/{paymentId}`, `/{path=**}/otherFees/{feeId}`) MUST be at least as restrictive as parent subcollection rules (`isFinanceAdmin() || isSuperAdmin() || isSelf(...)`).
3. **Field Allowlists & Immutability:** Client self-updates on `appUsers` and `players` MUST use `affectedKeys().hasOnly(...)` allowlists and protect identity/role/merge/financial fields.
4. **Server-Only Internal Collections:** `phoneIndex`, `uidIndex`, `mergeJobs`, `roleTransitions`, `migrationRuns`, `rateLimits`, `gatewayPayments`, and `paymentReservations` MUST deny all direct client reads/writes (`allow read, write: if false`) unless explicitly scoped to authorized admins (e.g., `webhookDeadLetters` read-only for Finance/Super Admin; `auditLogs` read-only for Super Admin).
5. **Emulator Verification:** Any change to `firestore.rules` MUST be verified with `npm run test:emulator` (`@firebase/rules-unit-testing`).

---

## 8. Razorpay and Financial Integrity Requirements

1. **Authoritative Server Pricing:** `/api/razorpay/order` MUST compute payable amounts server-side (`derivePayableAmount`) from authoritative Firestore records and enforce `INR` currency; client-supplied amounts MUST be ignored.
2. **Concurrency-Safe Reservations:** Payment order creation MUST acquire deterministic `paymentReservations` leases to prevent duplicate active gateway orders for the same payable obligation.
3. **Environment Isolation:** Live/production payment operations MUST remain blocked on non-production databases (`arePaymentOperationsEnabled()`). No real Razorpay transactions during development/testing.
4. **Webhook Authenticity & Idempotency:** `/api/razorpay/webhook` MUST verify the HMAC-SHA256 `x-razorpay-signature` over the raw request body, validate captured amount, currency, and order/intent binding inside a Firestore transaction, record `gatewayPayments` idempotently, and persist permanent mismatches/failures to `webhookDeadLetters` before returning `200` (returning `503` on retryable/infra failures).
5. **No Browser-Dependent Finalization:** Payment fulfillment (including merchandise orders, subscriptions, match fees, and other fees) MUST complete via the server webhook without depending on the user's browser remaining open.
6. **Abandoned Match Policy (Option A):** Abandoned matches create no new match-fee obligations, waive unpaid obligations while preserving historical paid transactions and audit history, and exclude waived amounts from outstanding dues.

---

## 9. Personal Data Protection Requirements

1. **PII Projection Boundaries:**
   - Public/member directory (`/api/players/public`) MUST project only non-PII fields (`toPublicPlayer()`) with bounded cursor pagination and shared rate limiting (`checkSharedRateLimit`).
   - Finance directory (`/api/finance/players`) MUST project only financial/membership fields (`FINANCE_PLAYER_FIELDS`) and exclude `mobile`, `email`, `dob`, `bloodGroup`, `emergencyContact`, `locality`, sizes, and `authUid`.
   - Direct Firestore `players` `list` queries are restricted to `isClubAdmin()` (including Super Admin); `get` is restricted to `isClubAdmin() || isSelf(playerId)`.
2. **Log & Audit Redaction:** Server logs and `auditLogs` MUST redact sensitive fields (`mobile`, `phone`, `email`, `dob`, `bloodGroup`, `emergencyContact`, `locality`, credentials/secrets) and MUST NOT log raw Razorpay payloads or payer contact details.
3. **Secret Hygiene:** Credentials (`serviceAccountKey.json`, `.env.local`, Razorpay secrets, SMTP/Resend keys) MUST never be committed or exposed to client bundles.

---

## 10. Identity Linking, Account Recovery and Player Deletion Requirements

1. **Distinct Identifiers:** `Firebase UID` and `playerId` are distinct; `appUsers.playerId` and `players.authUid` MUST only be updated through validated server transactions (`lib/account-linking.ts`, `/api/player/link-account`, `/api/player/link-google`).
2. **Unique Identity Indexes:** `uidIndex` and `phoneIndex` MUST be validated and updated transactionally to prevent two accounts from claiming the same player or phone number.
3. **Player Merge Integrity:** `/api/admin/merge-players` MUST use leased, fenced `mergeJobs` state machines, guard active payment writes against merging players, update `appUsers.playerId` and identity indexes, and commit atomic/recoverable audit events.
4. **Safe Player Deletion (`P2-DEL-01`):** `DELETE /api/admin/players` (Club Admin / Super Admin) MUST block deletion (`409`) whenever any historical financial, match, squad, scorecard, subscription, badge, catch, comment, poll, reservation, or `clubLeads` reference exists (admins must `PATCH` `disabled: true` instead). Linked identity records require explicit validated `?unlink=true` and atomic unlinking + audit logging.

---

## 11. Administrative Operation Security

1. **Operational Migrations Out of Web Runtime:** High-impact migrations such as D-22 role consolidation (`lib/role-consolidation-runner.ts`, `scripts/migrate-role-consolidation.mjs`) MUST be isolated from Next.js API routes and Server Actions, reject `process.env.NEXT_RUNTIME`, require a credential-backed `Symbol`/`WeakSet` capability (`MigrationExecutionAuth`), enforce atomic transaction lease fencing, and verify an immutable SHA-256 `planFingerprint`.
2. **Dry-Run Default:** Destructive or bulk operational scripts MUST default to dry-run and require explicit `--execute` and owner approval before running against production.
3. **Rate Limiting & Bounded Queries:** Public/authenticated list endpoints and sensitive actions MUST use bounded cursor pagination and shared Firestore-backed rate limiting (`lib/rate-limit-server.ts`) with hashed keys and fail-closed behavior.

---

## 12. Audit Logging Requirements

1. **Server-Authoritative Writes:** Direct client writes to `auditLogs` are forbidden (`allow create, update, delete: if false` in `firestore.rules`).
2. **Create-Only Custom IDs:** `lib/server-audit.ts` (`writeServerAudit`) MUST enforce create-only (`tx.create` / `docRef.create`) semantics for custom deterministic audit IDs and fail explicitly rather than overwriting existing audit records.
3. **Server-Derived Actor & Timestamp:** `/api/audit/log` and internal server audit calls MUST derive `actorId`, `actorName`, `actorType`, and `timestamp` on the server, ignoring client-supplied values, and block client submission for server-authoritative entities (`access`, `user_role`, `payment`, `subscription_period`, `fee_plan_assignment`).
4. **Atomic Coupling:** Authoritative mutations (player lifecycle, role changes, merges, reconciliations, abandoned-match waivers) MUST write their audit entries inside the same Firestore transaction or durable recovery mechanism.

---

## 13. Backup and Recovery Expectations

1. **Historical Data Preservation:** Financial, match, scorecard, membership, merchandise, and audit documents MUST NOT be destructively purged.
2. **Firestore Export / Recovery:** The repository includes export/import utilities (`export-firestore.js`, `import-to-firestore.js`) for controlled backups. Operational Firestore PITR/scheduled backup configuration in Google Cloud / Firebase Console is managed by the product owner outside repository code (not verifiable from repo files alone).
3. **Resumable State Machines:** Long-running or external-side-effect workflows (`roleTransitions`, `mergeJobs`, `migrationRuns`, `paymentReservations`, `webhookDeadLetters`) MUST store durable state so failed operations can be safely inspected and reconciled without data corruption.

---

## 14. Security Review and Vulnerability Classification Methodology

### 14.1 Mandatory Vulnerability Priorities

Use **only** these three classifications:

- **P0 – Critical / Launch blocker**
  - Exploitable authentication bypass.
  - Privilege escalation.
  - Unauthorized financial access.
  - Payment integrity compromise.
  - Critical personal data exposure.
  - Critical Firestore security rule bypass.
  - *Policy:* Must be fixed before production launch. Cannot be classified as an accepted risk.

- **P1 – Important / Fix before launch**
  - Realistic security weaknesses affecting important workflows.
  - Meaningful data protection gaps.
  - Important authorization or validation weaknesses.
  - Reliability problems that could corrupt or misrepresent financial records.
  - *Policy:* Must be fixed before launch unless explicitly risk-accepted by the product owner with documented justification and compensating controls in `docs/security/ACCEPTED_RISKS.md`.

- **P2 – Hardening / Post-launch**
  - Theoretical or low-impact risks.
  - Controls with limited relevance to the application.
  - Enterprise-grade enhancements without a demonstrated business requirement.
  - Improvements that do not materially affect the security of the current application.
  - *Policy:* Document and prioritize appropriately; do not turn every P2 into a remediation cycle.

### 14.2 Mandatory Rules for Future Reviewers and Scanners

Every future security review MUST:
1. Read `docs/security/SECURITY_BASELINE.md` before scanning the repository.
2. Understand the application architecture and actual user population (~300 club members, private club app).
3. Review `docs/security/SECURITY_REVIEW_HISTORY.md` and `docs/security/ACCEPTED_RISKS.md`.
4. Avoid reopening previously addressed findings without new source-code evidence or a changed threat.
5. Distinguish confirmed vulnerabilities from recommendations and theoretical concerns.
6. Explain the realistic attack path for every P0 or P1 finding.
7. Identify the affected file, function, API, route, or Firestore rule.
8. Explain the likely business impact.
9. Recommend the smallest effective remediation.
10. Avoid demanding enterprise-grade controls without a demonstrated need.
11. Avoid repeating completed remediation phases.
12. Avoid expanding scope into unrelated architecture redesign.

A security framework recommendation alone is **not** sufficient evidence for a launch-blocking finding.

### 14.3 Required Review Output Format

All future security assessments MUST produce a structured finding table with these exact columns:

| Field | Requirement |
|---|---|
| **Finding** | Clear vulnerability or weakness |
| **Priority** | `P0`, `P1`, or `P2` |
| **Evidence** | Exact source location (file, symbol, line range, or rule) |
| **Attack path** | Realistic exploitation scenario |
| **Impact** | Actual business impact for KAvach Play |
| **Recommendation** | Minimum effective fix |
| **Launch impact** | `Blocker` or `Non-blocker` |
| **Status** | `New`, `Existing`, `Fixed`, `Accepted`, or `Deferred` |

And MUST conclude with:
- `P0` count
- `P1` count
- `P2` count
- Previously identified findings that are now closed
- Accepted residual risks
- Overall production-readiness recommendation
