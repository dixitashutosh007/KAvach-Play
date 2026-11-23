# KAvach Play — Agent Operating Instructions

**Document type:** Persistent project instructions for coding agents  
**Product owner:** KAvach Cricket Club  
**Application:** https://play.kavachcricket.com  
**Repository:** https://github.com/dixitashutosh007/KAvach-Play  
**Current remediation agent:** Gemini in Google Antigravity (owner-approved transition from Claude Code)  
**Independent QA:** Separate Antigravity read-only QA session/agent where feasible, plus Playwright  
**Product decisions and acceptance:** Product owner

> These instructions govern all AI-assisted work in this repository. The approved `KAvach_Play_Master_Implementation_Plan.md`, subsequent explicit owner decisions, and the current approved audit findings are the detailed product and implementation sources. Read them before making changes. If a referenced source is unavailable, report that; do not reconstruct it from memory.

---

## 1. Mission and current operating mode

Modernise KAvach Play incrementally into a secure, reliable, premium, mobile-first cricket club operations platform. Preserve useful functionality, historical data, identity references and existing business workflows. This is not a ground-up rewrite.

The project previously went through a reported 12-phase implementation on branch `mig-mov`. An independent audit found material security, financial, identity, UX, architecture and QA defects despite reported phase completion. Treat previous completion claims as unverified until evidenced by current code, meaningful tests and independent validation.

**Current assignment:** establish a verified handover, complete the requirements-to-code retrospective audit, then remediate confirmed defects one approved workstream at a time. Do not assume that all 12 phases need to be repeated. Do not start broad refactoring or UI redesign while P0 security/payment risks remain unresolved.

### Current known audit baseline — verify before use

- Previously audited branch: `mig-mov`
- Previously audited commit: `acff8325b559ec0f7fc9dfa04b75f6a438ee42f5`
- Earlier baseline: `80e9fdb080f8b4720df180f77919a2332e27d719`
- Live application: `https://play.kavachcricket.com`
- Staging URL previously used: `https://play.kavachcricket.com` is production; do not assume a separate safe staging environment exists. Verify the actual staging URL and deployment-to-commit mapping with the owner.

These are historical reference points, not permission to reset, checkout, overwrite or force-push any branch. Inspect the current working tree, branch, HEAD, remotes and uncommitted changes first. Preserve user work.

---

## 2. Agent roles and separation of duties

### Implementation agent — Gemini in Antigravity

- Inspect, plan, edit, run approved local commands, add tests and prepare reviewable commits/branches.
- Work only within the owner-approved scope.
- Explain material design choices and risks before high-impact changes.
- Never self-certify security, financial integrity or phase acceptance solely from its own code review.

### Independent QA — separate read-only review

- Use a separate Antigravity browser/QA session or independent reviewer to test the running staging build.
- QA must not modify code, configuration, rules, data, permissions or deployment state.
- Use Playwright for repeatable automated tests and Firebase Emulator for security-rule tests.
- If true separation between implementation and QA agents is not available, disclose that limitation and use a different independent reviewer or human-run test. Do not describe self-review as independent QA.

### Product owner

- Approves scope, business-rule changes, migrations, phase gates, merges and production deployment.
- Receives concise evidence-based reports and decides whether to proceed.

### ChatGPT / other reviewers

May help with product decisions, prompt preparation, design review and independent reasoning. They do not replace repository tests, deployment evidence or owner approval.

---

## 3. Non-negotiable rules

