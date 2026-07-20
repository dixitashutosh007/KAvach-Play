# KAvach Play — Code Improvements Review

**Reviewer:** Claude (code review pass on `mig-mov`)
**Date:** 2026-07-20
**Scope:** modularity, security, cost, load time, UX, module-based access.

This is a prioritized findings document. Each finding: **what**, **why it matters**, **fix**. Ordered by return-on-effort — highest impact first.

---

## Executive summary — the top 3 things to fix

1. **`hooks/useStore.ts` subscribes to 20 collections on every login, for every user.** That's the root cause of cost, slow load, and the "one edit affects everything" pain you noticed. Fix this and half the other problems disappear.
2. **Massive component files** (`MatchesTab.tsx` 3,212 lines, `page.tsx` 2,262, `ShopTab.tsx` 2,131). Any edit anywhere risks breaking the whole tab because everything shares state and effects. Split them.
3. **Security posture leans on convention, not enforcement.** Hardcoded super-admin email in both code and Firestore rules; secrets stored in a Firestore doc anyone with DB read can see; RBAC checks live client-side. Any of these three is a real vulnerability.

Everything below expands on those, plus a modularity plan and a phased rollout.

---

## 1. Modularity (your main concern)

### Why every edit affects everything

- `app/page.tsx` (2,262 lines) is the router, the auth gate, the theme system, the persona switcher, the registration form, and the mobile/desktop nav all in one file. Any change to any of those forces a rebuild of the whole tree, and a bug in any of them breaks login.
- `MatchesTab.tsx` (3,212 lines) contains match listing, match editor, squad management, payment tracker, streaming controls, and admin actions in a single component with dozens of `useState`s. Same problem at tab-scope.
- `hooks/useStore.ts` (1,439 lines) is a single provider that every tab reads from. When Firestore emits an update for `notifications`, every tab re-renders even though only `NotificationsTab` cares.

### Concrete refactor plan (safe, incremental)

Do this over several PRs, not in one shot.

**Step 1 — Split `app/page.tsx`.** Extract to files:

| Extract to | Contains |
|---|---|
| `app/(auth)/login/page.tsx` | Everything in the "if (!user)" block — login screens, phone form, Google button, email form |
| `components/onboarding/RegistrationForm.tsx` | The mandatory registration form (350 lines) |
| `components/onboarding/PhoneSyncPrompt.tsx` | The "Welcome back, sync your account" screen |
| `components/onboarding/RejectedScreen.tsx` | The "Request Declined" screen |
| `components/onboarding/PendingScreen.tsx` | The "Registration Pending" screen |
| `components/layout/AppShell.tsx` | Sidebar + bottom nav + persona switcher — the wrapper around all tabs |
| `components/layout/ThemeProvider.tsx` | Theme presets, CSS variable injection |
| `hooks/useCurrentUser.ts` | Wraps `useStore` + `useAuth` and returns `{ appUser, player, isAdmin, isFinanceAdmin, ... }` — one place for role logic |

After this, `page.tsx` should be ~150 lines: check auth state, route to the right screen. Nothing else.

**Step 2 — Split the big tabs.**

- **`MatchesTab.tsx`** → split by role/mode:
  - `MatchList.tsx` — the list view (read-only for most users)
  - `MatchDetail.tsx` — one match's detail
  - `admin/MatchEditor.tsx` — create/edit form
  - `admin/SquadManager.tsx` — squad selection
  - `admin/PaymentTracker.tsx` — payment status
  - `LiveStreamPanel.tsx` — streaming URL/matchUrl display
- **`ShopTab.tsx`** → `MerchandiseGrid.tsx`, `MerchandiseDetail.tsx`, `OrderForm.tsx`, `admin/MerchandiseEditor.tsx`, `admin/OrderManager.tsx`.
- **`FinanceTab.tsx`** → `DuesList.tsx`, `PaymentHistory.tsx`, `admin/FeeAssigner.tsx`, `admin/BulkReminder.tsx`.
- **`SettingsTab.tsx`** → per-section (`GeneralSettings.tsx`, `EmailSettings.tsx`, `ThemeSettings.tsx`, `FeaturesToggle.tsx`, `AdminAssignments.tsx`).

