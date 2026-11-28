# KAvach Play — Accepted & Deferred Security Risks Register

**Governing Policy:** [`docs/security/SECURITY_BASELINE.md`](SECURITY_BASELINE.md)  
**Policy Rule:** Unresolved **P0 – Critical / Launch blocker** vulnerabilities MUST NEVER be classified as accepted risks. Only **P1** (with explicit justification and compensating controls) or **P2** hardening/post-launch items may be recorded here.

---

## Risk Register

### AR-01: Pre-existing Public Read Rules for Non-PII Club Catalog Collections
- **Risk Description:** Four Firestore rules in `firestore.rules` allow unauthenticated `read` (`allow read: if true;`), triggering `@firebase/security-rules/no-open-reads` ESLint warnings (`appConfig/{docId}` L121, `paymentLinks/{linkId}` L437, `grounds/{groundId}` L575, and `matches/{matchId}` L665).
- **Severity:** **P2** (Hardening / Post-launch)
- **Reason for Acceptance / Deferral:** The exposed collections contain club fixtures/schedules and non-PII configuration needed for initial public/landing rendering before sign-in. No player PII (`mobile`, `email`, `dob`, `emergencyContact`) or financial ledger/payment records are exposed by these rules.
- **Business Impact:** Low — match schedules, ground names, and public club metadata are non-sensitive within a 300-member cricket club context.
- **Compensating Controls:**
  - Strict `allow write: if false` / admin-only write rules on those collections.
  - Sensitive player PII (`players`), account records (`appUsers`), and financial subcollections (`payments`, `otherFees`, `subscriptionHistory`, `auditLogs`) require authentication and strict role/ownership checks.
- **Review Trigger:** If confidential match notes or private venue data are added to `matches` or `grounds`, or if public scraping causes Firestore read-cost spikes.
- **Status:** Accepted (P2)

---

### AR-02: Pinned Framework Baseline (`next@15.0.0` and `react@19.0.0-rc`)
- **Risk Description:** The application runs on pinned `next: 15.0.0` and `react: 19.0.0-rc-65a56d0e-20241020` (`package.json`, Decision `D-11`).
- **Severity:** **P2** (Hardening / Post-launch)
- **Reason for Acceptance / Deferral:** Per owner decision `D-11`, upgrading Next.js/React mid-remediation risks peer-dependency breakage (`motion`, `react-dom`) and App Router behavioral regressions. Current build, strict TypeScript (`tsc --noEmit`), and test suites pass cleanly on this baseline.
- **Business Impact:** Potential exposure to non-critical upstream framework bugs until a planned framework stabilization window.
- **Compensating Controls:**
  - Server API routes enforce explicit Firebase ID token verification (`checkRevoked: true`) and fail-closed RBAC independent of framework middleware shortcuts.
  - No unauthenticated Server Actions are used for privileged mutations.
- **Review Trigger:** Publication of an actively exploitable P0/P1 CVE affecting Next.js `15.0.0` or React `19 RC` in KAvach Play's runtime configuration, or scheduled Phase 11/12 framework stabilization.
- **Status:** Deferred per Decision D-11

---

### AR-03: No Enterprise WAF, Dedicated SIEM, or Multi-Tenant Isolation Controls
- **Risk Description:** KAvach Play does not implement enterprise SaaS controls such as Cloudflare/AWS WAF rule tuning, centralized SIEM log streaming, SAML/SCIM enterprise SSO, or tenant-isolation layers.
- **Severity:** **P2** (Hardening / Post-launch)
- **Reason for Acceptance / Deferral:** KAvach Play serves ~300 members of a single private cricket club. Enterprise SaaS controls have no demonstrated business requirement and add disproportionate operational complexity and cost.
- **Business Impact:** Negligible for a single-club deployment with ~300 known members.
- **Compensating Controls:**
  - Firebase Auth + `checkRevoked: true` + `firestore.rules` default-deny.
  - Firestore-backed shared rate limiting (`lib/rate-limit-server.ts`) and bounded cursor pagination on directory endpoints.
  - Server-authoritative `auditLogs` retained in Firestore for Super Admin inspection.
- **Review Trigger:** Any future product decision to expand KAvach Play into a multi-club or public SaaS platform.
- **Status:** Accepted (Out of Scope per Baseline §1)

---