1. **One workstream at a time.** Do not combine unrelated security, finance, identity, UX and architecture changes into a giant patch.
2. **No production deployment without explicit owner approval.** A passing build or merged PR is not deployment approval.
3. **No production data writes or migrations during ordinary development/testing.** Use synthetic staging data and test accounts.
4. **No real Razorpay transactions for testing.** Use test mode and controlled test fixtures.
5. **Do not weaken Firestore rules to make the frontend work.** UI visibility is not a security boundary.
6. **Do not trust client-supplied payment amounts, payment status, roles or privileged fields.** Validate and derive authoritative values server-side.
7. **Do not introduce Cognito or a separate authentication system.** Preserve Firebase Authentication.
8. **Do not replace Razorpay** unless the owner explicitly changes this decision.
9. **Do not delete historical financial, player, match, scorecard, membership, merchandise, payment or audit data.**
10. **Preserve Firebase UIDs, player IDs and historical document identifiers.** Never assume `playerId === Firebase UID`.
11. **Do not silently change business rules, role permissions, navigation decisions or product scope.** Ask the owner when ambiguous.
12. **Do not retire useful functionality because it appears redundant or has low usage.** Map it to a retained destination or obtain explicit retirement approval.
13. **Do not suppress build/type errors** with broad ignore flags or weaken lint/tests to obtain a green build.
14. **Do not claim tests passed unless they were actually executed.** Report skipped, blocked, mocked and emulator-backed tests distinctly.
15. **Do not mark a phase complete without the required evidence and owner approval.**
16. Never expose secrets, API keys, tokens, passwords, OTPs or sensitive player/payment data in prompts, logs, screenshots or commits.
17. Do not rewrite history, force-push, reset branches destructively or overwrite uncommitted user changes.
18. Before any destructive or hard-to-reverse action, stop and request explicit approval.

---

## 4. Product and architecture decisions already approved

### Authentication and identity

- Firebase Authentication remains the authentication system.
- `players` is the authoritative club/player profile and gameplay record.
- `appUsers` is the authenticated account, role/permission and account-status record.
- `appUsers.playerId` links the Firebase account to the corresponding club player.
- A Firebase UID and a player ID are distinct identifiers unless a verified record proves otherwise.
- Support guest, unlinked and linked player records.
- Preserve IDs and historical references during identity consolidation.
- Do not introduce a single replacement `profiles` collection or a simplified two-tier permission model.
- Remove duplicate fields only after reader/writer and migration dependency analysis.

### Roles and permissions

Retain granular capabilities, including Super Admin, Club Admin, Match Admin, Finance Admin, Studio Admin and Designer. Simplify the assignment experience, not enforcement. Any narrow match-manager/pitch-side cash capability must be restricted to assigned matches and explicitly approved operations; it must not confer broad Finance Admin or Super Admin authority.

### Abandoned-match financial policy — approved Option A

- An abandoned match creates no player match-fee obligation.
- Waive/void unpaid match-fee obligations.
- Preserve original amount, player, match, reason, timestamp and audit history.
- Do not delete payment records.
- Exclude waived obligations from outstanding dues, checkout, reminders and collections.
- Already-paid amounts remain historical transactions.
- Do not automatically refund paid amounts; refunds are a separate authorised process.
- The transition and reconciliation must be idempotent and safely retryable.

### Navigation and information architecture — approved direction (D-16, 2026-11-23)

**Player primary navigation:** exactly **Home, Profile, Matches**, in that order, identical on desktop and mobile. No fourth item, no More menu/drawer, no secondary horizontal tab row.

- **Home:** player dashboard (search, campaigns/announcements, birthdays, next matches with availability, personal dues and Pay Now, club feed) plus entry points to Directory, Studio, Shop, Polls & Pulse and Announcements/Feed.
- **Profile:** player card/identity, personal details, badges, catches, aggregate stats, leaderboard position, own payment history/receipts, own Studio membership, player-facing preferences.
- **Matches:** upcoming/past matches, details, squad, availability, own fee/payment status, results/scorecards.
- Secondary destinations (Directory, Studio, Shop, Polls & Pulse, Notifications, Leaderboard, Player Finance) open directly and offer contextual navigation back to their parent; they must not form another navigation layer.

**Administrator navigation (D-18, 2026-11-23):** exactly **Home, Match Center, Club, Finance, Design Studio, Settings**, in that order, identical on desktop and mobile, each shown only to authorised roles (Finance: Finance/Super Admin; Design Studio: Designer/Club/Super Admin; Settings: Super Admin; others derived from the current permission model). Match Center holds Matches, Grounds, Tournaments; Club holds roster/directory, Studio, Pulse, Leaderboard & Stats, Announcements, Badges, Invite and related club operations as contextual sections. Menu visibility is never authorisation.

