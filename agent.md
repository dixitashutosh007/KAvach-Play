# KAvach Play — Agent Instructions

Last updated: 2026-11-20
Repository: https://github.com/dixitashutosh007/KAvach-Play
Development branch: `mig-mov`
Production branch: `main`

## 1. Role and operating model

This repository is developed with an AI coding agent (Antigravity or Claude) and reviewed independently by ChatGPT.

The coding agent is responsible for implementation. ChatGPT is the read-only independent reviewer and product/architecture partner. The human project owner approves scope, consequential operations, and promotion to production.

Follow this cycle:
1. Understand the requested feature and existing implementation.
2. Ask only material clarification questions; do not block on details that can be safely derived from existing code or agreed product direction.
3. Inspect relevant routes, components, data models, APIs, authorization, and tests before editing.
4. Implement the smallest coherent change that meets the requirement.
5. Run proportionate targeted validation.
6. Summarize changed files, behavior, tests, risks, and limitations.
7. Commit only to `mig-mov` and provide the full commit SHA for independent review.
8. Address review findings in a focused correction commit and provide its SHA.

Do not claim a feature is complete merely because implementation has been written. Report what was actually validated.

## 2. Branch and repository governance

- All development work must be performed on `mig-mov`.
- Never commit, push, or otherwise modify `main`.
- Never merge or promote to production without explicit owner approval.
- Before editing, verify the current branch and working-tree state.
- If the working branch is not `mig-mov`, stop and ask for direction; do not silently switch branches if that could disturb local work.
- Do not overwrite unrelated user changes.
- Keep commits focused and descriptive.
- Do not make unrelated refactors, dependency upgrades, formatting sweeps, or generated-file churn.
- Do not modify repository settings, secrets, deployment configuration, or cloud resources unless explicitly included in the approved task.

## 3. Product context

KAvach Play is a cricket club management platform for KAvach Cricket Club. It supports player-facing cricket participation and club administration.

The intended product scope includes:
- Player home and club announcements
- Match scheduling, match center, squads, and availability
- Player profiles, performance, and statistics
- Match fees, payments, dues, and finance operations
- Practice studio subscriptions
- Badges and achievements
- Club feed and player directory
- Tournaments
- Merchandise and shop
- Club administration, governance, and reporting

The product should be professional and scalable for a growing club.

### Product experience and design direction

- Premium sports-tech personality: energetic, bold, modern, polished.
- Scarlet red is the primary brand direction, supported by calmer colors suitable for extended use.
- Cinematic cricket imagery and campaign-led club content where appropriate.
- Balanced information density; avoid clutter and generic admin-template aesthetics.
- Mobile-first, with deliberate responsive desktop experiences. Admin workflows must remain efficient on desktop.
- Reuse established design tokens, components, patterns, and accessibility conventions. Do not introduce a parallel design system.

Previously discussed UX expectations (validate current implementation before changing):
- Player Home: search, campaign/announcement banner, birthday content, payment due summary and Pay action, upcoming matches with availability, club feed.
- Admin Home quick actions: add squad to match, edit match/view calendar, add player to studio, record catch, add no-show, grant badge, invite players, view dues.
- Finance: total dues, match-wise dues, players with dues, no-show dues, collected/outstanding/sponsored amounts, and paid/unpaid player visibility.
- Match management: admin list/calendar/table views; player-relevant upcoming and past matches; clear payment state; easy availability updates.
- Payment model was previously described as hybrid. Discount permissions and reminders were expected to support both relevant admin/manual and automated workflows. Confirm actual business rules before changing payment behavior.

## 4. Technical architecture

The application has used the following stack (verify current files and package versions before relying on version-specific details):
- Next.js / React / TypeScript
- Firebase Authentication
- Cloud Firestore
- Firebase Admin SDK for server-side access
- Razorpay payment integration
- Tailwind CSS
- Lucide React
- Motion
- Playwright
- Firebase Emulator / rules testing tools

Architecture rules:
- Follow existing folder structure, naming, data-access abstractions, validation patterns, and component conventions.
- Prefer reuse over duplication.
- Keep privileged Firebase Admin operations server-side.
- Use the established server Firestore abstraction (historically `getServerFirestore()`) rather than creating ad hoc Admin SDK clients. Inspect the current implementation before editing.
- Keep client/server boundaries explicit. Do not leak service credentials, secrets, or privileged data to client bundles.
- Validate all untrusted inputs server-side.
- Enforce authorization server-side; do not trust client-supplied roles, ownership, payment state, or monetary values.
- Handle loading, empty, error, retry, and permission-denied states deliberately.
- Preserve auditability for administrative and financial actions.
- Avoid broad schema changes. If a schema migration is required, explain compatibility, rollout, and rollback before implementation.

## 5. Security and financial integrity

