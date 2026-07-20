# KAvach Play — AWS Migration Runbook

**Owner:** Ashutosh
**Status:** Draft
**Last updated:** 2026-07-20

This document is the single source of truth for migrating KAvach Play off Firebase / Cloud Run onto AWS (Amplify + Cognito + DynamoDB + AppSync). It is written to be executable by a developer or an AI coding agent, and readable by a non-developer product owner.

---

## Read this first

- **The migration is staged.** Each stage is independently deployable and reversible. You never have to do all of it at once.
- **You can stop at any stage.** Stopping at Stage 1 (Amplify hosting, Firestore backend) is a legitimate end state.
- **No user-visible downtime is planned.** Zero re-signups. Data migration happens in the background with a dual-write window.
- **All timelines assume Claude Code driving the work with the owner (non-dev) reviewing and testing.**

---

## Current state (as of the export analyzed)

- **Hosting:** Google Cloud Run (previously Google AI Studio applet).
- **Auth:** Firebase Auth (phone-OTP primary, Google, email/password, anonymous).
- **Database:** Cloud Firestore. Real-time via `onSnapshot`. Persistent local cache enabled.
- **Storage:** Firebase Storage (photos, logos).
- **Payments:** Razorpay (`/api/razorpay/*`).
- **Email:** Resend or SMTP via nodemailer.
- **Cron:** `/api/cron/reminders`, `/api/reminders/*`.
- **Codebase:** Next.js 15 App Router, React 19, TypeScript, Tailwind v4.

### Data inventory (from `firestore-backup.json`)

| Collection | Docs | Notes |
|---|---:|---|
| notifications | 8,049 | 64% of DB. TTL candidate. |
| matches | 47 | Has `payments` subcollection |
| matches/{id}/payments | 2,878 | 94% "Not Playing" — pre-seeded rows |
| razorpayIntents | 130 | |
| appUsers | 104 | |
| players | 99 | Only ~15% have `authUid` linked |
| matchOrders | 17 | |
| subscriptionHistory | 19 | Two schema variants (95%/5%) |
| grounds | 12 | |
| subscriptionPlans | 7 | |
| feeTemplates | 6 | |
| pollResponses | 4 | Orphaned — no `polls` collection |
| outOfPlays | 3 | |
| playerStats | 3 | |
| merchandises | 2 | |
| appConfig | 1 | Contains plaintext secrets (see risks) |
| **Total** | **11,381** | 5.0 MB JSON |

### Collections referenced in code but empty in DB

`otherFees`, `posts`, `matchComments`, `polls`. Verify against the live app if unsure — features may not be in production use yet.

### Data-quality risks to fix before/during migration

1. **Secrets stored in `appConfig` document in plaintext**: `razorpayKeySecret`, `smtpPassword`, `resendApiKey`, `whatsappAccessToken`. Must move to AWS Secrets Manager. Anyone with DB read access has these keys today.
2. **`subscriptionHistory` schema drift**: 5% of docs use old field names (`userId`, `amount`, `startDate`, `endDate`, `status`) vs 95% using new (`playerId`, `paidAmount`, `oldExpiryDate`, `newExpiryDate`). Normalize during migration.
3. **`_id` and `id` fields duplicated** across most collections. Consolidate to `id`.
4. **10+ fields exist in DB but not in `lib/types.ts`** (`whatsapp*`, `kavachOne`, `discount`, `groundFeePaidAmount`, `isGroundFeePaid`, `isTentativeBlock` [likely typo of `isTentative`], `practiceFee`, `tournamentFee`, `deliveryStatus`, `isHidden`, `customPriceAdditions`). Types file must be regenerated from real data before rewrite.
5. **3% of players missing mandatory fields** (`dob`, `locality`, `bloodGroup`, etc.). Old records pre-dating the registration flow. Decision needed: backfill or flag.
6. **4 orphaned `pollResponses`** without matching `polls` documents. Delete or archive.
7. **~94% of `matchPayments` rows are default "Not Playing" entries.** Migration works fine, but consider whether to skip these on migration and generate them on-demand.

