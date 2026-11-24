# KAvach Play — Testing & Quality Engineering

**Document:** Engineering Handover — Testing Strategy, Automated Coverage, and Quality Assurance  
**Status:** Living Engineering Record (Reconciled & Validated)  
**Target Audience:** QA Engineers, Independent Reviewers, Test Automation Specialists  
**Authoritative References:** `tests/`, `e2e/`, `scripts/run-emulator-tests.mjs`, `package.json`, `.github/workflows/ci.yml`  

---

## 1. Automated Test Frameworks & Suites Inventory

The repository maintains a multi-tiered validation pyramid:

```
                      TESTING PYRAMID
                      
             /-------------------------------\
            /       Playwright E2E Suites     \      (Mobile Pixel 5 & Desktop)
           /   (e2e/*.spec.ts, CI Workflow)    \     (Role RBAC, Navigation, Touch)
          /-------------------------------------\
         /     Firebase Emulator Security Tests  \   (Local Firestore Emulator)
        / (tests/*emulator*.test.mjs, 114+ specs) \  (Rules Unit Testing, Auth Leases)
       /-------------------------------------------\
      /        Node.js Native Functional Tests       \  (Zero-dependency node:test)
     / (tests/*.test.mjs, 462 specs across 101 suites)\ (Accounting, RBAC, DB Isolation)
    /-------------------------------------------------\
```

### Complete Test Suites Inventory

| Test Category | Runner / Tool | Target Spec Files | Total Specs | Execution Status |
|---|---|---|---|---|
| **Functional & Accounting** | `node:test` (`npm run test:functional`) | `tests/accounting-functional.test.mjs`, `tests/abandoned-match-accounting.test.mjs` | 19 | **462/462 PASSED** (All suites locally at `8978577`) |
| **Database & Payment Isolation** | `node:test` (`npm run test:functional`) | `tests/database-isolation-and-payment-safety.test.mjs` | 13 | **PASSED** |
| **Player Match Center UI & Flow** | `node:test` (`npm run test:functional`) | `tests/player-match-center-ui.test.mjs`, `tests/phase2.2-player-match-center.test.mjs` | 130+ | **PASSED** |
| **Player Home & Navigation** | `node:test` (`npm run test:functional`) | `tests/phase2.1-player-home-corrections.test.mjs`, `tests/phase6-navigation-rbac.test.mjs` | 45+ | **PASSED** |
| **Server Auth & RBAC Security** | `node:test` (`npm run test:functional`) | `tests/server-auth.test.mjs`, `tests/server-security-phase5.test.mjs` | 55+ | **PASSED** |
| **Razorpay Lifecycle & Tampering** | `node:test` (`npm run test:functional`) | `tests/razorpay-lifecycle.test.mjs`, `tests/razorpay-tamper.test.mjs`, `tests/razorpay-webhook-negative.test.mjs` | 38+ | **PASSED** |
| **Utilities & Input Sanitization** | `node:test` (`npm run test:functional`) | `tests/utils-functional.test.mjs` | 52 | **PASSED** |
| **Security Rules Emulator** | `@firebase/rules-unit-testing` (`npm run test:emulator`) | `tests/*emulator*.test.mjs`, `tests/firestore-rules.test.mjs` | 114+ | **PASSED in CI** (Verified in CI Runs 44651141614, 44574075080) |
| **Playwright E2E** | `@playwright/test` (`npm test`) | `e2e/production-app.spec.ts`, `e2e/player-match-center-behavioral.spec.ts`, etc. | 34+ | **PASSED in CI** (Executes in `test-e2e-dev` job) |

---

## 2. Actual Test Execution Evidence

### Functional & Unit Test Suite (`npm run test:functional`)

Executed locally on branch `mig-mov` at HEAD `8978577`:

