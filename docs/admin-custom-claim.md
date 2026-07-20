# Super-admin identity via Firebase Auth custom claim

The hardcoded `dixitashutosh007@gmail.com` check that used to grant super-admin has been replaced with a Firebase Auth **custom claim**. This is server-set metadata that travels in the user's ID token, checked from both the client and Firestore security rules — non-tamperable from the browser.

## One-time setup

Run this once per super-admin. Requires `serviceAccountKey.json` in the repo root.

```
node scripts/set-admin-claim.js dixitashutosh007@gmail.com
```

Output should show `Current claims: {"admin": true}`.

Then **the user must sign out and sign back in** for the new token to reach the browser. There's no other way — Firebase Auth caches tokens for up to 1 hour.

## To revoke

```
node scripts/set-admin-claim.js dixitashutosh007@gmail.com --revoke
```

## To grant admin to someone new

```
node scripts/set-admin-claim.js new-admin@example.com
```

They sign out/in, and they're now super-admin.

## Fallback still works

For safety during the transition, `appUsers.role === "admin"` is still honored in both the code and firestore.rules. So existing admins keep working even before you run the script. Once every admin also has the claim, we can drop the appUsers-based branch and be claim-only.

## What the claim unlocks

- Client: `useAuth().hasAdminClaim === true`
- Firestore rules: `request.auth.token.admin == true`
- Fully bypasses the email check, so admin identity can change without a code change.