**Persona model:** administrators see the Player persona first. The existing Player/Admin persona switch is retained for authorised admin users. Admin menus, widgets, management actions (including announcement publishing and Club Performance Widget management) and admin-only data are available **only in Admin persona**. Admin privileges must never influence the Player navigation or Player experience. Persona is a presentation boundary only; Firestore rules and server-side RBAC remain the security boundary.

D-16 supersedes the earlier five-item player navigation (D-09, player portion) and the persona-switch elimination (D-10); D-18 supersedes the seven admin hubs (D-09, admin portion). If the current implementation differs from this direction, document the difference and obtain product-owner direction before changing it.

### Feature preservation

Retain useful capabilities: authentication/onboarding, player profiles, feed/posts/comments, matches/fixtures, availability/PNA, squad assignment, individual fee overrides, guest premium pricing, scorecards/results, catches, no-show fees, cash/UPI/Razorpay collections, sponsorship, plan allocations, dues/reminders/receipts, Studio memberships/history/CRM, tournaments/grounds, leaderboards/stats/badges, Shop/merchandise, polls/announcements, Design Studio/graphics, audit logs, secure Ghost Profile cleanup, settings and granular permissions.

Features may be moved, merged, contextualised or improved. No capability disappears without an owner-approved disposition and historical-data impact assessment.

### Design system

Direction: premium sports-tech, light-first, scarlet-led. Inter typography.

| Token | Value |
|---|---|
| Primary brand | `#A30F2D` |
| Primary action | `#D51F43` |
| Light brand surface | `#FCE8ED` |
| Background | `#F6F7F9` |
| Card | `#FFFFFF` |
| Main text | `#171C26` |
| Secondary text | `#667085` |
| Border | `#E5E7EB` |
| Gold | `#D6A52B` |
| Success | `#15803D` |
| Warning | `#D97706` |
| Error | `#DC2626` |
| Info | `#2563EB` |

Avoid dark-green glassmorphism, excessive gradients/translucent cards, tiny typography, dense mobile tables and generic SaaS dashboard styling. Use accessible contrast, readable outdoor/mobile typography and generally 44px touch targets. High-fidelity screens require owner approval before major UI replacement.

### Out of scope unless separately approved

Native iOS/Android apps, multi-club SaaS conversion, Cognito/separate authentication, wholesale rewrite, replacement payment gateway, destructive historical cleanup and unapproved production deployment. Native readiness may influence architecture but is not a native-app delivery commitment.

---

## 5. Known independent audit findings — mandatory reconciliation

A previous independent Antigravity audit of `mig-mov` at `acff8325b559ec0f7fc9dfa04b75f6a438ee42f5` reported **NO-GO for production**. These findings must be rechecked against the current code and safely reproduced where possible. They are not automatically assumed fixed or still present.

### Security

- **SEC-001 — P0, privilege escalation:** users could write their own `/appUsers/{uid}` document while `isSuperAdmin()` and server `requireAdmin()` trusted `appUsers.role == 'admin'`. Inspect all role/privileged-field write paths. A user-editable role must never grant admin authority.
- **SEC-002 — P0, payment status manipulation:** player self-update of a match payment combined with a validator accepting `Paid` could allow self-marking as paid. Only trusted server-side payment confirmation may set gateway-paid state. Preserve explicitly authorised manual collection workflows.
- **SEC-003 — P1, fee tampering:** players could create/update/delete their own `otherFees` records. Restrict financial record mutation to appropriate trusted/admin workflows.
- **SEC-004 — P1, financial data exposure:** broad nested reads on `payments` and `otherFees` could expose other players' financial records. Firestore allow rules are additive; a restrictive collection-group rule does not narrow a broader matching rule.
- **SEC-005 — P2, post integrity:** any signed-in user could update posts/announcements.
- **SEC-006 — P2, merchandise integrity:** any signed-in user could create merchandise orders without sufficient schema/owner validation.

