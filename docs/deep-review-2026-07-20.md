# Deep Code Review — 2026-07-20

Follows the cost-cleanup pass. Purpose: verify the whole codebase against a checklist of correctness, cost, security, and UX concerns. Safe issues fixed inline; architectural / risky ones documented below with severity for owner review.

## Inline fixes applied this pass

1. **`hooks/useStore.ts` → `addMatch`: batched Firestore writes.**
   Previously 99 sequential `setDoc` calls (one per player) — one HTTP round-trip each = ~5–15s of wall-clock time and 99 billable Firestore writes serialised. Now uses `writeBatch` in chunks of 400 (under the 500-op limit) — 1 round-trip per batch. Player-count of 99 becomes 1 round-trip.
2. **Repo cleanup**: deleted 17 leftover scratch files at repo root (`test-*.js`, `test-*.ts`, `check*.js`, `query_*.js`, `fetch-redirect.js`, `get_matches.js`, `matches.json`, `test_db.js`) plus `app/applet/` — none imported anywhere, all were ad-hoc debug scripts.
3. **`components/DuesAndRemindersTab.tsx`**: already fixed as part of the cost-cleanup pass (removed automatic scheduling UI, renamed subtab to "Email Template").

## Findings still open (owner review needed)

Each item is graded H/M/L for user-visible impact.

### Correctness

- **M — `updateMatch` fires 99 in-app notifications on every field change** (`hooks/useStore.ts` line 878). An admin fixing a typo in `opponent` currently pushes a "Match Updated" to every verified player. Consider only notifying when material fields change (date, time, ground, fee, format), or debouncing.
- **M — Notifications collection is dominated by these bulk broadcasts.** The TTL policy (Task 5) will trim them at 90 days, but the pagination-load window (50 docs) shows only a few hours of a user's inbox in an active club. Consider filtering server-side by `userId`.
- **L — `handleSyncAccount` in `app/page.tsx` copies old appUser data into the new UID but doesn't preserve `authUid` cross-link on the players doc if it already exists.** For single-mobile-per-player clubs it's fine; a player who had two devices might see confusion. Log-only, not a fix.

### Cost / perf

- **M — `updateMatch` also serial-broadcasts (see above); each notification is a Firestore write.** Same fix as `addMatch` — batchable. Skipped inline because the *right* fix is to reduce notification frequency, which is a product decision.
- **L — `hooks/useStore.ts` `ensurePayments()` still uses `collectionGroup("payments")` — reads all 2,878 payment docs when triggered.** Fine for admin tabs; for player-facing dues (Profile, Home widget) a `where("playerId", "==", currentPlayerId)` query would read ~47 docs per player instead of all. Requires composite index. Deferred until we see real cost data post-cleanup.
- **L — `ensureAllAppUsers()` loads all 100+ appUser docs when triggered.** Only fires on admin tabs. Not a spike source.

### Security

- **M — `updateNotification` from client is admin-gated in Firestore rules for broadcast notifs, but the client-side `NotificationsTab` marks-as-read by direct `updateDoc(doc(db, "notifications", id))`. Non-admin players get PERMISSION_DENIED on any userId=="admin" or userId=="all" notification.** Cosmetically confusing (mark-all-read silently fails on those); functionally safe. Fix: filter out broadcast notifs from "mark all" client-side, or expand the rule to allow the owner to also mark broadcasts read.
- **L — `firestore.rules` for `paymentLinks` still `allow update: if true`** (line 195-ish). If this collection is ever populated in production, anyone could rewrite any payment link. Currently empty per export. Recommend restricting.
- **L — `lib/firebase.ts` still hardcodes the production database ID as its final fallback.** If the env var is missing on a Cloud Run or Amplify deploy, the app connects to production silently. Consider throwing at startup if no DB ID is set.

### Data model

- **M — `AppConfig` still has legacy fields not in `types.ts`** (per an earlier export analysis): `whatsappTemplates.*`, `kavachOne`, `discount`, `isTentativeBlock` (probable typo of `isTentative`). Types file drifts from reality. Recommended: regenerate types from real data. Not touched to avoid ripple.
- **L — `pollResponses` collection has 4 orphaned rows** (from earlier export analysis) — the `polls` documents they reference no longer exist. Suggest a one-time cleanup script.
- **L — `subscriptionHistory` has two schema variants** (95% new, 5% legacy `userId`/`amount`/`startDate`). Same recommendation.

### UX

- **L — 107 `alert()` calls across the app.** They interrupt flow, block scrolling, and look native rather than themed. Long-term: introduce a toast library (`sonner` is one file to add). Not a safe inline fix — needs product review.
- **L — Firestore quota-exceeded banner (`app/page.tsx` ~line 975)** is separate from the full-screen `QuotaExceededScreen`. The Firebase Console deep-link URL is hardcoded to your project — will break if someone else deploys the app.
- **L — 30-day silent session expiry** in `AuthProvider` gives no warning to the user. They're logged out mid-action if their session lapses. Small toast on the day before would help.

### Testing / infra hygiene

- **L — No test suite.** For a growing app touching payments, adding a smoke test for the Razorpay order → webhook path would be the highest ROI.
- **L — Amplify build spec (`amplify.yml`) uses `--legacy-peer-deps`.** Works, but hides a real peer-dep mismatch. Worth investigating one day.

## What I did NOT touch (per the "safe fixes only" contract)

- Every ~500+ line component (`MatchesTab`, `ShopTab`, `FinanceTab`, `WixFinanceView`, `SettingsTab`, `HomeTab`, `ProfileTab`, `StudioAdminTab`, `PlayersTab`, `StudioTab`, `OpinionTab`, `AssignFeesAdmin`) is still monolithic. The `app/page.tsx` refactor left them alone. They'd benefit from the same split treatment but that's a series of dedicated refactors, not review-time work.
- Any refactor of the notification broadcast pattern.
- Any UX rework.
- Firestore rules restructuring.

## Suggested follow-ups, ranked by impact

1. **Filter notifications server-side by `userId`.** Requires a composite index but drops per-player reads dramatically.
2. **Decompose `MatchesTab.tsx` (3,213 lines).** Same treatment as `page.tsx` — target 6–8 focused files.
3. **Add a toast library and replace `alert()` calls.** Half a day of work, transforms the feel of the app.
4. **Notification broadcast throttling** (only material changes, batch writes).
5. **Introduce a smoke-test suite** starting with Razorpay flow.