---

## Target state

- **Hosting:** AWS Amplify Hosting (Next.js SSR).
- **Auth:** Amazon Cognito User Pools. OAuth (Google), phone OTP via SNS, email/password.
- **Database:** Amazon DynamoDB (on-demand). Multi-table design.
- **Real-time:** AWS AppSync (GraphQL subscriptions) replacing Firestore `onSnapshot`.
- **Storage:** Amazon S3 (with CloudFront for reads).
- **Secrets:** AWS Secrets Manager.
- **Cron:** Amazon EventBridge → Lambda (replacing Vercel/Next cron routes).
- **Email:** Keep Resend/SMTP, or move to Amazon SES. Not blocking.
- **Region:** `ap-south-1` (Mumbai) — matches user base and existing `create-dynamodb-tables.sh`.

---

## Stages

### Stage 0 — Switch to Claude Code (DONE)

Nothing infrastructural. Owner uses Claude Code for all future edits instead of Google AI Studio. Live app unchanged.

**Exit criteria:** owner is issuing feature requests via Claude Code and getting them merged.

---

### Stage 1 — Amplify hosting, keep Firestore (1–3 days)

Move Next.js from Cloud Run to Amplify Hosting. **App keeps talking to Firebase/Firestore.** Zero data migration.

**Steps:**

1. Consolidate repos. Decide which of the two Kavach-Play repos (the AI Studio one and the AWS copy) is canonical. Archive the other. All future commits go to the survivor.
2. Add an Amplify build spec (`amplify.yml`) at repo root:
   ```yaml
   version: 1
   frontend:
     phases:
       preBuild:
         commands:
           - npm ci
       build:
         commands:
           - npm run build
     artifacts:
       baseDirectory: .next
       files:
         - '**/*'
     cache:
       paths:
         - node_modules/**/*
   ```
3. In AWS Amplify Console: **Create new app → Host web app → Connect GitHub → Choose branch (`main`).** Amplify detects Next.js SSR automatically.
4. Add environment variables in Amplify Console (copy from current Vercel/Cloud Run config): Firebase config keys, Razorpay keys, Resend/SMTP creds. Do not commit these.
5. Deploy. Test in a preview URL: login, matches, payments, admin flows.
6. Point production domain (via Route53 or existing registrar) at Amplify.
7. Retire Cloud Run.

**Exit criteria:** production traffic served by Amplify. Firebase still the backend. Cloud Run turned off.

**Rollback:** re-point DNS to Cloud Run. Cloud Run keeps the container image around; brings back up in minutes.

---

### Stage 2 — Cognito lazy migration for auth (1–2 weeks)

Auth first, database second — auth touches ~5 files, database touches ~30.

**How lazy migration works:**

1. Create a Cognito User Pool. Configure allowed identity providers: Google (OAuth), phone (SMS via SNS), email/password.
2. On the User Pool, attach a **User Migration Lambda trigger**. The Lambda code:
   - Receives the login attempt (email/password or phone/OTP).
   - Calls Firebase Auth REST API to verify credentials against the existing Firebase user pool.
   - If Firebase says "valid", the Lambda returns success, and Cognito silently creates a Cognito account with the same email/phone/UID.
   - If Firebase says "invalid", the Lambda returns error, Cognito rejects the login.
3. Client-side: replace `firebase/auth` calls with `@aws-amplify/auth` in `components/AuthProvider.tsx`, `components/PhoneLoginForm.tsx`, and the login sections of `app/page.tsx`. Same user experience — same phone field, same OTP box, same Google button.
4. Deploy. From this moment: new signups go straight to Cognito. Existing users migrate silently on their next login.
5. Monitor Cognito user count vs. Firebase user count over ~90 days. Most active users will have logged in and migrated.
6. Bulk-import the remaining inactive users using Cognito's `admin-create-user` API from a script that reads Firebase's user list.