```bash
$ npm run test:functional

> ai-studio-applet@0.1.0 test:functional
> node --test tests/*.test.mjs

✔ FIN-006: getClubCalendarDate calculates date deterministically in Asia/Kolkata (32.9ms)
✔ FIN-006: computeLateFees enforces Tuesday EOD deadline in Asia/Kolkata (0.3ms)
✔ FIN-006: Sunday matches have the same Tuesday deadline as Saturday matches (0.1ms)
✔ FIN-006: Weekday matches do not generate weekend late fees (0.05ms)
✔ FIN-005: Abandoned match accounting retains collected cash while zeroing dues (0.08ms)
✔ FIN-007: Late fees deduplicate against existing otherFees records (0.17ms)
✔ Option A: Status 'Waived' is recognized and excluded from player dues (0.06ms)
...
▶ Database Isolation & Payment Safety Verification
  ✔ enables payment operations ONLY when branch is 'main' AND DB is production (0.6ms)
  ✔ disables payment operations on 'mig-mov' with development DB (0.25ms)
  ✔ disables payment operations on 'mig-mov' even if configured with production DB (0.13ms)
  ✔ fails closed when branch identity is missing or conflicting (0.08ms)
...
▶ Player Match Center UI Verification (Phase 2.2)
  ✔ validates authoritative match navigation across all entry points (1.2ms)
  ✔ resolves player fee overrides with timestamp and document ID tie-breaking (0.8ms)
  ✔ aggregates multi-channel payments without duplicate counting (0.9ms)
...
ℹ tests 462
ℹ suites 101
ℹ pass 462
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1147.64
```

**Result:** **462 tests passed, 0 failures, 0 skipped.** Execution duration: 1.15 seconds.

### Firebase Emulator Suite (`npm run test:emulator`)

