# KAvach Play — Architecture Specification

**Document:** Engineering Handover — System Architecture & Data Architecture  
**Status:** Living Engineering Record (Reconciled & Synchronized)  
**Target Audience:** Implementation Engineers, System Architects, Independent QA / Reviewers  
**Authoritative Code References:** `lib/database-config.ts`, `lib/server-db.ts`, `lib/firebase.ts`, `lib/server-auth.ts`, `lib/player-navigation.ts`, `lib/admin-navigation.ts`, `amplify.yml`  

---

## 1. High-Level System Architecture & Stack

KAvach Play is a modern, mobile-first cricket club operations web platform. It serves active club players, team captains, match managers, finance administrators, and club executives.

```
                           +----------------------------------------+
                           |           Client / Browser             |
                           |   (Mobile Safari, Chrome, Desktop)     |
                           +-------------------+--------------------+
                                               |
                     +-------------------------+-------------------------+
                     | HTTPS (CloudFront / AWS Amplify)                  |
                     v                                                   v
        +----------------------------+                     +----------------------------+
        |   Next.js 15 App Router    |                     |   Direct Client SDK Sync   |
        |   (React 19 RC / SSR / API)|                     |   (Firestore / Auth SDK)   |
        +--------------+-------------+                     +--------------+-------------+
                       |                                                  |
         Server Auth / | Admin SDK                                        | Firestore Rules
         Environment   | Transactions                                     | Validation
         Gating        v                                                  v
        +-------------------------------------------------------------------------------+
        |                 Google Cloud Platform (gen-lang-client-0004191483)            |
        |                                                                               |
        |  +--------------------------+          +-----------------------------------+  |
        |  |  Firebase Authentication |          |  Cloud Firestore (Native Mode)    |  |
        |  |  (Shared Auth Project)   |          |                                   |  |
        |  +--------------------------+          |  [Production]                     |  |
        |                                        |  ai-studio-cae01507-... (us-west1)|  |
        |  +--------------------------+          |                                   |  |
        |  |  Cloud Storage (Media)   |          |  [Development]                    |  |
        |  +--------------------------+          |  kavach-play-db-ext (asia-south1) |  |
        |                                        +-----------------------------------+  |
        +-------------------------------------------------------------------------------+
                       ^
                       | Server-to-Server HMAC
                       v
        +----------------------------+
        |  Razorpay Payment Gateway  |
        |  (Orders & Signed Webhooks)|
        +----------------------------+
```

### Technology Stack Inventory

| Layer | Technology | Pinned Version | Notes & Architectural Rationale |
|---|---|---|---|
| **Framework** | Next.js (App Router) | `15.0.0` | Output standalone configured; React Server Components & API routes |
| **UI Library** | React | `19.0.0-rc-65a56d0e-20241020` | Concurrent features; pinned baseline per Decision D-11 |
| **Language** | TypeScript | `5.9.3` | Strict type checking enabled (`strict: true`; 0 errors in `npx tsc --noEmit`) |
| **Styling** | Tailwind CSS | `4.1.11` | Native CSS custom properties; semantic brand tokens |
| **Icons** | Lucide React | `^0.454.0` | Standard lightweight vector icons |
| **Motion** | Motion (Framer Motion) | `^11.11.11` | Smooth spring transitions and mobile drawer animations |
| **Client Database** | Firebase Web SDK | `^12.13.0` | Real-time snapshots, offline multi-tab persistence |
| **Server Database** | Firebase Admin SDK | `^14.0.0` | Privileged operations, transactions, batch writes, custom claims |
| **Payment Gateway** | Razorpay Node SDK | `^2.9.6` | Server-side order creation, HMAC signature verification |
| **Dates / Times** | date-fns | `^4.4.0` | Strict date manipulation; deterministic `Asia/Kolkata` timezones |
| **Email** | Nodemailer | `^9.0.0` | Server-side transactional notification dispatch |
| **Unit Testing** | Node.js Test Runner | Native (`node:test`) | 1,174 tests across 78 test files in `tests/` |
| **Rules Testing** | `@firebase/rules-unit-testing` | `^6.0.0` | Local Firestore emulator security rule verification |
| **E2E Testing** | Playwright | `^1.62.1` | Mobile-first viewport testing (Pixel 5 & Desktop) |
| **Cloud Hosting** | AWS Amplify Hosting | Web Hosting Gen 2 | Multi-branch build pipeline (`amplify.yml`) |

---

## 2. Multi-Database Isolation & Environment Architecture

A foundational architectural requirement of KAvach Play is **strict physical isolation** between the production database and development environments, while operating within the same GCP project:

- **GCP Project:** `gen-lang-client-0004191483`
- **Shared Auth:** Firebase Authentication is shared across environments. User UIDs exist in the same user pool, but their database documents are completely separated.
- **Production Database:** `ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412` located in `us-west1`.
- **Development Database:** `kavach-play-db-ext` located in `asia-south1`.