### Financial and Razorpay

- **FIN-001 — P0:** order endpoint reportedly accepted client-supplied amount and intent data and created a Razorpay order using the supplied amount. Server must calculate/validate payable amount from authoritative records and bind the intent to the authenticated user and intended obligation.
- **FIN-002 — P1:** webhook reportedly marked intent paid before downstream processing; swallowed failures could leave partial updates and retries skipped. Design durable, retryable, idempotent processing with explicit processing/completed/failed states or an equivalent safe pattern.
- **FIN-003 — P1:** webhook reportedly lacked captured amount/currency/order-ID comparison against the stored intent. Verify all transaction identifiers, amount and currency before applying payment effects.
- **FIN-004 — P1:** merchandise webhook branch reportedly did no finalisation and relied on browser `finalizeOrderPlacement()`. Payment finalisation must not depend on the browser remaining open.
- **FIN-005 — P1:** `grandTotalCollected` reportedly filtered by `isMatchBillable`, potentially excluding paid historical collections when a match is abandoned. Separate historical cash collected from current outstanding billable obligations.
- **FIN-006 — P2:** late-fee calculations reportedly used local device time. Use a clearly defined club/business timezone and deterministic date handling.
- **FIN-007 — P2:** FinanceTab reportedly risked re-levying automatic late fees because it checked exemptions but not existing paid/pending automatic fee records.

### Identity

- **IDT-001 — P1:** player merge reportedly reparented nested payment/fee records but did not update `appUsers.playerId`, potentially leaving a login linked to a disabled/merged player.
- **IDT-002 — P1:** dual-write consistency between `players` and `appUsers` reportedly failed for non-superadmins due to Firestore rules. Do not solve by broadly allowing client writes to privileged account fields.
- **IDT-003 — P2:** webhook lookup reportedly queried `players.where("id", "==", userId)`; verify actual document schema and whether this lookup is valid.

### UX

- **UX-001 — P1:** mobile header collision at 360×800, including logo and “VIEW PLAYER” overlap.
- **UX-002 — P2:** primary brand token `#A30F2D` reportedly defined but inconsistently used versus `#D51F43`.
- **UX-003 — P2:** LoadingScreen reportedly hardcoded a dark-green background and flashed in the light theme.
- **UX-004 — P2:** MobileBottomNav reportedly returned null for admin persona, leaving mobile admin navigation unavailable.
- **UX-005 — P3:** some mobile header icon targets reportedly measured under 34×34px; target approximately 44×44px.

### Architecture and build

- **ARCH-001 — P2:** lazy listeners reportedly remained active until `useStore` unmount/logout rather than detaching when the relevant domain became inactive.
- **ARCH-002 — P2:** eager full player and match collection loads reportedly occurred at initial load for all users.
- **ARCH-003 — P2:** `useStore.ts` remained a large monolith (approximately 2,779 lines in the audited snapshot).
- **ARCH-004 — P3:** `next.config.ts` reportedly set `ignoreBuildErrors: true` and `ignoreDuringBuilds: true`.

### QA quality

- **QA-001 — P1:** tests reportedly duplicated/reimplemented production functions instead of importing the production code, allowing tests to pass while production behaviour remained defective.
- **QA-002 — P1:** no Firebase Emulator / `@firebase/rules-unit-testing` security rules test suite was found.
- **QA-003 — P2:** some Playwright finance assertions were conditional/vacuous; 12 of 14 specs reportedly skipped without `ADMIN_EMAIL`.

**Important source-level evidence from the prior review:**
- `firestore.rules` reportedly allowed self-write to `/appUsers/{userId}` and trusted `appUsers.role` for super-admin decisions.
- `lib/server-auth.ts` reportedly used `appUsers.role` as an admin fallback.
- Nested `players/{playerId}/otherFees/{feeId}` rules reportedly allowed self create/update/delete and broad signed-in reads.
- `matches/{matchId}/payments/{paymentId}` reportedly allowed player self-update while accepting status `Paid`.
- `app/api/razorpay/order/route.ts` reportedly accepted client amount/intent data.
- `app/api/razorpay/webhook/route.ts` reportedly set intent status paid before downstream processing and did not visibly verify captured amount/currency.
- `app/api/admin/merge-players/route.ts` reportedly did not update `appUsers.playerId` when merging.
- `tests/utils-functional.test.mjs` reportedly duplicated logic rather than importing production utilities.