### AR-04: Operational MFA & Workstation Hygiene for Admin Accounts
- **Risk Description:** Administrative security relies on club administrators securing their Google accounts (used for Firebase Auth) and protecting local `serviceAccountKey.json` files when running CLI migrations.
- **Severity:** **P1** (Operational / Compensated)
- **Reason for Acceptance / Deferral:** KAvach Play uses Firebase Auth (Google OAuth) without building custom in-app TOTP/WebAuthn enrollment, which is unnecessary when club admins authenticate via Google accounts.
- **Business Impact:** If an administrator's Google account or workstation is compromised, attackers could exercise that admin's scoped role (Club Admin, Finance Admin, or Super Admin) until revoked.
- **Compensating Controls:**
  - Three-role separation of duties (D-22) limits Club Admin vs. Finance Admin blast radius.
  - Super Admin revocation via Settings → Access Control immediately blocks Firestore/API access (`pendingRevokes` + token revocation).
  - `serviceAccountKey.json` is gitignored and `lib/role-consolidation-runner.ts` rejects `NEXT_RUNTIME`.
  - All admin mutations are logged to immutable `auditLogs`.
- **Review Trigger:** Any suspected admin account compromise, committee handover, or addition of new Super Admins.
- **Status:** Accepted with Operational Controls (committee members strongly advised to enable Google 2-Step Verification)

---

### AR-05: Legacy `isMatchAdminPaymentCreate` / `isMatchAdminPaymentUpdate` Aliasing to `isClubAdmin()`
- **Risk Description:** In `firestore.rules`, `isMatchAdmin()` now aliases `isClubAdmin()` per D-22, so Club Admins retain the bounded `isMatchAdminPaymentCreate` and `isMatchAdminPaymentUpdate` rule paths on `matches/{matchId}/payments/{paymentId}` (within `paymentFinanceGuards(matchId)`), whereas D-19/D-22 conceptually separate Club Admin from Finance Admin.
- **Severity:** **P2** (Hardening / Post-launch — verify intent)
- **Reason for Acceptance / Deferral:** Retained intentionally during D-22 consolidation to preserve match-day squad/cash collection workflows without breaking existing match operations, while `paymentFinanceGuards(matchId)` blocks tampering with closed matches, `reversals`, and `financeSnapshot`.
- **Business Impact:** Low — only trusted Club Admins can use the bounded match-payment rule, and all closed-match/reversal/snapshot invariants remain enforced by `firestore.rules`.
- **Compensating Controls:**
  - `paymentFinanceGuards(matchId)` in `firestore.rules`.
  - Authoritative settlement, reminders, and reconciliation APIs (`/api/finance/match-ledger`, `/api/finance/webhook-reconciliation`, `/api/email/send` due reminders) strictly require Finance Admin or Super Admin.
- **Review Trigger:** Next Finance/Match Operations review or if Club Admins should be strictly excluded from pitch-side payment status updates.
- **Status:** Deferred for Owner/Post-Phase-2 Confirmation

---

### AR-06: Single Firebase Project (`gen-lang-client-0004191483`) for Production & `mig-mov` Dev/Staging
- **Risk Description:** Production (`ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412`) and `mig-mov` development/staging (`kavach-play-db-ext`) share Firebase project `gen-lang-client-0004191483` and the same Firebase Authentication user pool / service account.
- **Severity:** **P1** (Owner-Accepted Operational Architecture)
- **Reason for Acceptance / Deferral:** Explicit owner decision (`2026-11-27`): KAvach Play continues using `gen-lang-client-0004191483` with `kavach-play-db-ext` for `mig-mov` dev/staging and `ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412` for production; no separate staging Firebase project is required.
- **Business Impact:** An operator running a CLI script with `serviceAccountKey.json` and `--database=ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412` could target production if the wrong `--database=` flag is supplied.
- **Compensating Controls:**
  - `resolveFirestoreDatabaseId()` (`lib/database-config.ts`) and `amplify.yml` strictly bind `mig-mov` → `kavach-play-db-ext` and fail closed on mismatch.
  - `arePaymentOperationsEnabled()` blocks live Razorpay orders on `mig-mov` / `kavach-play-db-ext`.
  - `scripts/migrate-role-consolidation.mjs` defaults to read-only dry-run and requires explicit `--database=` + `--execute`.
- **Review Trigger:** Any future multi-club expansion or decision to provision a separate GCP/Firebase staging project.
- **Status:** Accepted by Product Owner (`2026-11-27`)