**Google users:** migrate cleanly. Both are OAuth to the same Google account — the client asks Cognito for Google sign-in, user re-consents (one tap), done.

**Phone-OTP users:** migrate cleanly. Same phone number, same OTP flow. SMS delivered by SNS instead of Firebase.

**Email/password users:** trickiest. Firebase scrypt hashes must be imported into Cognito's password verifier. Cognito supports this via `UserImportJob` with a hash-parameters file. Since the app has few email/password users (most use phone/Google), this is minor.

**Owner-visible super-admin:** the hardcoded `dixitashutosh007@gmail.com` check in `app/page.tsx` needs to be replaced with a Cognito group (`super-admin`). Add the current admin(s) to that group.

**Exit criteria:**
- New signups go through Cognito.
- Existing users can log in with same credentials and end up as Cognito users.
- Firebase Auth is still authoritative for un-migrated users (via the Lambda trigger).
- No user has been asked to re-register.

**Rollback:** revert the auth code to Firebase; Cognito pool stays but is unused. Users who already migrated still exist in Cognito but their next login re-authenticates against Firebase.

---

### Stage 3 — DynamoDB + AppSync (4–8 weeks, the big one)

The rebuild of the data layer. This is broken into sub-stages so no single change is scary.

#### 3a. Design DynamoDB schema

**Design principle:** multi-table (one table per collection) for readability, on-demand billing. Single-table design not needed at 150 users.

**Table list and keys** (region `ap-south-1`):

| Table | PK | SK | GSIs | Purpose |
|---|---|---|---|---|
| `players` | `id` | — | `authUid-index` (PK: authUid), `mobile-index` (PK: mobile) | Player profile lookup by auth or phone |
| `appUsers` | `id` | — | `email-index` (PK: email) | User settings/roles |
| `matches` | `id` | — | `date-index` (PK: `MATCH#ALL`, SK: date) | Upcoming matches sorted |
| `matchPayments` | `matchId` | `playerId` | `playerId-index` (PK: playerId, SK: createdAt) | Per-match roster, "my payments" |
| `notifications` | `id` | — | `userId-index` (PK: userId, SK: createdAt) | User inbox. **TTL on `expiresAt = createdAt + 90d`.** |
| `razorpayIntents` | `id` | — | `playerId-index` (PK: playerId, SK: createdAt) | Payment history per player |
| `subscriptionHistory` | `id` | — | `playerId-index` (PK: playerId, SK: createdAt) | Studio membership audit |
| `grounds` | `id` | — | — | Small, read all at once |
| `subscriptionPlans` | `id` | — | — | Small |
| `feeTemplates` | `id` | — | — | Small |
| `merchandises` | `id` | — | — | Small |
| `merchOrders` | `id` | — | `playerId-index` (PK: playerId, SK: createdAt) | My orders |
| `outOfPlays` | `id` | — | `playerId-index` (PK: playerId, SK: startDate) | |
| `playerStats` | `playerId` | `year` | — | Composite: one row per player per year |
| `pollResponses` | `id` | — | `pollId-index` (PK: pollId, SK: playerId) | |
| `polls` | `id` | — | — | Small |
| `posts` | `id` | — | `createdAt-index` (PK: `POST#ALL`, SK: createdAt) | Feed sorted newest |
| `postComments` | `postId` | `id` | — | Comments per post |
| `matchComments` | `matchId` | `id` | — | Comments per match |
| `otherFees` | `id` | — | `playerId-index` (PK: playerId, SK: createdAt) | |
| `appConfig` | `id` | — | — | Single doc |

**Notes:**
- The existing `create-dynamodb-tables.sh` creates tables with `_id` as key and no GSIs. **It works for smoke tests but is not the target schema.** Replace it with an Infrastructure-as-Code definition (see 3b).
- `matchPayments` uses composite key (matchId, playerId) so we can query "all payments for this match" cheaply. This is much better than the current Firestore subcollection which requires a collectionGroup query for "my payments across matches" — the GSI on playerId gives us that for free.
- `notifications` needs a TTL attribute (`ttl` = Unix epoch when to delete). Set to `createdAt + 90 days`. DynamoDB deletes for free.