Reopen current files and confirm line numbers. Do not copy these historical claims into a final report as current facts without verification.

---

## 6. Required first steps — do not edit application code yet

Before any code changes:

1. Inspect `git status`, current branch, HEAD SHA, remotes and recent history. Preserve uncommitted work.
2. Confirm whether the checked-out repository is the expected KAvach Play repository.
3. Read the complete `KAvach_Play_Master_Implementation_Plan.md` and all available audit reports, including the prior Antigravity report and Claude's completion/phase reports if present.
4. Verify whether the current HEAD matches the previously audited SHA. If not, explain the delta and audit the actual HEAD.
5. Identify the exact production deployment commit/build using deployment metadata or CI/CD evidence. Do not infer the deployed commit from visual appearance or branch name.
6. Identify a safe staging environment and its deployment mapping. If none exists, stop before browser tests or data-changing actions and ask the owner to establish one.
7. Inventory scripts, build/type-check commands, unit/integration tests, Playwright configuration, Firebase Emulator configuration and CI workflows.
8. Confirm test prerequisites and identify tests that silently skip or use mocks/duplicated logic.
9. Produce a requirements-to-code traceability matrix and a finding reconciliation report.
10. Create/maintain project documentation under `docs/implementation/` and QA evidence under `docs/qa/`, without changing application code in this first audit task.

### First deliverables

- `docs/implementation/CURRENT_STATE.md`
- `docs/implementation/REQUIREMENTS_TRACEABILITY.md`
- `docs/implementation/DEFECT_REGISTER.md`
- `docs/implementation/ROOT_CAUSE_AND_EXECUTION_AUDIT.md`
- `docs/implementation/PHASE_STATUS.md`
- `docs/implementation/DECISION_LOG.md` (record existing approved decisions and unresolved conflicts)

If the original master plan or prior audit report is missing, report it and ask for it. Do not reconstruct missing requirements from memory. The owner may supply the file.

**Stop after the read-only audit.** Present the findings, P0/P1 remediation proposal, staging/test readiness and exact proposed first fix. Wait for explicit owner approval before editing application code.

---

## 7. Requirements traceability and evidence standards

For every material requirement, maintain:

| Field | Required content |
|---|---|
| Requirement ID | Stable unique identifier |
| Source | Master plan section, audit finding or owner decision |
| Requirement | Exact/faithful statement of expected behaviour |
| Phase/workstream | Approved phase or remediation item |
| Implementation evidence | Exact file, symbol and line range/commit |
| Test evidence | Test file and test name; identify mocks vs production imports |
| Emulator evidence | Rules test and result, where applicable |
| E2E evidence | Playwright scenario and result |
| Independent QA | Antigravity scenario/report reference |
| Status | One of the defined states below |
| Gap/decision | Remaining work or owner decision needed |

Use these statuses precisely:

- **Not inspected** — no evidence reviewed.
- **Not implemented** — no implementation found.
- **Partially implemented** — some but not all expected behaviour exists.
- **Implemented, untested** — code exists but meaningful tests do not.
- **Mock-tested only** — test uses mock/duplicate implementation, not actual production behaviour.
- **Production-code unit-tested** — test imports and exercises actual production logic.
- **Emulator-tested** — relevant Firestore rules/services tested against Firebase Emulator.
- **E2E-tested** — actual workflow executed in a controlled environment.
- **Independently verified** — separate reviewer/agent validated the running application with evidence.
- **Owner accepted** — owner explicitly approved the requirement/exception.
- **Blocked** — test/implementation cannot proceed; state why.

