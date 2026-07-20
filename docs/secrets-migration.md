# Secrets moved out of `appConfig`

Previously these secrets were stored inside the `appConfig/default` Firestore document, which is publicly readable (needed for club name/logo/theme on the login page). Anyone with the app's Firebase config could read them from a browser console.

They've been moved to server-side environment variables. Nothing reads them from Firestore any more.

## The 4 secrets now living in env

| Env var | Was in appConfig field | Used by |
|---|---|---|
| `RESEND_API_KEY` | `resendApiKey` | `/api/email/send` (Resend provider) |
| `SMTP_PASSWORD` | `smtpPassword` | `/api/email/send` (SMTP provider) |
| `WHATSAPP_ACCESS_TOKEN` | `whatsappAccessToken` | `/api/whatsapp/*` |
| `RAZORPAY_KEY_SECRET` | `razorpayKeySecret` (never actually read from DB) | `/api/razorpay/*` |

`razorpayKeySecret` was already using the env var in code — but a value in the DB from an old Settings save could still leak. The purge script removes it.

## What you need to do

### 1. Add missing env vars to Amplify

Amplify Console → your app → Hosting → **Environment variables**. Add whichever of these you use:

- `SMTP_PASSWORD` (only if you use SMTP)
- `WHATSAPP_ACCESS_TOKEN` (only if you use WhatsApp reminders)
- `RESEND_API_KEY` and `RAZORPAY_KEY_SECRET` should already exist.

Copy the current values from Firestore before doing the purge below.

### 2. Deploy the new Firestore rules

The rules now reject any appConfig write that includes a secret field. Deploy them:

```
firebase deploy --only firestore:rules --project gen-lang-client-0004191483
```

### 3. Purge secrets from the current DB

Run this against **both** databases (production and sandbox):

```
node scripts/purge-appconfig-secrets.js ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412 --dry-run
node scripts/purge-appconfig-secrets.js ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412

node scripts/purge-appconfig-secrets.js kavach-play-db-ext --dry-run
node scripts/purge-appconfig-secrets.js kavach-play-db-ext
```

The dry-run first shows what would be removed with masked values. The real run deletes them.

### 4. Verify

- Open Firestore Console → appConfig/default → the four fields should be gone.
- Open the app → Settings → the password/token inputs now show an "env var" placeholder instead of an editable field.
- Send a test email or trigger a WhatsApp reminder — should still work because the server reads env vars.

## Rollback (just in case)

If email/WhatsApp break because an env var wasn't set:
- Set the env var in Amplify and redeploy. Server picks it up immediately.
- Do NOT re-add secrets to appConfig — the rules will reject the write.
