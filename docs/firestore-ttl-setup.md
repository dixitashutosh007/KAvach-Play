# Enabling the Firestore TTL policy on `notifications`

The app now writes an `expiresAt` Timestamp on every notification (createdAt + 90 days). Firestore will auto-delete expired docs — free, no code — once the TTL policy is turned on. This is a one-time setup per database.

## Do this once per Firestore database

Do it for **both** the production database (`ai-studio-cae01507-...`) and the sandbox (`kavach-play-db-ext`).

### Option A — Google Cloud Console (easiest for non-devs)

1. Open the Google Cloud Console for your project:
   https://console.cloud.google.com/firestore/databases?project=gen-lang-client-0004191483
2. Click the database you want to configure.
3. Left sidebar → **Time-to-live (TTL)**.
4. Click **Create policy**.
5. Fill in:
   - **Collection group:** `notifications`
   - **Timestamp field:** `expiresAt`
6. Click **Create**.
7. Repeat for the other database.

Firestore may take a few hours to build the index and start deleting old docs. There's no cost. Deletions happen in the background.

### Option B — gcloud CLI

```
gcloud firestore fields ttls update expiresAt \
  --collection-group=notifications \
  --enable-ttl \
  --database=ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412 \
  --project=gen-lang-client-0004191483

gcloud firestore fields ttls update expiresAt \
  --collection-group=notifications \
  --enable-ttl \
  --database=kavach-play-db-ext \
  --project=gen-lang-client-0004191483
```

## Backfill: purge old docs that don't have `expiresAt`

Existing notifications (created before this change) don't have the `expiresAt` field, so the TTL policy will never delete them. Two options:

**A. Leave them alone.** They'll sit in the DB forever. Not great, but they don't affect real-time perf now that notifications are paginated.

**B. One-time backfill script.** Add `expiresAt = createdAt + 90 days` to every existing doc; anything already older than 90 days will be deleted almost immediately by the TTL policy. Small script — ask me to write it when ready.

## Verifying it worked

After ~24 hours, GCP Console → Firestore → Usage. The `notifications` document count should slowly decrease as old docs get deleted.