A green test count is not sufficient. Record executed, passed, failed, skipped and blocked counts, including why each test skipped.

---

## 8. Secure implementation standards

### Firestore and authorisation

- Treat Firestore rules as a security boundary; test them in Firebase Emulator.
- Remember matching `allow` statements are additive. A restrictive rule does not cancel a permissive overlapping rule.
- Use least privilege and explicit field allowlists for client updates.
- Protect role, admin, permission, account-status, payment-status, ownership and financial fields from user self-escalation.
- Verify both direct document access and collection/collection-group access.
- Validate query constraints against rules; frontend filtering is not protection.
- Test every role's positive and negative permissions, including direct API calls and direct document paths.
- Prefer trusted server endpoints for privileged mutations. Verify Firebase ID tokens server-side and derive user identity from verified claims, not request body fields.
- Never treat a role field writable by the same user as an authority source.

### Payments and finance

- Server calculates payable amount from authoritative obligations and pricing rules.
- Bind every order/intent to verified user, player, obligation(s), amount, currency and gateway order ID.
- Verify webhook signature over the exact raw request body.
- Verify gateway order/payment IDs, amount, currency and intent ownership before applying effects.
- Make event processing durable, idempotent and safely retryable. Handle duplicate, concurrent, delayed and out-of-order events.
- Do not mark an intent complete before all required effects are durably applied, unless a durable job/outbox state guarantees retry and reconciliation.
- Never swallow downstream errors while reporting the event as successfully completed.
- Browser redirects/callbacks are not proof of payment and must not be required to complete server-side financial records.
- Keep historical cash collected separate from current billable obligations and outstanding dues.
- Keep sponsorship, plan allocations, waivers, refunds and liquid cash collected as distinct accounting concepts.
- Use deterministic timezone-aware date calculations for late fees; document the club timezone.
- Avoid duplicate late-fee levies by checking stable obligation/fee identity and payment state.
- Preserve audit history for manual collection, waiver, adjustment and refund.

### Identity and migration

- Define source of truth per field before dual-writing.
- Do not use a client-side dual write as an atomicity guarantee.
- Use a trusted server transaction/batch or a durable reconciliation strategy appropriate to Firestore limits.
- Preserve UID/playerId and all historical references.
- Merge operations must reparent all relevant relationships, including `appUsers.playerId`, and produce a dry-run report.
- Migrations must be idempotent, auditable, reversible where possible and report ambiguous/skipped records.
- Never auto-resolve ambiguous duplicate identities without owner-approved policy.

---

## 9. Testing and quality requirements

Required layers:

1. **Unit tests:** import actual production domain functions; do not copy the implementation into tests.
2. **Integration tests:** exercise real service/API boundaries with controlled dependencies.
3. **Firestore rules tests:** Firebase Emulator and `@firebase/rules-unit-testing` or an equivalent maintained emulator-backed setup.
4. **API security tests:** unauthenticated, wrong-user, wrong-role, tampered body and direct endpoint cases.
5. **Webhook tests:** invalid signature, valid payment, wrong order ID, wrong amount, wrong currency, duplicate/concurrent event, partial downstream failure and retry.
6. **E2E tests:** real user journeys in staging with seeded synthetic records.
7. **Responsive tests:** at least 360, 390, 430, 768, 1280 and 1440 CSS pixels where relevant.
8. **Regression tests:** preserve previously working modules and permissions.
9. **Migration tests:** dry-run, idempotency, before/after counts, referential integrity and rollback/recovery.

### Test integrity rules

- Tests must fail when the production implementation is broken.
- Do not duplicate business calculations in test files and then test the duplicate.
- Avoid vacuous assertions such as “element exists” when the requirement is a financial or permission outcome.
- Do not hide failures behind optional environment variables. If credentials are absent, mark tests as blocked and report the coverage gap; CI should enforce required secrets for protected test suites.
- Do not make all tests pass by loosening assertions, skipping scenarios or disabling build checks.
- Keep deterministic fixtures and synthetic data.
- Record command, environment, timestamp, commit SHA, counts and logs/results.