### Authoritative Resolution Logic (`lib/database-config.ts`)

Environment resolution is implemented in [lib/database-config.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/database-config.ts) and shared across client and server runtimes without importing Node.js-only SDKs:

1. **Branch Resolution (`resolveDeploymentBranch`):**
   - Inspects `AWS_BRANCH`, `GIT_BRANCH`, and `GITHUB_REF_NAME`.
   - If multiple candidates exist, they must agree; conflicting values cause a fail-closed throw.
2. **Database ID Resolution (`resolveFirestoreDatabaseId`):**
   - Branch `mig-mov` **strictly requires** `kavach-play-db-ext`.
   - Branches `main` and `master` **strictly require** `ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412`.
   - Rejects empty, whitespace-only, malformed, or unrecognized database IDs.
   - **Never falls back to `(default)`** or an unapproved database.
3. **Payment Gating (`arePaymentOperationsEnabled`):**
   - Live Razorpay order creation and webhook mutations are permitted **ONLY** when:
     - Branch is explicitly `main` or `master`.
     - Database ID is strictly the production database ID.
     - `DISABLE_PAYMENT_OPERATIONS !== "true"`.
   - Returns `false` for `mig-mov`, feature branches, previews, and missing branch identities.

### Client Initialization (`lib/firebase.ts`)