- **Execution Command:** `node scripts/run-emulator-tests.mjs`
- **Environment Prerequisite:** Requires a local Java Runtime Environment (JRE/JDK 11+).
- **Local Limitation:** On the current development machine, `java -version` returns `Unable to locate a Java Runtime`. Therefore, emulator tests cannot execute locally in this environment without installing Java. Local environment must not be altered per operating constraints.
- **CI Verification:** The entire emulator suite (including 114 adversarial merge, lock, and rules tests in `remediation1f-secure-merge-recovery-and-consistency.emulator.test.mjs`) executes and passes on GitHub Actions CI runner (`ubuntu-latest` with OpenJDK 21 Temurin).
  - Verified GitHub Actions Runs:
    - [Run 44651141614](https://github.com/dixitashutosh007/KAvach-Play/actions/runs/44651141614) (Commit `9590e875`, Pass 5)
    - [Run 44574075080](https://github.com/dixitashutosh007/KAvach-Play/actions/runs/44574075080) (Commit `946548e1`, Pass 4)
    - [Run 44570189619](https://github.com/dixitashutosh007/KAvach-Play/actions/runs/44570189619) (Commit `450c4873`, Pass 3)
    - [Run 44559161481](https://github.com/dixitashutosh007/KAvach-Play/actions/runs/44559161481) (Commit `4b96d013`, Pass 2)

---

## 3. Retrospective Defect Register & Resolution Proof

The following table documents the reconciliation of the 20+ defects uncovered in the initial independent audit of commit `acff8325`:

| Defect ID | Severity | Category | Description | Remediated In | Verified Proof |
|---|---|---|---|---|---|
| **SEC-001** | P0 | Security | Privilege escalation via `appUsers.role` self-edit | `firestore.rules`, `lib/server-auth.ts` | Custom claim `admin: true` enforced; tests in `server-auth.test.mjs` pass. |
| **SEC-002** | P0 | Security | Player payment self-marking as `Paid` | `firestore.rules` L577-602 | Client self-update restricted to `Unpaid` ↔ `Not Playing`; tests pass. |
| **SEC-003** | P1 | Security | Player self-mutation of `otherFees` | `firestore.rules` L518-522 | Restricted to Finance/Super Admin; tests in `remediation1-firestore-auth.emulator.test.mjs` pass. |
| **SEC-004** | P1 | Security | Broad nested reads on `payments` and `otherFees` | `firestore.rules`, `useStore.ts` | Scoped collection-group queries; rules require `isSelf()`. |
| **SEC-005** | P2 | Security | Any user can update club posts | `firestore.rules` L418-423 | Restricted to `isAnyAdmin()`. |
| **SEC-006** | P2 | Security | Arbitrary pricing on `merchOrders` | `firestore.rules` L610-629 | Client creation requires `paymentStatus: 'Unpaid'`; price modification blocked. |
| **FIN-001** | P0 | Finance | Client-supplied amount in Razorpay order creation | `app/api/razorpay/order/route.ts` | Server calls `derivePayableAmount()`, client amount discarded; `razorpay-tamper.test.mjs` passes. |
| **FIN-002** | P1 | Finance | Webhook marks intent Paid before downstream processing | `app/api/razorpay/webhook/route.ts` | Processed inside atomic Firestore transaction; `razorpay-webhook-concurrency.test.mjs` passes. |
| **FIN-003** | P1 | Finance | Webhook lacks captured amount/currency comparison | `lib/razorpay-webhook.ts` | Verifies amount, currency (INR), and order ID before applying effects. |
| **FIN-004** | P1 | Finance | Merch order relied on browser callback for finalization | `lib/razorpay-webhook.ts` | Finalized server-side in webhook transaction; browser dependency eliminated. |
| **FIN-005** | P1 | Finance | Abandoned matches excluded paid cash from grand totals | `lib/personal-match-payment.ts` | Historical cash collected separated from current billable obligations. |
| **FIN-006** | P2 | Finance | Late-fee calculation used device local time | `lib/utils.ts` | Evaluated strictly in `Asia/Kolkata` timezone; tests in `utils-functional.test.mjs` pass. |
| **FIN-007** | P2 | Finance | Re-levying of duplicate automatic late fees | `lib/personal-match-payment.ts` | Deduplicates against existing `templateId` records. |
| **IDT-001** | P1 | Identity | Merge reparented records but missed `appUsers.playerId` | `lib/player-merge.ts` | Full identity reparenting in `migrateAppUsersAndIndexesStage()`. |
| **IDT-002** | P1 | Identity | Dual-write consistency failed for non-admins | `app/api/player/link-account` | Centralized atomic server linking using Admin SDK. |
| **IDT-003** | P2 | Identity | Substring phone lookup caused account collisions | `lib/account-linking.ts` | Strict canonical 10-digit phone normalization. |
| **UX-001** | P1 | UX | Mobile header collision at 360x800 viewport | `components/layout/AppHeader.tsx` | Responsive header layout with truncated title and flexible actions. |
| **UX-002** | P2 | UX | Inconsistent brand token usage (`#A30F2D` vs `#D51F43`) | `app/globals.css`, `theme.ts` | Consolidated semantic tokens per approved Design System. |
| **UX-003** | P2 | UX | LoadingScreen flashed dark-green in light theme | `components/LoadingScreen.tsx` | Clean light-theme background (`#F6F7F9`) and scarlet spinner. |
| **UX-004** | P2 | UX | MobileBottomNav returned null for admin persona | `components/layout/MobileBottomNav.tsx` | Unified Player View default (D-10) with Admin Console entry pill. |
| **ARCH-001**| P2 | Architecture | Firestore listeners remained active until logout | `hooks/useStore.ts` | Implemented `lazySubsRef` listener registration and teardown lifecycle. |
| **ARCH-004**| P3 | Architecture | Next.js build ignored TS/ESLint errors | `next.config.ts`, `package.json` | 0 TypeScript errors introduced; production build succeeds cleanly. |
| **QA-001** | P1 | Quality | Tests duplicated logic instead of importing production code | `tests/` | Tests refactored to import production modules directly. |
| **QA-002** | P1 | Quality | Absence of Firebase security rules test suite | `tests/*emulator*.test.mjs` | Comprehensive suite added with 114+ emulator test scenarios. |

---

## 4. Known Testing Limitations & Environment Blockers

1. **Host Java Runtime Missing:**
   - As verified above, the local macOS environment does not have a JRE/JDK installed.
   - **Impact:** `npm run test:emulator` cannot be executed locally. It must be run in GitHub Actions CI where OpenJDK 21 is provisioned.
2. **Branch Database Isolation Prevents Live Payment Testing on `mig-mov`:**
   - By design, `arePaymentOperationsEnabled()` fails closed on `mig-mov`.
   - **Impact:** Live payment transactions cannot be submitted against `kavach-play-db-ext`. Payment workflows must be tested using unit mocks or the local emulator.
3. **No Independent Staging URL:**
   - Production is hosted at `https://play.kavachcricket.com`.
   - A separate deployed staging web application (e.g. `staging.play.kavachcricket.com`) connected to `kavach-play-db-ext` has not been formally provisioned. E2E browser tests must run against local development servers (`localhost:3000`).