Treat these as high-priority invariants:
- Enforce least privilege and role boundaries.
- Validate record ownership and access scope on every sensitive server operation.
- Protect identity and account-linking data, including collections historically named `phoneIndex`, `uidIndex`, and `mergeJobs`.
- Avoid IDOR, privilege escalation, mass assignment, replay, race conditions, and trust of client-controlled fields.
- Use atomic transactions or equivalent concurrency-safe mechanisms for financial state transitions where required.
- Preserve idempotency and webhook signature verification for payment workflows.
- Never log secrets, access tokens, payment credentials, or unnecessary personal data.
- Keep Firestore Rules and server-side authorization consistent; neither substitutes for the other.
- Do not weaken security controls to make local development or tests pass.

### Razorpay / payment isolation

The development branch must not initiate real payment operations.

Historically, the application used an `arePaymentOperationsEnabled()` guard to restrict payment operations to the approved production branch/database combination. Verify the current implementation before relying on exact function names.

Never remove, bypass, or weaken payment isolation. Do not send live Razorpay requests, create real orders, capture payments, issue refunds, or alter webhook configuration from `mig-mov`.

## 6. Cloud environment boundaries

The canonical environment identifiers and refresh state are documented in [cloud.md](cloud.md). Read that file before any task involving Firebase, Firestore, cloud configuration, deployment, data migration, or payment infrastructure.

Core rules:
- `mig-mov` is development and must use the development Firestore database.
- `main` is production and must use the production Firestore database.
- Firebase Authentication is intentionally shared between the two environments.
- Never write to, delete from, import into, or change production resources as part of ordinary development.
- Production data may be read only when explicitly needed and authorized.
- Do not run destructive database commands, imports, exports, restores, or rules/index deployments without explicit human authorization.
- Do not infer that an operation is safe because its command looks read-only; inspect its exact target and effects.
- Never expose or commit credentials, service-account keys, access tokens, or secrets. If a credential file is found in the working tree, stop and report it; do not copy it into commits.

## 7. Testing and validation policy

Use a staged validation strategy. Do not run the entire Playwright suite after every small change.

Note: `.github/workflows/ci.yml` runs automatically on every push to `mig-mov` (lint, typecheck, functional, emulator and Playwright jobs). Treat a push as a CI trigger.

Local Playwright behavioural specs inject a synthetic store (`e2e/helpers/synthetic-session.ts`) and do not read Firestore. Run them against a local `next dev` with `AWS_BRANCH=mig-mov`.

### Small, isolated change
- Run the narrowest relevant unit/functional test.
- Run targeted lint/type checks when useful.
- Review the changed code paths and manually reason through edge cases.

### Related group of changes
- Run relevant integration, emulator, or focused regression tests.
- Add tests for new behavior and important failure paths.

### Significant milestone or broad cross-module change
- Propose a broader regression plan, including full Playwright where appropriate.
- Run the full suite only when the owner approves or the agreed milestone explicitly calls for it.

Additional rules:
- Do not trigger GitHub Actions/CI unless explicitly authorized.
- Do not run production E2E tests.
- Do not run tests that write to production.
- Never report tests as passed unless they were actually run and their results were observed.
- If a test is skipped, blocked, flaky, or unavailable, state that clearly.
- For Firestore security changes, use focused rules-unit tests/emulator validation where available; a successful compile alone is not a complete security audit.

## 8. Implementation prompt and handoff expectations

When asked to implement a feature, first inspect the current code and then create a self-contained plan/prompt covering:
- Objective and user problem
- User roles and permissions
- Functional behavior and acceptance criteria
- UI/UX and responsive behavior
- Existing components/APIs/data models to reuse
- Data and migration implications
- Security and abuse cases
- Error/empty/loading states
- Targeted tests and explicit tests not to run
- Scope exclusions

At completion, provide:
- Branch name and commit SHA
- Concise implementation summary
- Changed-file list
- Tests actually run and exact results
- Tests not run and why
- Known limitations, risks, and follow-up items

Do not claim documentation such as this file has been updated unless the update is committed.

## 9. Independent review contract

The independent reviewer may inspect the commit and request corrections. Treat those findings as actionable engineering feedback.

When a review identifies a defect:
- Reproduce or trace the issue where feasible.
- Fix the root cause, not just the symptom.
- Add or adjust focused tests.
- Avoid unrelated scope expansion.
- Provide a new commit SHA and an honest validation summary.

Do not self-approve high-risk security, authorization, data-integrity, or payment changes without adequate evidence.

## 10. Switching between Antigravity and Claude

The project may switch coding agents because of usage limits. Preserve continuity:
- Keep this file and [cloud.md](cloud.md) accurate when the owner asks for updates.
- Record accepted architecture decisions and non-obvious constraints in repository documentation.
- At handoff, state current branch/HEAD, completed commits, pending work, known defects, test status, and next task.
- Do not assume the next agent has access to the previous agent's conversation.
- Do not invent undocumented decisions. Mark uncertain or historical details for verification.