#### 3b. Set up AppSync GraphQL API

AppSync gives us:
- GraphQL queries and mutations (typed API)
- **Real-time subscriptions** — the replacement for Firestore `onSnapshot`. This is the whole reason to use AppSync over raw DynamoDB.
- Cognito integration — auth rules are declarative.

Approach:
1. Define GraphQL schema (`schema.graphql`) with types matching each table.
2. Use Amplify Studio or `sst` / CDK to generate resolvers that map GraphQL operations to DynamoDB operations.
3. Auth rules: e.g. `@auth(rules: [{ allow: owner }, { allow: groups, groups: ["admin"] }])`.
4. Subscriptions: `onCreateMatch`, `onUpdatePayment`, `onCreateNotification`, etc.

#### 3c. Replace `useStore.ts` data layer

The biggest single code change. Current `hooks/useStore.ts` uses Firestore's `onSnapshot` for ~20 collections. Rewrite to use AppSync GraphQL subscriptions via `@aws-amplify/api-graphql`.

Approach: **rewrite `useStore.ts` behind the same public interface**. All the tab components import `useStore` — as long as the hook returns the same shape (players, matches, payments, mutators), the rest of the app doesn't change.

This is where Claude Code earns its keep — it can do this refactor tab-by-tab with the owner testing each.

#### 3d. Data migration script

One Node script, ~200 lines, run once:

1. Read `firestore-backup.json` (produced by `export-firestore.js`).
2. For each collection:
   - Transform documents (fix `_id`/`id`, normalize `subscriptionHistory` schema variants, convert Firestore timestamps to ISO strings, compute TTL on notifications).
   - Batch-write to DynamoDB via `BatchWriteItem` (25 items per call).
3. Special handling for `matches/{id}/payments` subcollection → `matchPayments` table with composite key.
4. **Dry-run mode** that prints counts and sample rows without writing.
5. **Idempotent**: re-running the script produces the same result (uses `PutItem` with `id` as key — overwrites).

Run it in this order:
- Dry-run first. Fix any transformation bugs.
- Real run against a **test** DynamoDB (different table names, e.g. suffixed `-test`).
- App smoke-test against test tables.
- Real run against production DynamoDB.
- Delta migration during the dual-write window (see 3e).

#### 3e. Dual-write cutover

To achieve zero-downtime:

1. Deploy the AWS-DynamoDB version of the app to a preview URL. **Both Firestore and DynamoDB writes happen on every mutation.** Firestore is still authoritative for reads.
2. Run the migration script — DynamoDB now has all historical data plus new writes.
3. Verify parity: script that reads both DBs, diffs each doc, reports mismatches.
4. Flip a feature flag (`READ_FROM = "dynamodb"`) on the preview URL. Reads now come from DynamoDB, writes still go to both.
5. Owner tests thoroughly for 1–3 days.
6. Point production domain at the new deploy. Users are now on DynamoDB.
7. Wait 1 week with dual-write still on, in case of rollback.
8. Turn off Firestore writes. Firebase is now read-only, kept as insurance.
9. Wait 4 weeks with Firebase available as read-only fallback.
10. Firebase project archived.

**Exit criteria:** production reads and writes are on DynamoDB. Firebase project archived. Amplify + Cognito + DynamoDB is the stack.

**Rollback per step:** at any point before step 8, flip the feature flag back and reads return to Firestore instantly. Data written to DynamoDB during the interim needs to be reconciled if rolling back after step 7 — but that window is deliberately short.

---

### Stage 4 — Retire Firebase (1 week)

- Migrate Firebase Storage → S3 with a one-time copy script. Update all `photoURL` fields to new S3 URLs during migration (URL rewriting in the migration script).
- Turn off Firebase Cloud Functions (if any) — none currently in this codebase.
- Cancel Firebase billing.
- Delete the Firebase project once you're satisfied nothing depends on it.