**Rule of thumb:** any file over ~400 lines should be split. Any component with more than ~10 `useState` calls should be split. There are no exceptions worth defending.

**Step 3 — Replace the monolithic `useStore` with per-domain hooks.**

Currently every tab imports the whole store. Instead:

```
hooks/
  useCurrentUser.ts    — the authenticated user + their appUser/player
  useMatches.ts        — matches only, subscribes on mount, unsubscribes on unmount
  useMatchPayments.ts  — payments for a specific matchId (not ALL payments)
  usePlayers.ts        — the player roster (admins only)
  useFeed.ts           — posts + comments
  useNotifications.ts  — the current user's notifications only
  ...one hook per collection
```

Each hook subscribes only when a tab that uses it is mounted. When you switch tabs, unused subscriptions detach. This is the single biggest cost + perf win.

---

## 2. Data-layer cost, load time, and correctness

### Findings

**`useStore.ts` uses `onSnapshot` for 20 collections** — always on, for every logged-in user. Even the "read-once and forget" collections like `grounds` (12 docs, never changes) and `subscriptionPlans` (7 docs, changes maybe monthly) are live real-time subscriptions.

**`collectionGroup(db, "payments")` at line 254** — this subscribes to **every payment doc in every match, for every user**. That's your 2,878 docs from the export, streamed live to every logged-in user's browser on every page load. And it's deduped in memory client-side, which means the browser holds all 2,878 in RAM regardless of what tab you're on.

**No pagination anywhere.** `notifications` (8,049 docs, growing) is loaded in full. So is `razorpayIntents` (130 and growing). Every login re-reads every notification the user has ever received.

**No offline persistence limits.** Persistent local cache is enabled but not sized. Users on constrained devices (phones with little storage) may fill up.

### Fixes, in order of impact

1. **Kill the `collectionGroup` payments subscription.** Only fetch payments for matches the user is currently viewing. Rough impact: ~90% reduction in Firestore reads per session.
2. **Add pagination to `notifications` and `razorpayIntents`.** Load 50 at a time, "Load more" button. 8,049 → 50 initial docs per user.
3. **Move "static" collections to one-shot fetch:** `grounds`, `subscriptionPlans`, `feeTemplates`, `merchandises`, `appConfig`, `feeTemplates`. Use `getDocs` on mount, refresh on manual action. 5 fewer live subscriptions per user.
4. **Split by role:** don't subscribe non-admins to `appUsers` (104 docs of PII), `razorpayIntents`, `subscriptionHistory`. Players don't need this data.
5. **Add a TTL policy to `notifications`.** Auto-delete anything older than 90 days. Firestore doesn't have TTL directly, but a scheduled function can prune.
6. **Server-side rendering (SSR) for public pages** like `/policy` and `/legal` (already static). And a `/pay/[playerId]` page that renders payment info server-side rather than fetching client-side.

### Rough cost impact

For your 150 users, the current pattern likely uses **~2–4M Firestore reads per month** (mostly the payment collectionGroup replaying to every session). Cutting the collectionGroup alone drops this to under 500k/month. Firestore's free tier is 50k reads/day (~1.5M/month) — the current app is at real risk of hitting it, which is why you saw the quota-exceeded UI already coded up.

---

## 3. Security

### Concrete findings, most-severe first

1. **Hardcoded super-admin email** (`dixitashutosh007@gmail.com`) in three places:
   - `app/page.tsx` (auth gate)
   - `hooks/useStore.ts` line 99
   - `firestore.rules` line 22
   If anyone gains that email address's Firebase Auth session, they're super-admin. And if you ever want to hand admin off to someone else, you have to redeploy code. **Fix:** move super-admin identity to a `superAdmins` collection or a Firebase Auth custom claim; check in one place.
