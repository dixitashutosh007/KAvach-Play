# KAvach Play — Production Admin Migration & Rollout Plan

**Date:** 2026-11-17  
**Phase:** 1 (SEC-001 Remediation)  
**Governing Standard:** [AGENTS.md](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/AGENTS.md)

> [!IMPORTANT]
> **Zero Production Mutations During Automated Remediation:**  
> Per AGENTS.md Section 3 Rule 2 and Rule 3, no migration or claim modifications may be executed against the production Firebase project during AI development. This runbook is strictly for product owner execution during scheduled production deployment.

---

## 1. Migration Overview

To eliminate SEC-001 privilege escalation, super-administrative privileges are transitioned from mutable Firestore document fields (`appUsers/{uid}.role == 'admin'`) to immutable Firebase Authentication Custom Claims (`{ admin: true }`).

### Rollout Order
1. **Pre-Deployment:** Audit existing administrator accounts and establish the approved UID allowlist.
2. **Claim Provisioning:** Issue cryptographic custom claims to approved super-administrators.
3. **Application & Rules Deployment:** Deploy updated Next.js application and Firestore Security Rules.
4. **Post-Deployment Validation:** Verify admin operations and forced client token refresh.

---

## 2. Step-by-Step Production Runbook

### Step 1: Pre-Migration Discovery & Audit
Run the read-only audit report against production:
```bash
# Ensure production serviceAccountKey.json is staged in project root (git-ignored)
node scripts/migrate-admin-claims.js --report
```
*Expected Output:*
- Lists all `appUsers` records with `role === 'admin'` or `isSuperAdmin === true`.
- Displays current custom claim status for each user.
- Flags unapproved accounts.

### Step 2: Establish Approved Super-Admin Allowlist
Review the audit output with the product owner and populate `config/admin-allowlist.json`:
```json
[
  "AUTHORIZED_FIREBASE_UID_1",
  "AUTHORIZED_FIREBASE_UID_2"
]
```

### Step 3: Execute Custom Claim Provisioning
Execute claim assignment strictly against allowlisted UIDs:
```bash
node scripts/migrate-admin-claims.js --execute
```
*Verification:*
- Re-run `node scripts/migrate-admin-claims.js --report` to confirm all allowlisted accounts now show `Claim: { admin: true }`.

### Step 4: Deploy Firestore Security Rules & Application Code
Deploy the hardened rules and application build:
```bash
firebase deploy --only firestore:rules
npm run build
# Deploy to production hosting / Vercel
```

### Step 5: Post-Deployment Verification
1. Sign in as an authorized super-admin.
2. Confirm the Admin Console renders and admin operations succeed (e.g. settings updates, match creations).
3. If token caching delays claim detection (Firebase tokens cache claims for up to 60 minutes), sign out and sign back in, or invoke `auth.currentUser.getIdToken(true)` in the browser console.
4. Confirm non-admin users cannot see or execute administrative actions.

---

## 3. Rollback & Contingency Plan

If any critical operational lockout occurs during deployment:
1. Individual admin accounts can be immediately provisioned via CLI:
   ```bash
   node scripts/set-admin-claim.js <emergency-admin-email>
   ```
2. Claims take effect immediately on next token refresh (`auth.currentUser.getIdToken(true)`).
3. Do NOT revert `firestore.rules` to trust client-writable `appUsers.role`.
