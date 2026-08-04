# Per-branch Firestore database isolation on Amplify

Goal: `main` branch talks to the production database (`ai-studio-cae01507-...`), `mig-mov` branch talks to the sandbox (`kavach-play-db-ext`). Same GitHub repo, same Amplify app, different data.

This is done entirely through Amplify Console — **no code changes**. The mechanism is already in the code (`lib/firebase.ts` and all `/api/*/route.ts` files read `NEXT_PUBLIC_FIRESTORE_DATABASE_ID` and fall back to the hardcoded production ID when unset).

## One-time setup (10 minutes)

### 1. Amplify Console → your app → Hosting → Environment variables

You'll see a table of variables. For each variable that varies per branch, Amplify supports **branch overrides** — the variable is defined at the app level, then a specific branch gets its own value.

### 2. Add / update `NEXT_PUBLIC_FIRESTORE_DATABASE_ID`

Two possible states you might be in:

**State A (currently):** the variable exists at the app level with the sandbox value `kavach-play-db-ext`. Both branches inherit sandbox. Bad — if `main` builds, prod users hit sandbox data.

**State B (target):**
- **App-level default:** unset (or set to the production ID `ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412` for explicit clarity).
- **Branch override on `mig-mov`:** `NEXT_PUBLIC_FIRESTORE_DATABASE_ID = kavach-play-db-ext`.
- No override on `main` → falls through to app-level default → production.

To flip from A to B:
1. Edit the app-level `NEXT_PUBLIC_FIRESTORE_DATABASE_ID` value to `ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412` (or delete it).
2. Click **Actions → Add variable override** or the ⋯ menu next to the row → **Manage variables for branch** → pick `mig-mov` → set `NEXT_PUBLIC_FIRESTORE_DATABASE_ID = kavach-play-db-ext`.
3. Save.

### 3. Redeploy both branches

Env var changes only take effect on the next build (Next.js inlines `NEXT_PUBLIC_*` vars at build time). Trigger a fresh build on each branch:
- Amplify Console → your app → the branch card → **Redeploy this version**.
- Do `mig-mov` first (verify sandbox still connects), then `main` (verify it now points at prod).

## Verification

After each redeploy, on the corresponding preview URL open the browser DevTools Console. You'll see:

```
[Firestore] Using database: <id>
```

*(That line was removed in commit 568e608 — see below for adding a one-off debug endpoint instead if you want a permanent check.)*

Alternative permanent check — the debug endpoint we shipped earlier at `/api/debug/db-id` was removed for hygiene. If you want a permanent lightweight check without the log line, add a `<meta>` tag in `app/layout.tsx` that reads `process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID` (safe to expose — it's not a secret). Then view-source on any page shows which DB the deploy is targeting.

## Decisive test

The one that matters: edit the same match's opponent name on both URLs and confirm the change stays confined to the respective DB.
- On `main` branch URL: change match opponent → check Cloud Run URL (still pointing at prod) — should also show the change.
- On `mig-mov` branch URL: change match opponent → check `main` branch URL — should NOT show the change.

## Environment variables that stay the same on both branches

These are safe to define once at app level (no per-branch override needed):

- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET`
- `NEXT_PUBLIC_RAZORPAY_KEY_ID`
- `RESEND_API_KEY`
- `FIREBASE_SERVICE_ACCOUNT_KEY`
- `SMTP_PASSWORD`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`
- `WHATSAPP_ACCESS_TOKEN`
- `API_SECRET`, `REPORT_API_SECRET`
- `APP_URL`

**Caveat on Razorpay:** if you want a separate Razorpay test key on the `mig-mov` sandbox (so accidental payment tests don't hit real money), override `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `NEXT_PUBLIC_RAZORPAY_KEY_ID` on the `mig-mov` branch to your Razorpay test-mode credentials. Do the same for `RAZORPAY_WEBHOOK_SECRET` if you register a test webhook.

## What to do if you fumble it

Symptoms and fixes:
- **Sandbox writes appearing in production data:** `mig-mov` branch missing its override, or a build ran before the override was saved. Set the override, redeploy `mig-mov`, verify the console log.
- **`main` build shows sandbox data:** app-level default is still `kavach-play-db-ext`. Change it to the production ID and redeploy `main`.
- **App can't connect to any DB:** typo in the env var name (it's `NEXT_PUBLIC_FIRESTORE_DATABASE_ID` exactly). Amplify env vars are case-sensitive.

## Why this over a code-level guard

We considered a startup check that inspects the current branch (via `AWS_BRANCH` env Amplify injects) and refuses to boot if the DB id doesn't match the expected branch. Not doing this because:

1. Amplify Console env-var overrides are already the standard mechanism.
2. A code-level guard adds a moving part that can itself break the build.
3. It makes the code branch-aware, which couples the codebase to Amplify.

If you later want that extra safety, the change is small: read `process.env.AWS_BRANCH` in `lib/firebase.ts` and assert it matches an expected DB id map.
