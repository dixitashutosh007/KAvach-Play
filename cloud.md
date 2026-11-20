# KAvach Play — Cloud Environment and Data Operations

Last updated: 2026-11-20

This document records the known Firebase/GCP environment boundaries and the November 20, 2026 development database refresh. It is an operational reference, not authorization to perform cloud actions.

## 1. Google Cloud project and Firestore databases

GCP project ID:
`gen-lang-client-0004191483`

| Environment | Branch | Firestore database ID | Location |
|---|---|---|---|
| Production | `main` | `ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412` | `us-west1` |
| Development | `mig-mov` | `kavach-play-db-ext` | `asia-south1` |

The databases are separate Firestore Native databases in the same Google Cloud project. Both were Enterprise edition at the time of the November 20 refresh.

Firebase Authentication is intentionally shared in this Firebase project. Firestore documents are environment-separated. Copying Firestore user documents does not create, delete, or synchronize Firebase Authentication identities.

## 2. Mandatory environment isolation

- `mig-mov` must resolve to `kavach-play-db-ext`.
- `main` / `master` must resolve to the production database ID.
- Branch/database resolution must fail closed when branch identity is expected but unavailable.
- Never allow a development build to silently fall back to production.
- Never use production data as a write target for development.
- Keep Razorpay/payment operations disabled on `mig-mov`.
- Do not change Amplify environment variables, Firebase configuration, branch mappings, IAM, secrets, or payment settings without explicit approval.

The application previously had a server-side database selection abstraction and branch-aware resolution. Historical audits found a branch resolver intended to enforce this mapping and an Amplify branch override for `mig-mov`. Re-inspect current code and Amplify configuration before relying on those findings.

## 3. Firebase configuration and rules

At the November 20, 2026 review, the `mig-mov` branch's root `firebase.json` contained:

```json
{
  "firestore": [
    {
      "database": "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412",
      "rules": "firestore.rules"
    },
    {
      "database": "kavach-play-db-ext",
      "rules": "firestore.rules"
    }
  ],
  "emulators": {
    "firestore": {
      "port": 8080
    },
    "ui": {
      "enabled": false
    }
  }
}
```

Both database entries referenced the same `firestore.rules` source file.

On November 20, 2026, the rules were deployed successfully to the development database only, using the explicit Firebase CLI target:
`firebase deploy --only firestore:kavach-play-db-ext --project=gen-lang-client-0004191483`

The dry-run and deployment both reported successful compilation. The compiler emitted warnings:
- `isVerified` is unused.
- `isValidPlayer` is unused.
- The unused `isVerified` function body generated warnings for `request`, `exists`, and `get`.

Those warnings did not block deployment. The rules were not fully security-audited as part of the database refresh. In particular, an unused helper does not enforce any access control. Review actual active rule paths before changing or relying on these helpers.

**Deployment safeguards:**
- Never run `firebase deploy --only firestore` casually: the configuration lists both production and development databases.
- Never omit the explicit database target for a Firestore rules deployment.
- Before any rules deployment, inspect the current branch, `firebase.json`, rules diff, project ID, and exact target.
- Use a dry-run first.
- Obtain explicit owner approval before deploying rules or indexes.
- A successful rules compile is not equivalent to a security review.

No root `firestore.indexes.json` was found during the November 20 review. Before the development database was recreated, production and development were compared and both had only default field indexes and no custom composite indexes/field overrides. Recheck live index configuration before any future migration or index change.

## 4. November 20, 2026 development database refresh

The owner explicitly approved replacing the development Firestore database with an exact mirror of the November 18 production snapshot.

### Source snapshot and restore

- Snapshot time: `2026-11-18T14:32:16.153075Z`
- Backup ID: `4c084d0d-1d38-4d48-b383-8629827f9b0f`
- Temporary restore database: `kavach-prod-restore-nov18-20261120`
- Restore region: `us-west1`
- Restore operation completed successfully.

An earlier November 13 restore database named `kavach-prod-restore-20261120` was also retained as a fallback. Do not delete temporary restore databases without explicit approval.

### Production export

Export source database:
`kavach-prod-restore-nov18-20261120`

Export location:
`gs://ai-studio-bucket-796390269544-us-west1/kavach-refresh/prod-2026-11-18`

Export operation completed successfully. Reported source document count:
`41,715`

Export was copied to the cross-region backup bucket:
`gs://kavach_play_db_backups/kavach-refresh/prod-2026-11-18`

The destination was verified to contain the seven expected export files. Do not overwrite or delete this export.

### Development pre-refresh backup

Before deleting the old development database, it was exported to:
`gs://kavach_play_db_backups/kavach-refresh/dev-before-prod-refresh-2026-11-20`

