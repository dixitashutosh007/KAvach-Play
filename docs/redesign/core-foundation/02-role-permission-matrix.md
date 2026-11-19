# KAvach Play — Core Foundation Audit
## Document 02: Role & Permission Matrix (RBAC, Authorisation & Source Evidence)

**Document Type:** Security & Access Control Audit  
**Status:** Revised Audit Baseline with Source-Level Evidence (Assignment 2)  
**Date:** November 2026  
**Application:** https://play.kavachcricket.com  
**Authoritative References:** `firestore.rules`, `lib/types.ts`, `lib/server-auth.ts`, `AGENTS.md` (RBAC, D-08, D-09)

---

## 1. Role Architecture & Authorisation Model

KAvach Play enforces authorization across three layers:
1. **Cryptographic Identity Layer (Firebase Auth Custom Claims):** `token.admin === true` denotes Super Admin authority. Managed strictly via Firebase Admin SDK in `app/api/admin/set-claim/route.ts` and verified with `checkRevoked: true` in `lib/server-auth.ts:250, 320`.
2. **Account Metadata Layer (`appUsers/{uid}`):** Authenticated user documents store granular boolean capability flags (`isClubAdmin`, `isMatchAdmin`, `isFinanceAdmin`, `isStudioAdmin`, `isDesigner`) and account lifecycle status (`status: "Active" | "Disabled"`). Client writes to these fields are strictly blocked by `firestore.rules:125, 133`.
3. **Player Identity Binding (`appUsers.playerId`):** Links the Firebase account to the authoritative player record in `players/{playerId}`.

---

## 2. Comprehensive Role Permission Matrix

| Role | Storage Source | Frontend UI Access | Server API Guard (`lib/server-auth.ts`) | Firestore Security Rules (`firestore.rules`) | Visible Data Scope |
|---|---|---|---|---|---|
| **Super Admin** | `token.admin === true` (Custom Claim) + active account status | Full Player Views + Full Admin Console (all 7 hubs: Overview, Match Centre, Roster, Finance, Studio, Ops, Settings). | `requireAdmin()` (`lib/server-auth.ts:298-340`). Unrestricted API access. | `isSuperAdmin()` (`firestore.rules:35-41`). Full read/write across all collections. | Global: All player ledgers, audit logs, raw payment IDs, system credentials. |
| **Club Admin** | `appUsers.isClubAdmin === true` | Player Views + Admin Overview, Player Roster, Ops, Settings. | `requireClubAdmin()` (`lib/server-auth.ts:375`). Announcements, poll reminders. | `isClubAdmin()` (`firestore.rules:58-61`). Update non-privileged player fields; manage grounds, tournaments. | Global roster info, attendance, non-financial operations. |
| **Match Admin** | `appUsers.isMatchAdmin === true` | Player Views + Admin Match Centre, Player Roster. | `requireMatchAdmin()` (`lib/server-auth.ts:400`). Match reminders. | `isMatchAdmin()` (`firestore.rules:48-51`). Create/update matches, Playing XI, pitch-side cash records. | Fixtures, squad availability, scorecards, pitch-side match payments. Restricted from otherFees. |
| **Finance Admin** | `appUsers.isFinanceAdmin === true` | Player Views + Admin Finance & Dues, Match Centre. | `requireFinanceAdmin()` (`lib/server-auth.ts:425`). Financial export, abandoned reconciliation. | `isFinanceAdmin()` (`firestore.rules:53-56`). Manage `otherFees`, fee plans, waivers, manual payments. | Full financial data: Outstanding dues, Razorpay orders, ledger reconciliations. |
| **Studio Admin** | `appUsers.isStudioAdmin === true` | Player Views + Admin Studio & Nets Ops. | `requireStudioAdmin()` (`lib/server-auth.ts:450`). Studio check-in, pass management. | `isStudioAdmin()` (`firestore.rules:43-46`). Manage `subscriptionPlans`, update `subscriptionHistory`, CRM leads. | Studio member roster, pass balances, trial leads. |
| **Designer** | `appUsers.isDesigner === true` | Player Views + Design Studio Hub. | None. | `appUsers.isDesigner`. Read access to match rosters for creative asset generation. | Match details, player photos for promotional cards. |
| **Player (Linked)** | `appUsers.playerId !== null` | **Home \| Matches \| Finance \| Players \| More** (Personal Profile accessed via Header Avatar). | `requireAuth()` (`lib/server-auth.ts:194`). Public & payment order endpoints. | `isSelf(playerId)` (`firestore.rules:23-33`). Update self bio, self RSVP. Status changes to Paid are strictly blocked. | Personal dues, personal match history, personal studio passes, club leaderboard. Zero access to club treasury. |
| **Guest / Unlinked** | `appUsers.playerId === null` | Restricted Home (Onboarding/Claim Profile flow), Public Matches, Club Directory. | Registration and linking endpoints. | Read public matches and announcements. Zero access to personal financial ledger. | Public fixtures, club constitution, login screen. |

---

## 3. Corrected Player Information Architecture