On the client, [lib/firebase.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/firebase.ts#L16-L34) calls `resolveFirestoreDatabaseId()`:
```typescript
const dbId = resolveFirestoreDatabaseId();
let _db: Firestore;
try {
  _db = initializeFirestore(app, {
    ...(isEmbedded ? { experimentalForceLongPolling: true } : {}),
    ...(isClient ? { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) } : {}),
  }, dbId);
} catch {
  _db = getFirestore(app, dbId);
}
export const db = _db;
```

### Server Factory (`lib/server-db.ts`)

On the server, [lib/server-db.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/server-db.ts#L82-L104) encapsulates the Admin SDK:
- Calls `resolveFirestoreDatabaseId()` and invokes `firestoreFactory(adminApp, dbId)`.
- In strictly local test environments (`FIRESTORE_EMULATOR_HOST` without AWS markers), uses the emulator default database.
- Provides test injection seams: `setServerDbForTesting(db)` and `setFirestoreFactoryForTesting(factory)`.

---

## 3. Product Navigation Architecture

The navigation architecture implements owner decisions **D-18** (Admin Navigation), **D-19** (Polite Access Denied), and **D-20** (Player Navigation):

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    Player Navigation Architecture (D-20)                   │
│                                                                            │
│  [Top Header]  Logo / Club Name                   [Bell] [Avatar: Profile] │
│                                                                            │
│  [Primary Navigation (Mobile Bottom Bar & Desktop Sidebar)]:               │
│   1. Home                    2. Club                    3. Matches         │
│                                                                            │
│  - Profile opens exclusively from the header avatar.                       │
│  - No More drawer / menu. Secondary screens open contextually.            │
└────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│                    Admin Navigation Architecture (D-18 / D-19)             │
│                                                                            │
│  [Primary Navigation (Mobile Bottom Bar & Desktop Sidebar)]:               │
│   1. Home                                                                  │
│   2. Match Center   (Matches, Grounds, Tournaments)                        │
│   3. Club           (Roster, Studio, Pulse, Stats, Badges, Shop, Invite)   │
│   4. Finance        (Ledger, Plans, Reminders, Activity Log)               │
│   5. Design Studio  (Graphic banners and social templates)                │
│   6. Settings       (Access Control Centre, App Configuration)             │
│                                                                            │
│  - Filtered by active three-role capabilities (D-22).                      │
│  - Unauthorized destinations render polite access-denied screen (D-19).     │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Roles & Access Control Model (D-22)

The active admin role model consists of exactly **three roles**:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                 Active Three-Role Model (D-22 / pure lib)                  │
│                                                                            │
│  1. Super Admin   - Firebase Auth custom claim { admin: true } (SEC-001)   │
│  2. Club Admin    - appUsers.isClubAdmin (absorbs Match, Studio, Designer) │
│  3. Finance Admin - appUsers.isFinanceAdmin                                │
│                                                                            │
│  Retired: Match Admin, Studio Admin, Designer (flags grant NOTHING)        │
│  Sole Role Writer: /api/admin/access (Super Admin only; server-written)    │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Authoritative Data Model & Firestore Collections

```
Firestore Native Database
├── appConfig/{docId}                 (Public app config, branding; secrets forbidden)
├── appUsers/{uid}                    (Account status, auth role, playerId link)
├── players/{playerId}                (Cricket profile, stats, personal details)
│   └── otherFees/{feeId}             (Subcollection: late fees, manual dues, kit fees)
├── matches/{matchId}                 (Fixtures, opponents, dates, grounds, results)
│   ├── payments/{paymentId}          (Subcollection: player fee obligations & receipts)
│   └── comments/{commentId}          (Subcollection: match chat & availability notes)
├── grounds/{groundId}                (Ground directory, maps, organiser contact, fees)
├── tournaments/{tournamentId}        (Tournament management, per-match budgets)
├── merchandises/{merchId}            (Shop catalog, kit items, pricing, sizes)
├── merchOrders/{orderId}             (Orders placed, payments, fulfillment status)
├── polls/{pollId}                    (Club voting & surveys)
├── pollResponses/{responseId}        (Player poll answers)
├── posts/{postId}                    (Club announcements and feed updates)
├── notifications/{notifId}           (User notifications & broadcast announcements)
├── outOfPlays/{docId}                (Player planned absence / unavailability)
├── catchLog/{entryId}                (Pitch-side catches tally & fielding records)
├── circuitStandings/{circuitId}      (Club overall rank and wins/matches per circuit)
├── weekendPrompts/{promptId}         (Scheduled prompt tracking for weekend ops)
├── auditLogs/{logId}                 (Administrative, access-control, and finance audit trail)
├── phoneIndex/{canonicalPhone}       (INTERNAL: Server Admin only; phone reservation)
├── uidIndex/{uid}                    (INTERNAL: Server Admin only; UID reservation)
└── mergeJobs/{jobId}                 (INTERNAL: Server Admin only; merge state machine)
```

---

## 6. Client State Management Architecture

Frontend state is orchestrated via [hooks/useStore.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/hooks/useStore.ts):

### Real-Time Listener Lifecycle (`onSnapshot`)
1. **Core Eager Listeners:** Initialized on auth: `appUsers/{uid}`, `players`, `matches`, `grounds`, `appConfig`.
2. **Lazy Domain Listeners (`lazySubsRef`):** Secondary collections attached on-demand via `ensurePayments()`, `ensurePosts()`, etc., and fully detached on auth teardown to prevent resource leaks.

---

## 7. API Routes Inventory

| Endpoint Route | HTTP Method | Auth Guard | Purpose & Authoritative Logic |
|---|---|---|---|
| `app/api/admin/access` | `GET`, `POST` | `requireSuperAdmin` | Access Control Centre: view role cards/directory/history, grant/revoke active roles. Sole role writer. |
| `app/api/admin/weekend-results` | `GET`, `POST` | `requireClubAdmin` | Weekend match results recording, scorecard links, CricHeroes integration. |
| `app/api/admin/player-of-weekend` | `GET`, `POST` | `requireClubAdmin` | Player of the Weekend (POTW) award, badge generation, Home banner trigger. |
| `app/api/admin/circuit-standings` | `GET`, `PUT`, `DELETE` | `requireClubAdmin` | Manages club overall rank, wins, and matches played per circuit. |
| `app/api/admin/shop` | `GET`, `POST`, `PUT` | `requireClubAdmin` | Club Shop catalog management, order state transitions, facility enable/disable. |
| `app/api/admin/merge-players` | `POST`, `PUT` | `requireClubAdmin` | Multi-stage resumable player merge state machine with worker lease, fencing token, collision checks. |
| `app/api/admin/reconcile-abandoned` | `POST` | `requireFinanceAdmin` | Reconciles abandoned matches under Option A: waives unpaid dues, retains collected cash. |
| `app/api/finance/match-plans` | `GET`, `POST` | `requireFinanceAdmin` / `requireRole` | Evaluates and applies Finance Plans and audited fee overrides to match obligations. |
| `app/api/finance/assignments` | `GET`, `POST` | `requireFinanceAdmin` | Player finance plan assignments and subscription period tracking. |
| `app/api/razorpay/order` | `POST` | `requireAuth` | Derives payable amount server-side; acquires reservation lease; validates B1/B2; creates Razorpay order. |
| `app/api/razorpay/webhook` | `POST` | HMAC Header | Verifies `x-razorpay-signature` using timing-safe buffer compare. Processes payment intent atomically. |
| `app/api/player/link-account` | `POST` | `requireAuth` | Atomically links Firebase Auth account to player profile; claims unique phone/UID reservations. |
| `app/api/email/send` | `POST` | `requireAuth` | Dispatches transactional emails via Nodemailer with strict schema validation. |
| `app/api/whatsapp/send` | `POST` | `requireAuth` | Dispatches WhatsApp notifications to players. |
| `app/api/calendar/sync` | `GET` | Public / Token | Generates iCal subscription feed for club match schedule. |

---

## 8. Hosting & Deployment Architecture (AWS Amplify)

Configured via [amplify.yml](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/amplify.yml):
- Inlines `NEXT_PUBLIC_FIRESTORE_DATABASE_ID="kavach-play-db-ext"` on branch `mig-mov`.
- Inlines production database ID on branch `main`.
- Generates standalone output via `scripts/prepare-standalone.mjs`.