The export completed successfully and reported 5,189 documents. The backup is retained. Do not delete it without explicit approval.

### Development database recreation

The owner explicitly approved deleting and recreating only `kavach-play-db-ext` after confirming no `mig-mov` application traffic was active.

The recreated database was verified with:
- Database ID: `kavach-play-db-ext`
- Location: `asia-south1`
- Type: `FIRESTORE_NATIVE`
- Edition: `ENTERPRISE`
- Concurrency mode: `OPTIMISTIC`
- Firestore Data Access Mode enabled
- Realtime Updates enabled
- PITR disabled
- Delete Protection disabled
- App Engine integration disabled

These are the observed settings at recreation time, not a guarantee that settings remain unchanged forever.

### Import

Source:
`gs://kavach_play_db_backups/kavach-refresh/prod-2026-11-18`

Destination:
`kavach-play-db-ext`

Import operation:
`AiBlZGQwNWFkN2IyNjQtZDVkYi03YjE0LTExMmQtZGM5MjgwOTUkGnNlbmlsZXBpcAkKMxI`

Status: `SUCCESSFUL`

- Started: `2026-11-20T11:17:25.836574Z`
- Completed: `2026-11-20T11:21:30.647388Z`
- Documents completed: `41,715 / 41,715`
- No operation error was reported.

### Post-import checks completed

A read-only `listCollectionIds` comparison showed that the production restore and development database had the same 22 top-level collection IDs:

`appConfig`, `appUsers`, `auditLogs`, `badges`, `catchLog`, `clubLeads`, `feePlans`, `feeTemplates`, `grounds`, `matches`, `merchOrders`, `merchandises`, `notifications`, `outOfPlays`, `playerStats`, `players`, `pollResponses`, `posts`, `razorpayIntents`, `subscriptionHistory`, `subscriptionPlans`, `tournaments`.

A subsequent collection document-count script incorrectly used the Firestore REST endpoint `/documents/{collection}:list`. Its output showed zero for every collection, but those results are invalid and must be discarded. A corrected read-only script using `GET /documents/{collection}` with pagination was supplied. Its output has not yet been confirmed in the project handover.

Therefore:
- The import operation's 41,715 completed document count is confirmed.
- The matching 22 collection IDs are confirmed.
- Per-collection source-vs-target count equality is **not yet independently verified**.
- Full document-level equality has not been verified.
- Do not describe the databases as byte-for-byte identical.

## 5. Cloud resources and backup retention

Known storage resources:
- Original production export bucket: `ai-studio-bucket-796390269544-us-west1` (US-WEST1).
- Cross-region backup bucket: `kavach_play_db_backups` (ASIA-SOUTH1).

Known retained paths:
- `gs://kavach_play_db_backups/kavach-refresh/prod-2026-11-18`
- `gs://kavach_play_db_backups/kavach-refresh/dev-before-prod-refresh-2026-11-20`
- `gs://ai-studio-bucket-796390269544-us-west1/kavach-refresh/prod-2026-11-18`

Firestore export/import does not copy Firebase Storage objects. Historical code review found no meaningful Firebase Storage usage and profile avatars were external URLs, but verify current implementation before any future storage migration.

Do not delete exports, backups, restore databases, buckets, or objects as cleanup without explicit owner approval.

## 6. Operational safety rules

Before any cloud operation:
1. State whether it is read-only, additive, mutating, or destructive.
2. Identify exact GCP project, database/bucket/resource, and region.
3. Verify the target from command arguments and current configuration.
4. Explain production impact and rollback/recovery considerations.
5. Obtain explicit approval for writes, deployment, imports, exports, restores, deletion, or configuration changes.
6. Give the owner one step at a time when they are executing commands in Cloud Shell.
7. Inspect the returned operation ID/status and independently verify the outcome.

Never:
- Execute cloud operations on the owner's behalf.
- Modify production data or configuration.
- Run a bulk delete, database delete, import, restore, or overwrite without explicit approval.
- Start the app or tests against production.
- expose credentials, service-account JSON, tokens, or secrets in chat or repository files.
- assume that a successful CLI command means an asynchronous operation has completed.

The owner runs cloud commands in Cloud Shell and shares output for review. Do not ask the owner to paste secret values.

## 7. Current known state at handover

As of November 20, 2026:
- Production Firestore database was not modified by the refresh.
- Development database was recreated and populated from the November 18 production snapshot.
- Development rules deployment succeeded.
- Import operation completed successfully with 41,715 documents.
- Top-level collection IDs match across restore and development.
- Corrected per-collection document-count verification remains pending.
- No application testing or CI was run as part of the database refresh.
- Firebase Auth remains shared.
- Razorpay operations must remain disabled on `mig-mov`.

Always re-verify live state before relying on this historical snapshot.
