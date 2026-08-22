# E2E Tests (Playwright)

## Setup

```bash
# Install (skip browser download — Chromium is pre-installed in CI)
npm install -D @playwright/test

# For local dev, install browsers:
npx playwright install chromium
```

## Running Tests

```bash
# Run all tests
npm test

# Run with visible browser
npm run test:headed

# Run specific test file
npx playwright test e2e/login.spec.ts

# View HTML report after a run
npm run test:report
```

## Environment Variables

For admin-level tests (player management, match fees, finance):

```bash
export ADMIN_EMAIL="your-admin@email.com"
export ADMIN_PASSWORD="your-admin-password"
```

Tests that require admin access will skip automatically if these aren't set.

## Test Structure

| File | What it tests |
|------|--------------|
| `app-loading.spec.ts` | Performance, no console errors, no FOUC |
| `login.spec.ts` | Login screen UI, auth flows |
| `registration.spec.ts` | Duplicate prevention, admin add-player |
| `match-fees.spec.ts` | Fee assignment, rejected players excluded |
| `finance.spec.ts` | Dues visibility, merged player dues |
| `navigation.spec.ts` | Tab navigation, lazy loading works |

## Adding New Tests

1. Create `e2e/your-feature.spec.ts`
2. Use helpers from `e2e/helpers/auth.ts` for sign-in
3. Run `npx playwright test e2e/your-feature.spec.ts --headed` to debug

## CI Integration

Add to your GitHub Actions / Amplify build:

```yaml
- name: Run E2E Tests
  env:
    ADMIN_EMAIL: ${{ secrets.TEST_ADMIN_EMAIL }}
    ADMIN_PASSWORD: ${{ secrets.TEST_ADMIN_PASSWORD }}
  run: npm test
```