In strict accordance with Assignment 2 directives:
1. **Primary Player Navigation (5 Bottom Destinations):**
   - **Home:** Upcoming match card, Playing XI announcement, club activity feed, mini dues glance.
   - **Matches:** Fixture schedule, reporting times, ground info, past scorecards, 1-tap RSVP.
   - **Finance:** Actionable personal settlement experience (itemized match dues, ad-hoc fees, Razorpay payment flow, receipts). Strictly locked to personal obligations.
   - **Players:** Club member directory, player public cards, leaderboard rankings.
   - **More:** Studio net bookings, club merchandise shop, member voting polls, ground directory.
2. **Player Profile Hub (Identity Entry Point via Top Header Avatar):**
   - Serves as the central personal information hub:
     - Overview & personal information (photo, contact, batting/bowling style).
     - Cricket statistics, career averages, milestone badges.
     - Club & Studio active memberships (pass balance, validity).
     - Complete personal payment history (historical receipts, cash logs, plan credits).
     - Previous match charges ledger (itemization of all historical match obligations).
     - Complete activity history (matches played, catches logged, RSVP track record).

---

## 4. Admin Mobile Navigation: Workstream Analysis & Recommendation

While administrators require a dedicated mobile navigation experience, the exact taxonomy is scheduled for formal approval during **Phase 3 (Admin Mobile)**.

### Analysis of Admin Capabilities & Usage Frequency:
- **High Frequency (Matchday / On-the-Go):** Match Centre (squad selection, pitch-side cash, attendance, live scorecards), Overview (alerts, KPI glance).
- **Medium Frequency (Weekly Ops):** Finance & Dues (payment reminders, fee waivers), Player Roster (approvals, phone linking).
- **Facility / Periodic (Weekly / Facility-specific):** Studio & Nets (QR check-in), Club Operations (merch orders, polls, announcements), Settings & Access (system config, roles).

### Recommended 5-Item Admin Mobile Bottom Navigation:
1. **Overview** (Executive dashboard, critical alerts, pending registration approvals).
2. **Match Centre** (Fixtures, squad announcements, pitch-side cash recording, scorecards).
3. **Roster** (Player directory, duplicate detection, profile merge, phone sync).
4. **Finance** (Treasury balance, ad-hoc fees, fee waivers, Razorpay order audit).
5. **More Hubs** (Slide-up drawer providing access to Studio & Nets, Club Ops, Settings & Access).

*Note: Final taxonomy will be submitted for Product Owner review and sign-off during Phase 3.*

---

## 5. Security Vulnerability Verification & Source Evidence

### 5.1 Mitigated Security Vulnerabilities

| Vulnerability ID | Description & Risk | Verified Source File & Code Evidence | Mitigation Status |
|---|---|---|---|
| **SEC-001** | **Privilege Escalation:** Client self-writing role fields to `/appUsers/{uid}` to gain admin access. | `firestore.rules:125, 133`: Blocks writes affecting `['role', 'isSuperAdmin', 'isStudioAdmin', 'isMatchAdmin', 'isFinanceAdmin', 'isClubAdmin', 'isDesigner', 'canDesign', 'status', 'playerId']`.<br>`firestore.rules:35-41`: `isSuperAdmin()` strictly verifies `request.auth.token.get('admin', false) == true`.<br>`lib/server-auth.ts:298-340`: `requireAdmin()` checks custom claim with `checkRevoked: true`. | **VERIFIED MITIGATED** |
| **SEC-002** | **Payment Status Manipulation:** Player modifying their own match payment document to mark it `Paid`. | `firestore.rules:580-590`: Explicitly restricts player self-updates: `(incoming().status in ['Unpaid', 'Not Playing'] && existing().status in ['Unpaid', 'Not Playing'])`. A client write attempting to set `status: 'Paid'` fails declarative rule validation. | **VERIFIED MITIGATED** |
| **FIN-001** | **Payment Amount Tampering:** Client supplying arbitrary `amount` to Razorpay order endpoint. | `app/api/razorpay/order/route.ts:91-96`: Calls `derivePayableAmount(db, auth.uid, intentData)` which independently reads Firestore. Any client-sent `amount` is discarded. | **VERIFIED MITIGATED** |

### 5.2 Unresolved Vulnerabilities & Architectural Risks

| Risk ID | Description & Verified Code Location | Business Impact | Risk Severity | Recommended Remediation Phase |
|---|---|---|---|---|
| **SEC-004** | **Financial Data Exposure via Collection-Group Queries:** `hooks/useStore.ts:580` and `hooks/useStore.ts:933` execute `collectionGroup(db, "payments")` and `collectionGroup(db, "otherFees")`. In Firestore, allow rules are additive. If a broad rule exists, a user could theoretically query other players' records if query constraints are omitted on the client. | Exposure of member financial transactions and contact data. | **P1 (High)** | **Phase 1 Core Foundation:** Audit collection-group rule constraints in `firestore.rules` and enforce strict server-side ledger access. |
| **FIN-002** | **Webhook Processing Concurrency Gap:** In `app/api/razorpay/webhook/route.ts:79-88`, webhooks execute `processWebhookIntentTransaction`. If a webhook retries while a previous invocation is writing child records, race conditions can produce duplicate payment documents. | Double credit or ledger discrepancy. | **P1 (High)** | **Phase 1 Core Foundation:** Ensure strict idempotency on `intent.status === 'completed'`. |
