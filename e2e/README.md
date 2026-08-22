# E2E Tests (Playwright)

## Setup

```bash
# Install dependencies
npm install -D @playwright/test

# Install browsers (local dev only)
npx playwright install chromium
```

## Running Tests

```bash
# Run against local dev server (starts automatically)
npx playwright test

# Run against deployed staging/production
BASE_URL="https://your-app.amplifyapp.com" npx playwright test

# Run with visible browser
npx playwright test --headed

# Run specific test file
npx playwright test e2e/login.spec.ts

# View HTML report after a run
npx playwright show-report
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `BASE_URL` | Target URL (defaults to `http://localhost:3000`) |
| `ADMIN_EMAIL` | Email/password admin account for authenticated tests |
| `ADMIN_PASSWORD` | Password for the admin account |

Tests that require admin access will skip automatically if creds aren't set.

### Creating a Test Admin Account

1. Go to Firebase Console -> Authentication -> Add user
2. Create an email/password user (e.g. `test-admin@yourclub.com`)
3. In Firestore, set `appUsers/{uid}.role` to `"admin"`
4. Use those credentials as `ADMIN_EMAIL` / `ADMIN_PASSWORD`

## Test Structure

| File | What it tests | Admin needed? |
|------|--------------|:---:|
| `app-loading.spec.ts` | Performance, no console errors, no FOUC | No |
| `login.spec.ts` | Login screen UI, auth flow navigation | No |
| `registration.spec.ts` | Duplicate prevention, admin add-player | Yes |
| `match-fees.spec.ts` | Fee assignment, rejected players excluded | Yes |
| `finance.spec.ts` | Dues visibility, merged player dues | Yes |
| `navigation.spec.ts` | Tab navigation, lazy loading works | Yes |

## Adding New Tests

1. Create `e2e/your-feature.spec.ts`
2. Use helpers from `e2e/helpers/auth.ts` for sign-in
3. Run `npx playwright test e2e/your-feature.spec.ts --headed` to debug

## CI Integration

```yaml
- name: Run E2E Tests
  env:
    BASE_URL: ${{ vars.STAGING_URL }}
    ADMIN_EMAIL: ${{ secrets.TEST_ADMIN_EMAIL }}
    ADMIN_PASSWORD: ${{ secrets.TEST_ADMIN_PASSWORD }}
  run: npx playwright test
```