2. **Secrets stored in `appConfig` Firestore document as plaintext:** `razorpayKeySecret`, `smtpPassword`, `resendApiKey`, `whatsappAccessToken`. Any user with `read` on `appConfig` — which is `allow read: if true` (public!) in `firestore.rules` line 71 — can read these. **Test right now:** open any browser console on your app, run `await firebase.firestore().collection('appConfig').doc('default').get()` — you'll see the keys. Move to server-only env vars (Amplify env) and delete these fields.
3. **`notifications` collection has `allow update: if isSignedIn()`** (line 268 of rules) — any logged-in user can mark anyone else's notification as read, or overwrite it with junk. Should be `if isSignedIn() && resource.data.userId == request.auth.uid`.
4. **Role checks live in the client.** `isAdmin` is computed in `app/page.tsx` from `appUsers` fields. If a bad actor tampers with the browser, they can flip `isAdmin` to true in their local state and see admin UI. Firestore rules still block the actual writes, so it's cosmetic damage — but they can *see* the players table, PII, financial data, etc. **Fix:** Firestore rules should be the only source of truth. Admin UI is fine to show optimistically, but sensitive data should never be sent to non-admin clients — enforce with rules and query filters.
5. **Firestore rules for `players`** allow update via a very permissive phone-match regex (line 295). The `.replace('\\+', '')` and `.matches('.*' + existing().mobile + '.*')` pattern is prone to false-positive matches — e.g., mobile `1234` matches phone `+911234567890`. **Fix:** exact-match after normalization.
6. **Firestore rules have `allow update: if true` for `paymentLinks`** (line 195). Anyone can rewrite any payment link. Probably not exploited yet but very dangerous.
7. **No rate limiting on API routes.** `/api/email/send`, `/api/razorpay/order` accept any authenticated caller with no throttle. A malicious user could burn your Resend/SES quota.
8. **`API_SECRET` and `REPORT_API_SECRET` are shared secrets** with no rotation. If leaked (they're in env vars visible to anyone with Amplify Console access), no way to know or invalidate.
9. **`localStorage.setItem("kavach_session_time")` is used for session timeout** (AuthProvider line 51). This can be tampered with client-side to extend sessions. Sessions should be validated server-side via Firebase Auth tokens.

### Access-control redesign ("module-based access")

You mentioned wanting **module-based access**. The current model is coarse — role + a few boolean flags on `appUsers`. Better:

```typescript
// A permissions matrix keyed by feature/module and action
type Permission = 
  | "matches:view" | "matches:edit" | "matches:delete"
  | "finance:view" | "finance:edit" | "finance:reminders"
  | "players:view" | "players:edit" | "players:invite" | "players:disable"
  | "studio:view" | "studio:manage-plans" | "studio:approve-payments"
  | "shop:view" | "shop:manage-inventory" | "shop:fulfill"
  | "settings:general" | "settings:secrets" | "settings:themes";

// Each user has a set of permissions
type AppUser = {
  ...
  permissions: Permission[];      // explicit grants
  roles: Role[];                  // named bundles like "match-admin"
};

// Role bundles applied server-side:
const ROLE_TEMPLATES: Record<Role, Permission[]> = {
  "match-admin": ["matches:view", "matches:edit", "matches:delete"],
  "finance-admin": ["finance:view", "finance:edit", "finance:reminders", "players:view"],
  "studio-admin": ["studio:view", "studio:manage-plans", "studio:approve-payments"],
  "super-admin": [/* all */],
  "player": ["matches:view", "finance:view", "studio:view", "shop:view"],
};
```

Then a single `hasPermission(user, "matches:edit")` check runs in the UI (for showing/hiding) and, more importantly, in Firestore rules (via a custom claim on the Firebase Auth token).

This gives you:
- New roles without code changes (just a new template).
- Fine-grained delegation (e.g., "Sunita can add players but not delete them").
- Audit-friendly (permission changes are logged).

Not a massive refactor — the current `isMatchAdmin/isFinanceAdmin/isStudioAdmin` booleans map cleanly to bundle names.

---

## 4. Load time

### Current pain

- **Everything is a client component.** Login page, feed, matches — all `"use client"`. Next.js can't pre-render anything on the server for these. Users wait for the entire JS bundle before seeing content.
- **Initial bundle carries every tab's code** — even though a user might never open Studio or Shop. `MatchesTab` (3,212 lines) is downloaded on first paint.
- **Firebase SDK (~200KB gzipped) loads synchronously.** Loading screen is shown for 1.5 seconds minimum (`setTimeout(setMinWaitDone, 1500)` in `app/page.tsx`).
- **`experimentalForceLongPolling: true`** for Firestore. This is set because AI Studio's iframe had socket issues. On Amplify (no such restriction) this is unnecessary and slows connections.

### Fixes

1. **Route-split the tabs.** Use `dynamic(() => import(...))` for each tab so only the code for the active tab downloads. Amplify + Next.js supports this natively.
2. **Move public pages to server components.** `/policy`, `/legal`, and the login page can render on the server. Removes ~50KB from the client bundle for anonymous visits.
3. **Remove the forced 1.5s wait** at page.tsx line 164. It was there to hide loading jitter in AI Studio — no longer needed.
4. **Set `experimentalForceLongPolling` conditionally** — only when needed (detect via env var). On Amplify, use the default WebSocket transport.
5. **Preload the current user's data first**, then background-load the rest. Right now everything loads in parallel and the app waits for the slowest.
6. **Use `next/image` for player photos** with proper sizing. Currently `photoURL` fields are `<img src={...}>` at full resolution.

---

## 5. UX improvements

Concrete, small wins:

1. **Replace `alert()` calls** (many, e.g. AuthProvider.tsx line 87, page.tsx line 841). Use a toast library — one dependency, dramatically better feel.
2. **Loading skeletons** instead of blank screens on tab switch.
3. **Optimistic updates** on match edits, availability changes, payment status. Currently every mutation waits for Firestore round-trip. Optimistic + rollback-on-error feels instant.
4. **Empty states.** Some tabs just show nothing when there's no data. Add helpful empty-state components ("No matches yet — create your first one").
5. **Better error messaging.** The Firestore quota screen is nice; other errors are console-only. Show them in a banner.
6. **Confirm dialogs for destructive actions.** Deletes are currently one-click in admin views.
7. **Keyboard shortcuts for admins.** `Cmd+K` search, `?` for shortcut help. Tiny addition, big power-user love.
8. **PWA install prompt** — you have `viewport` and mobile-first design, add a manifest and register a service worker. Users can install it as an app on their phone.
9. **Persist last-active tab** in `localStorage` so a refresh returns you where you were.
10. **The 30-day session expiry via localStorage** (AuthProvider line 43) is confusing — user gets silently logged out with no warning. Show a "Session expiring in 3 days" nudge.

---

## Prioritized action plan

I'd tackle these in this order — each stage independently deployable, each unlocks the next:

### Wave 1 — Bleed-stoppers (1 week)

- Move secrets from `appConfig` to env vars. (Security — critical.)
- Fix `notifications` update rule. (Security — critical.)
- Kill the `collectionGroup` payments subscription; fetch per-match. (Cost + perf — big.)
- Delete the 1.5s `minWaitDone` timer. (Load time — free win.)

### Wave 2 — Modularity foundation (2 weeks)

- Extract `app/page.tsx` into route files (`login`, `onboarding`, `AppShell`).
- Extract `useStore` into per-domain hooks.
- Set up route-splitting so tabs load lazily.

### Wave 3 — Big-file splits (3 weeks)

- Split `MatchesTab`, `ShopTab`, `FinanceTab`, `SettingsTab` per plan in section 1.
- Add toast library; remove all `alert()` calls.
- Add loading skeletons.

### Wave 4 — Access model (1 week)

- Introduce the permissions matrix.
- Migrate existing role booleans to permission arrays.
- Add Firebase Auth custom claims for server-side enforcement.
- Rewrite `firestore.rules` to check claims, remove hardcoded email.

### Wave 5 — Polish (ongoing)

- SSR for public pages.
- Optimistic updates on hot paths.
- Pagination on notifications.
- PWA manifest.

None of this blocks the AWS migration (Cognito, DynamoDB). In fact, doing Waves 1–4 first makes the migration easier because the code will be cleaner and the data patterns will be explicit.

---

## What I'd do next

Pick one Wave 1 item and I'll implement it end-to-end so you can see the pattern. My suggestion: **kill the `collectionGroup` payments subscription** — one function change in `useStore.ts`, immediate cost benefit, easy to verify. Then we do the secrets one, and so on.