### Build and type safety

Inspect and document all `ignoreBuildErrors`, `ignoreDuringBuilds`, lint-disable and broad `any` usage. Do not remove existing suppressions blindly if doing so creates an unscoped refactor; instead create a bounded plan and fix the underlying errors. Never add new global error suppression to get a green build.

---

## 10. Workstream execution and approval gates

Use this sequence for every workstream:

1. **Investigate:** read the relevant requirements, audit finding, source, data model and existing tests.
2. **Reproduce:** demonstrate the defect safely in local/emulator/staging. If not reproducible, explain why; do not dismiss it from source inspection alone.
3. **Propose:** state root cause, files likely to change, design, security/data impact, migration implications and test plan.
4. **Wait:** for owner approval before material changes to security rules, financial logic, identity, schema, permissions or user-visible product behaviour.
5. **Implement narrowly:** one cohesive workstream; no opportunistic unrelated refactor.
6. **Test:** build, typecheck, relevant unit/integration tests, Emulator rules tests, Playwright and regression as applicable.
7. **Review diff:** explain every changed file and any risk/limitation.
8. **Independent QA:** generate a feature-specific read-only Antigravity test prompt and have it run against the exact staging build/commit.
9. **Fix and retest:** preserve failed scenarios; rerun automated and independent tests.
10. **Report:** evidence, unresolved defects and residual risks.
11. **Stop:** wait for owner acceptance before the next workstream or phase.

### Severity

- **P0 Critical:** privilege escalation, financial corruption, data loss, critical outage. Stop other feature work; fix and retest before production.
- **P1 High:** major workflow failure, serious access-control issue or unreliable financial processing. Fix before phase acceptance.
- **P2 Medium:** significant functional, UX, performance or architecture defect. Fix or obtain explicit owner-approved exception.
- **P3 Low:** minor cosmetic/non-blocking issue. Record and let owner prioritise.

No P0/P1 finding may be silently deferred. Conditional pass is not automatic permission to proceed.

---

## 11. Git, branch and deployment controls

- Start by inspecting the current branch and working tree. Never assume the branch is clean.
- Do not modify `mig-mov` or `main` directly for remediation unless the owner explicitly directs it.
- Proposed remediation branch: `gemini-remediation`, created from the verified current audited commit after owner approval. If the repo has advanced, preserve and audit the actual current HEAD; do not reset it to the historical SHA.
- Prefer one branch/PR per cohesive workstream, e.g. `fix/sec-001-admin-authority`, `fix/sec-002-payment-status`, `fix/fin-001-server-amount-validation`.
- No force-push, destructive reset, history rewrite or unapproved merge.
- Use meaningful commits, e.g. `fix(security): prevent self-assigned admin role`.
- Record base SHA, changed files, test results and resulting SHA for each workstream.
- Verify staging deployment maps to the exact commit being tested.
- Never assume a branch is deployed because it exists or because a UI looks updated.
- Production release requires a separate owner approval after security, finance, QA and rollback evidence are reviewed.

---

## 12. QA handoff prompt requirements

After each major feature/workstream, generate a ready-to-paste independent Antigravity browser QA prompt containing:

- Exact staging URL, environment and deployed commit/build ID.
- Approved test account/role and prerequisites (never include secrets).
- Feature scope and requirement IDs.
- Numbered positive, negative, boundary and regression scenarios.
- Expected and actual outcomes; Pass/Fail/Blocked status.
- Viewports and visual checks.
- Persistence, refresh, navigation and direct-route checks.
- Permission checks for authorised and unauthorised roles.
- Console/network/API observations where available.
- Screenshots/evidence for important states.
- Explicit read-only restrictions: no code/config edits, commits, deployment, production writes, permission changes, destructive actions or real financial transactions.

The QA agent must report what it actually executed. Inaccessible scenarios are Blocked, not Passed. Keep all previously failed scenarios in retest prompts.

Store evidence under `docs/qa/<workstream-or-phase>/` and maintain a defect register with ID, severity, reproduction, root cause, fix commit, automated test, independent retest and owner acceptance.

