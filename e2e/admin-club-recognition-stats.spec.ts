import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "../firebase-applet-config.json";

const SCREENSHOT_DIR = path.resolve(process.cwd(), "docs/qa/screenshots/admin-club-recognition-stats");

const ADMIN_UID = "club-admin-stats-qa";
const ADMIN_EMAIL = "clubadmin.stats@kavachplay.test";
const PLAYER_ID = "player-stats-qa";
const TEST_PASS = "KavachGate!2026";

function getAdminServices() {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Must run against Firebase Auth + Firestore Emulators only.");
  }
  const app = getApps().length ? getApps()[0] : initializeApp({ projectId: firebaseConfig.projectId });
  return {
    adminAuth: getAuth(app),
    adminDb: getFirestore(app),
  };
}

async function signInWithEmail(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /kavach play/i })).toBeVisible({ timeout: 20_000 });

  await page.locator('[data-testid="other-auth-options"]').click();
  await page.locator('[data-testid="email-login-toggle"]').click();
  await page.locator('[data-testid="email-input"]').fill(email);
  await page.locator('[data-testid="password-input"]').fill(password);
  await page.locator('[data-testid="submit-login"]').click();

  await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="submit-login"]')).not.toBeVisible({ timeout: 15_000 });
}

test.describe("Admin Club: Recognition & KAvach Stats E2E (Emulator + Real Auth)", () => {
  test("KAvach Stats CRUD, Club Activity Log, Quick Catch in-flight lock, Desktop + Mobile 360x800", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const { adminAuth, adminDb } = getAdminServices();
    const adminPlayerId = "player-club-admin-stats-qa";
    const statRowId = `${PLAYER_ID}_2026`;
    const createdCatchIds: string[] = [];
    let createdAppConfigDefault = false;
    let createdAuthUser = false;

    try {
      await adminAuth
        .createUser({
          uid: ADMIN_UID,
          email: ADMIN_EMAIL,
          password: TEST_PASS,
          emailVerified: true,
          displayName: "Club Admin Stats QA",
        })
        .catch(async () => {
          await adminAuth.updateUser(ADMIN_UID, { email: ADMIN_EMAIL, password: TEST_PASS, emailVerified: true });
        });
      createdAuthUser = true;

      const appConfigRef = adminDb.collection("appConfig").doc("default");
      const existingAppConfig = await appConfigRef.get();
      if (!existingAppConfig.exists) {
        await appConfigRef.set({
          clubName: "KAVACH CRICKET CLUB",
          features: {
            payments: true,
            studio: true,
            leaderboard: true,
            feed: true,
            matches: true,
            shop: true,
            opinion: true,
          },
        });
        createdAppConfigDefault = true;
      }

      await adminDb.collection("appUsers").doc(ADMIN_UID).set({
        id: ADMIN_UID,
        email: ADMIN_EMAIL,
        name: "Club Admin Stats QA",
        role: "player",
        status: "Active",
        playerId: adminPlayerId,
        isClubAdmin: true,
        isSuperAdmin: false,
        isFinanceAdmin: false,
      });

      await adminDb.collection("players").doc(adminPlayerId).set({
        id: adminPlayerId,
        authUid: ADMIN_UID,
        name: "Club Admin Stats QA",
        mobile: "+919800000101",
        email: ADMIN_EMAIL,
        dob: "1990-01-01",
        locality: "Delhi",
        bloodGroup: "O+",
        emergencyContact: "+919800000102",
        jerseyNumber: "1",
        chestSize: "40",
        battingStyle: "Right-hand bat",
        bowlingStyle: "Right-arm medium",
        disabled: false,
        inviteStatus: "Accepted",
      });

      await adminDb.collection("players").doc(PLAYER_ID).set({
        id: PLAYER_ID,
        name: "Stats QA Player",
        kavachId: "KAV-777",
        mobile: "+919800000777",
        email: "stats.qa@kavachplay.test",
        dob: "1995-03-10",
        locality: "Delhi",
        bloodGroup: "A+",
        emergencyContact: "+919800000778",
        jerseyNumber: "77",
        chestSize: "40",
        battingStyle: "Right-hand bat",
        bowlingStyle: "Right-arm medium",
        disabled: false,
        inviteStatus: "Accepted",
        stunningCatches: 0,
        droppedCatches: 0,
      });

      await page.setViewportSize({ width: 1280, height: 800 });
      await signInWithEmail(page, ADMIN_EMAIL, TEST_PASS);

      // 1. Switch to Admin persona -> Club -> Stats (leaderboard sub-tab)
      await page.locator('[data-testid="header-persona-admin"]').click();
      await page.getByRole("button", { name: /^Club$/i }).first().click();
      await page.locator('[data-testid="club-sub-tab-leaderboard"]').click();

      const statsSection = page.locator('[data-testid="admin-kavach-stats"]');
      await expect(statsSection).toBeVisible({ timeout: 10_000 });

      // Create stat
      await statsSection.locator('[data-testid="kavach-stats-player-select"]').selectOption(PLAYER_ID);
      await statsSection.locator('[data-testid="kavach-stats-year-input"]').fill("2026");
      await statsSection.locator('[data-testid="kavach-stats-runs-input"]').fill("650");
      await statsSection.locator('[data-testid="kavach-stats-wickets-input"]').fill("14");

      const createStatPromise = page.waitForResponse(
        (res) => res.url().includes("/api/admin/player-stats") && res.request().method() === "POST",
      );
      await statsSection.locator('[data-testid="kavach-stats-save-btn"]').click();
      const createRes = await createStatPromise;
      expect(createRes.status()).toBe(200);

      const statRow = statsSection.locator(`[data-testid="kavach-stat-row-${statRowId}"]`);
      await expect(statRow).toBeVisible({ timeout: 10_000 });
      await expect(statRow).toContainText("650 runs · 14 wickets");

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "01-kavach-stats-created-desktop.png"),
      });

      // Edit stat
      await statRow.getByRole("button", { name: /Edit stats for Stats QA Player/i }).click();
      await statsSection.locator('[data-testid="kavach-stats-runs-input"]').fill("720");
      const updateStatPromise = page.waitForResponse(
        (res) => res.url().includes("/api/admin/player-stats") && res.request().method() === "POST",
      );
      await statsSection.locator('[data-testid="kavach-stats-save-btn"]').click();
      expect((await updateStatPromise).status()).toBe(200);
      await expect(statRow).toContainText("720 runs · 14 wickets");

      // Delete stat via 2-step confirmation
      await statRow.getByRole("button", { name: /Delete stats for Stats QA Player/i }).click();
      const delStatPromise = page.waitForResponse(
        (res) => res.url().includes("/api/admin/player-stats") && res.request().method() === "DELETE",
      );
      await statRow.locator(`[data-testid="kavach-stat-confirm-delete-${statRowId}"]`).click();
      expect((await delStatPromise).status()).toBe(200);
      await expect(statRow).toHaveCount(0);

      // 2. Club Admin Activity Log toggle
      const logResPromise = page.waitForResponse(
        (res) => res.url().includes("/api/audit/log") && res.request().method() === "GET",
      );
      await page.locator('[data-testid="club-activity-log-toggle"]').click();
      expect((await logResPromise).status()).toBe(200);
      const logPanel = page.locator('[data-testid="club-activity-log-panel"]');
      await expect(logPanel).toBeVisible();
      await expect(logPanel.getByText(/Stats QA Player/i).first()).toBeVisible({ timeout: 10_000 });

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "02-club-activity-log-desktop.png"),
      });
      await page.locator('[data-testid="club-activity-log-toggle"]').click();

      // 3. Mobile 360 x 800 Club Recognition & Stats check
      await page.setViewportSize({ width: 360, height: 800 });
      await page.locator('[data-testid="club-sub-tab-badges"]').click();
      await expect(page.locator('[data-testid="admin-club-recognition"]')).toBeVisible({ timeout: 10_000 });
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "03-club-recognition-mobile-360x800.png"),
        fullPage: true,
      });

      // 4. Quick Catch modal in-flight lock (Escape & close button blocked while saving)
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByRole("button", { name: /^Home$/i }).first().click();
      await page.getByRole("button", { name: /Record Catch/i }).click();

      const catchModal = page.locator('[data-testid="quick-catch-modal"]');
      await expect(catchModal).toBeVisible({ timeout: 10_000 });
      await catchModal.getByRole("button", { name: "Stunning Catch" }).click();
      await catchModal.locator('input[placeholder="e.g. Practice session"]').fill("Slip catch drill");
      await catchModal.locator("label", { hasText: /Stats QA Player/i }).click();

      // Delay first POST /api/admin/catches by 500ms so we can verify in-flight Escape & close lock
      let delayedOnce = false;
      await page.route("**/api/admin/catches", async (route) => {
        if (route.request().method() === "POST" && !delayedOnce) {
          delayedOnce = true;
          await new Promise((r) => setTimeout(r, 500));
        }
        return route.continue();
      });

      const catchSavePromise = page.waitForResponse(
        (res) => res.url().includes("/api/admin/catches") && res.request().method() === "POST",
      );
      await catchModal.locator('[data-testid="quick-catch-save-btn"]').click();
      await expect(catchModal.locator('[data-testid="quick-catch-close-btn"]')).toBeDisabled();
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "04-quick-catch-inflight-locked.png"),
      });
      await page.keyboard.press("Escape");
      await expect(catchModal).toBeVisible();

      const catchSaveRes = await catchSavePromise;
      expect(catchSaveRes.status()).toBe(200);
      const catchSaveJson = await catchSaveRes.json();
      if (typeof catchSaveJson.id === "string" && catchSaveJson.id) {
        createdCatchIds.push(catchSaveJson.id);
      }
      await expect(catchModal).toBeHidden({ timeout: 10_000 });

      // Verify Firestore catchLog & player total updated
      const catchLogs = await adminDb.collection("catchLog").where("playerId", "==", PLAYER_ID).get();
      expect(catchLogs.size).toBe(1);
      const playerAfter = await adminDb.collection("players").doc(PLAYER_ID).get();
      expect(catchSaveJson.ok).toBe(true);
      expect(playerAfter.data()?.stunningCatches).toBe(1);
    } finally {
      const safeDelete = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
        } catch (err) {
          console.warn("[e2e cleanup warning]", err);
        }
      };

      // Clean up any stat, catch, and audit documents created by this test
      await safeDelete(() => adminDb.collection("playerStats").doc(statRowId).delete());
      for (const catchId of createdCatchIds) {
        await safeDelete(() => adminDb.collection("catchLog").doc(catchId).delete());
      }
      await safeDelete(async () => {
        const catchSnap = await adminDb.collection("catchLog").where("playerId", "==", PLAYER_ID).get();
        await Promise.all(catchSnap.docs.map((d) => d.ref.delete()));
      });
      await safeDelete(async () => {
        const auditSnap = await adminDb.collection("auditLogs").where("actorId", "==", ADMIN_UID).get();
        await Promise.all(auditSnap.docs.map((d) => d.ref.delete()));
      });

      // Clean up test player, admin player, appUsers doc, optional appConfig/default, and Auth user
      await safeDelete(() => adminDb.collection("players").doc(PLAYER_ID).delete());
      await safeDelete(() => adminDb.collection("players").doc(adminPlayerId).delete());
      await safeDelete(() => adminDb.collection("appUsers").doc(ADMIN_UID).delete());
      if (createdAppConfigDefault) {
        await safeDelete(() => adminDb.collection("appConfig").doc("default").delete());
      }
      if (createdAuthUser) {
        await safeDelete(() => adminAuth.deleteUser(ADMIN_UID));
      }
    }
  });
});