---

## Cognito lazy migration Lambda — sketch

```typescript
// user-migration-trigger.ts
import { signInWithEmailAndPassword } from "firebase/auth";
export const handler = async (event: any) => {
  if (event.triggerSource === "UserMigration_Authentication") {
    // event.userName is the phone or email; event.request.password is the attempted password
    try {
      const firebaseUser = await signInWithEmailAndPassword(
        firebaseAuth,
        event.userName,
        event.request.password,
      );
      event.response.userAttributes = {
        email: firebaseUser.user.email ?? "",
        email_verified: "true",
        phone_number: firebaseUser.user.phoneNumber ?? "",
        "custom:legacy_firebase_uid": firebaseUser.user.uid,
      };
      event.response.finalUserStatus = "CONFIRMED";
      event.response.messageAction = "SUPPRESS";
      return event;
    } catch (e) {
      throw new Error("Bad credentials");
    }
  }
  // Similar branch for UserMigration_ForgotPassword.
  return event;
};
```

Phone-OTP migration is different: SMS goes to SNS from Cognito directly, no Firebase check needed. The Lambda handles email/password only.

---

## Cost estimate (revised with real data)

At **11,381 total docs, 5 MB total data, 150 users**:

| Service | Monthly | Notes |
|---|---:|---|
| Amplify Hosting | $5–15 | Small Next.js SSR |
| Cognito | $0 | 50k MAU free |
| SNS (SMS OTP) | $10–30 | Biggest lever. India routes ~$0.02–0.05/SMS |
| AppSync | $2–5 | ~200k queries/mo + ~50k subscription-minutes |
| DynamoDB | $1–3 | Trivial at this data size |
| S3 | $1–3 | ~10 GB of photos |
| Lambda | $0–2 | Cron reminders + auth trigger |
| CloudFront | $1–5 | Bundled with Amplify |
| SES (optional) | $0–1 | If replacing Resend |
| Route53 | $0.50 | |
| CloudWatch | $0–3 | |
| **Total** | **$25–70/mo** | Dominated by SMS |

Cost-saving: default new signups to Google/email instead of phone-OTP → drops SMS bill to under $5/mo.

---

## Open questions

To confirm with owner before Stage 3 begins:

1. Are `posts`, `matchComments`, `polls`, `otherFees` actually used in production, or empty features? (Confirmed by owner: check the live app.)
2. Do we backfill the 3% of players with missing mandatory fields, or leave them?
3. Do we archive the 8,049 notifications older than 90 days during migration, or import all and let TTL clean up?
4. Retain the ~94% "Not Playing" match-payment default rows, or skip them and generate on-demand?
5. Which Google Cloud account will keep receiving Firebase's monthly bill during the transition? (Should be minimal — Firestore has a generous free tier.)

---

## Glossary for non-devs

- **Amplify** — AWS's "one product to host a web app," equivalent to Vercel or Cloud Run.
- **Cognito** — AWS's user login system. Equivalent to Firebase Auth.
- **DynamoDB** — AWS's database. Equivalent to Firestore, but you have to plan your queries up front.
- **AppSync** — a layer on top of DynamoDB that adds a nice API and, crucially, live updates (subscriptions).
- **GSI (Global Secondary Index)** — an extra way to look up rows in DynamoDB. Firestore does this automatically; DynamoDB needs it declared.
- **Lambda** — AWS's "run a small piece of code on demand." Replaces Next.js API routes.
- **SNS** — the AWS service that sends SMS. Cognito uses it for phone-OTP.
- **S3** — AWS file storage. Replaces Firebase Storage.
- **Secrets Manager** — a safe place to store API keys instead of the database.
- **Lazy migration** — moving users to a new auth system silently as they log in, rather than asking them to re-register.
- **Dual-write** — the app writes every change to both the old and new database at once, so we can switch reads over without losing data.