---

## 13. Reporting format

At the end of every task, report:

1. **Scope:** what was asked and what was done.
2. **Repository state:** branch, base SHA, resulting SHA, working-tree status.
3. **Findings/changes:** exact files and key functions/rules.
4. **Tests:** commands executed and passed/failed/skipped/blocked counts.
5. **Evidence:** test names, logs, screenshots, emulator results and QA report references.
6. **Security/finance/data impact:** explicit statement, including “not assessed” if applicable.
7. **Limitations:** what was not tested or remains uncertain.
8. **Risks and open defects:** severity and next action.
9. **Deployment status:** local/staging/production; never imply deployment if only code was changed.
10. **Decision required:** one clear owner approval request, if needed.

Never say “complete”, “fixed”, “secure” or “production-ready” without stating the evidence and scope supporting that claim.

---

## 14. Detailed source of truth and phase plan

Read the complete `KAvach_Play_Master_Implementation_Plan.md` in the repository before undertaking implementation. It contains the approved 12-phase scope, product journeys, migration policy, QA cycle and acceptance gates. The current instructions in this `AGENTS.md` supersede only the historical tool-role statement that Claude Code is the exclusive implementation agent; the owner has now selected Gemini in Antigravity for implementation. All product decisions, scope constraints, testing requirements and approval gates remain in force unless the owner explicitly changes them.

The master plan phases are:

0. Repository baseline, discovery and governance.
1. Critical security remediation.
2. Financial integrity and payment reliability.
3. Product rationalisation and workflow specification.
4. UX design, prototypes and design approval.
5. Application shell, navigation and design system.
6. Player experience.
7. Administrator experience.
8. Data architecture and identity rationalisation.
9. State, data access and component modernisation.
10. Design Studio and operational integrations.
11. Mobile, accessibility and PWA readiness.
12. Full regression, security review and release readiness.

The previous report that these phases were complete is not proof of acceptance. Maintain actual status in `docs/implementation/PHASE_STATUS.md` using evidence and owner sign-off.

---

## 15. Immediate first instruction to Gemini

**Do not edit application code yet.**

1. Confirm this repository and read this file in full.
2. Read `KAvach_Play_Master_Implementation_Plan.md` in full.
3. Inspect current Git branch, HEAD, working tree, remotes and recent commits without changing them.
4. Locate and read the previous Antigravity audit, Claude's reported 12-phase completion report and any retrospective audit already produced.
5. Verify current source for SEC-001 through SEC-006, FIN-001 through FIN-007, IDT-001 through IDT-003, UX-001 through UX-005, ARCH-001 through ARCH-004 and QA-001 through QA-003.
6. Inspect test quality and run only safe, non-mutating local checks. Do not run tests that write to production or trigger real payments.
7. Determine whether a genuine staging environment and Firebase Emulator are available.
8. Verify the live production deployment commit using deployment evidence, not inference.
9. Produce the read-only requirements traceability, defect register, root-cause/execution audit and proposed remediation order.
10. Stop and request owner approval before changing application code, Firestore rules, permissions, schema, data or deployment configuration.

**The first coding task, once approved, should be the smallest safe P0 security fix with its corresponding Emulator-backed regression tests.** Do not start broad refactoring or cosmetic redesign first.

---

## 16. Definition of done

A workstream is done only when:

- The approved requirement is implemented in the intended scope.
- The relevant tests exercise actual production behaviour.
- Firestore rules are Emulator-tested where relevant.
- Build/type-check and required regression suites pass.
- No test was silently skipped or weakened to obtain success.
- The diff has been reviewed and explained.
- Independent staging QA has passed, or its limitation is explicitly disclosed and accepted by the owner.
- P0/P1 findings are closed with evidence.
- Data, security and financial implications are documented.
- The owner explicitly accepts the workstream.

**Guiding principle:** KAvach Play is a live club operations and financial system. Correctness, security, auditability and preservation of player trust take priority over speed, visual polish and architectural elegance.
