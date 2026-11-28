import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "../firebase-applet-config.json";

const SCREENSHOT_DIR = path.resolve(process.cwd(), "docs/qa/screenshots/badges-release-gate");
const EVIDENCE_FILE = path.resolve(process.cwd(), "docs/qa/BADGES_2.0_RELEASE_GATE_EVIDENCE.json");

const ADMIN_UID = "club-admin-gate";
const ADMIN_EMAIL = "clubadmin.gate@kavachplay.test";
const PLAYER_UID = "player-release-gate-uid";
const PLAYER_EMAIL = "player.gate@kavachplay.test";
const PLAYER_ID = "player-release-gate";
const TEST_PASS = "KavachGate!2026";

function getAdminServices() {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Release gate must run against Firebase Auth + Firestore Emulators only.");
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

  const otherAuthBtn = page.locator('[data-testid="other-auth-options"]');
  await expect(otherAuthBtn).toBeVisible({ timeout: 10_000 });
  await otherAuthBtn.click();

  const emailToggle = page.locator('[data-testid="email-login-toggle"]');
  await expect(emailToggle).toBeVisible({ timeout: 5_000 });
  await emailToggle.click();

  await page.locator('[data-testid="email-input"]').fill(email);
  await page.locator('[data-testid="password-input"]').fill(password);
  await page.locator('[data-testid="submit-login"]').click();

  await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="submit-login"]')).not.toBeVisible({ timeout: 15_000 });
}

test.describe("Badges 2.0 Final Release Gate (Emulator + Real Auth + Real API)", () => {
  test("Full end-to-end release gate: grant, API, Firestore, audit, player collection, duplicate reject, retry, cleanup", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const { adminAuth, adminDb } = getAdminServices();

    // Seed non-production emulator accounts and player records
    await adminAuth.createUser({
      uid: ADMIN_UID,
      email: ADMIN_EMAIL,
      password: TEST_PASS,
      emailVerified: true,
      displayName: "Club Admin Gate",
    }).catch(async () => {
      await adminAuth.updateUser(ADMIN_UID, { email: ADMIN_EMAIL, password: TEST_PASS, emailVerified: true });
    });

    await adminAuth.createUser({
      uid: PLAYER_UID,
      email: PLAYER_EMAIL,
      password: TEST_PASS,
      emailVerified: true,
      displayName: "Release Gate Player",
    }).catch(async () => {
      await adminAuth.updateUser(PLAYER_UID, { email: PLAYER_EMAIL, password: TEST_PASS, emailVerified: true });
    });

    await adminDb.collection("appConfig").doc("default").set({
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

    await adminDb.collection("appUsers").doc(ADMIN_UID).set({
      id: ADMIN_UID,
      email: ADMIN_EMAIL,
      name: "Club Admin Gate",
      role: "player",
      status: "Active",
      playerId: "player-club-admin-gate",
      isClubAdmin: true,
      isSuperAdmin: false,
      isFinanceAdmin: false,
    });

    await adminDb.collection("players").doc("player-club-admin-gate").set({
      id: "player-club-admin-gate",
      authUid: ADMIN_UID,
      name: "Club Admin Gate",
      mobile: "+919800000001",
      email: ADMIN_EMAIL,
      dob: "1990-01-01",
      locality: "Delhi",
      bloodGroup: "O+",
      emergencyContact: "+919800000002",
      jerseyNumber: "1",
      chestSize: "40",
      battingStyle: "Right-hand bat",
      bowlingStyle: "Right-arm medium",
      disabled: false,
      inviteStatus: "Accepted",
    });

    await adminDb.collection("appUsers").doc(PLAYER_UID).set({
      id: PLAYER_UID,
      email: PLAYER_EMAIL,
      name: "Release Gate Player",
      mobile: "+919800000099",
      dob: "1996-05-15",
      locality: "South Delhi",
      bloodGroup: "B+",
      emergencyContact: "+919800000098",
      chestSize: "40",
      jerseyNumber: "99",
      battingStyle: "Right-hand bat",
      bowlingStyle: "Right-arm offbreak",
      role: "player",
      status: "Active",
      playerId: PLAYER_ID,
      isClubAdmin: false,
    });

    await adminDb.collection("players").doc(PLAYER_ID).set({
      id: PLAYER_ID,
      authUid: PLAYER_UID,
      name: "Release Gate Player",
      mobile: "+919800000099",
      email: PLAYER_EMAIL,
      dob: "1996-05-15",
      locality: "South Delhi",
      bloodGroup: "B+",
      emergencyContact: "+919800000098",
      jerseyNumber: "99",
      chestSize: "40",
      battingStyle: "Right-hand bat",
      bowlingStyle: "Right-arm offbreak",
      disabled: false,
      inviteStatus: "Accepted",
      totalRuns: 150,
      totalWickets: 4,
    });

    const evidence: Record<string, unknown> = {};

    // 1. Sign in as real authenticated Club Admin test account
    await page.setViewportSize({ width: 1280, height: 800 });
    await signInWithEmail(page, ADMIN_EMAIL, TEST_PASS);

    // Switch to Admin persona -> Club -> Badges -> Grant
    await page.locator('[data-testid="header-persona-admin"]').click();
    await page.getByRole("button", { name: /^Club$/i }).first().click();
    await page.locator('[data-testid="club-sub-tab-badges"]').click();
    await page.getByRole("button", { name: /^Grant$/i }).click();
    await expect(page.getByText("Grant a Badge")).toBeVisible({ timeout: 10_000 });

    // Select Release Gate Player and non-stackable badge "1 Year with KAvach" (year_1)
    await page.getByRole("button", { name: /Release Gate Player/i }).click();
    await page.getByRole("button", { name: /1 Year with KAvach/i }).click();

    let capturedGrantReqHeaders: Record<string, string> = {};
    let capturedGrantBody: unknown = null;
    const grantResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/admin/badges") && res.request().method() === "POST",
    );
    page.on("request", (req) => {
      if (req.url().includes("/api/admin/badges") && req.method() === "POST") {
        capturedGrantReqHeaders = req.headers();
        capturedGrantBody = req.postDataJSON();
      }
    });

    await page.getByRole("button", { name: /Award 1 Year with KAvach to 1 player/i }).click();

    // 2. Verify successful API response
    const grantRes = await grantResponsePromise;
    const grantStatus = grantRes.status();
    const grantJson = await grantRes.json();
    expect(grantStatus).toBe(200);
    expect(typeof grantJson.id).toBe("string");
    expect(grantJson.id.length).toBeGreaterThan(0);
    evidence.grantApiResponse = { status: grantStatus, body: grantJson };

    const outcome = page.locator('[data-testid="badge-award-outcome"]');
    await expect(outcome.getByText(/Succeeded \(1\)/i)).toBeVisible({ timeout: 10_000 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "01-admin-grant-success.png"),
    });

    // 3. Verify the award in Firestore
    const badgeDocId = grantJson.id;
    const badgeSnap = await adminDb.collection("badges").doc(badgeDocId).get();
    expect(badgeSnap.exists).toBe(true);
    const badgeData = badgeSnap.data();
    expect(badgeData?.playerId).toBe(PLAYER_ID);
    expect(badgeData?.badgeType).toBe("year_1");
    expect(badgeData?.awardedBy).toBe(ADMIN_UID);
    evidence.firestoreBadgeDoc = { id: badgeSnap.id, data: badgeData };

    // 4. Verify exactly one corresponding audit record
    const auditSnap = await adminDb
      .collection("auditLogs")
      .where("entityId", "==", badgeDocId)
      .get();
    expect(auditSnap.size).toBe(1);
    const auditData = auditSnap.docs[0].data();
    expect(auditData.actorId).toBe(ADMIN_UID);
    expect(auditData.action).toBe("created");
    evidence.firestoreAuditDocs = {
      count: auditSnap.size,
      id: auditSnap.docs[0].id,
      data: auditData,
    };

    // 6. Attempt a duplicate grant (using the real authenticated Club Admin Bearer token) and verify HTTP 409 rejection
    const authHeader = capturedGrantReqHeaders["authorization"] || capturedGrantReqHeaders["Authorization"];
    expect(authHeader).toBeTruthy();
    const dupRes = await page.request.post("http://localhost:3000/api/admin/badges", {
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      data: {
        target: "badge",
        badge: {
          ...(typeof capturedGrantBody === "object" && capturedGrantBody !== null ? (capturedGrantBody as any).badge : {}),
          id: "dup-attempt-id",
          playerId: PLAYER_ID,
          badgeType: "year_1",
        },
        idempotencyKey: `dup-gate-${Date.now()}`,
      },
    });
    const dupStatus = dupRes.status();
    const dupJson = await dupRes.json();
    expect(dupStatus).toBe(409);
    evidence.duplicateGrantResponse = { status: dupStatus, body: dupJson };

    // Confirm Firestore still has exactly 1 badge and 1 audit record
    const auditAfterDup = await adminDb.collection("auditLogs").where("entityId", "==", badgeDocId).get();
    expect(auditAfterDup.size).toBe(1);

    // 7. Verify a failed award can be retried without duplication
    // Intercept ONLY the 1st POST for "original" with HTTP 500, then unroute for the retry
    let interceptedFirst = false;
    await page.route("**/api/admin/badges", async (route) => {
      if (route.request().method() === "POST" && !interceptedFirst) {
        interceptedFirst = true;
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Simulated transient 500 before retry" }),
        });
      }
      return route.continue();
    });

    // Re-select Release Gate Player (handleAward clears selection on full success)
    await page.getByRole("button", { name: /Release Gate Player/i }).click();
    await page.getByRole("button", { name: /KAvach Original/i }).click();
    await page.getByRole("button", { name: /Award KAvach Original to 1 player/i }).click();

    await expect(outcome.getByText(/Failed \(1\):/i)).toBeVisible({ timeout: 10_000 });
    const retryBtn = outcome.getByRole("button", { name: /Retry Failed \(1\)/i });
    await expect(retryBtn).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "02-admin-grant-failed-before-retry.png"),
    });

    const retryResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/admin/badges") && res.request().method() === "POST",
    );
    await retryBtn.click();
    const retryRes = await retryResponsePromise;
    const retryStatus = retryRes.status();
    const retryJson = await retryRes.json();
    expect(retryStatus).toBe(200);
    await expect(outcome.getByText(/Succeeded \(1\)/i)).toBeVisible({ timeout: 10_000 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "03-admin-grant-retry-succeeded.png"),
    });

    const originalBadgeId = retryJson.id;
    expect(typeof originalBadgeId).toBe("string");
    const originalBadgesSnap = await adminDb
      .collection("badges")
      .where("playerId", "==", PLAYER_ID)
      .where("badgeType", "==", "original")
      .get();
    expect(originalBadgesSnap.size).toBe(1);
    const originalAuditSnap = await adminDb
      .collection("auditLogs")
      .where("entityId", "==", originalBadgeId)
      .get();
    expect(originalAuditSnap.size).toBe(1);
    evidence.retryGrantVerification = {
      retryStatus,
      retryBody: retryJson,
      badgeCount: originalBadgesSnap.size,
      auditCount: originalAuditSnap.size,
    };

    // 5. Sign out and sign in as the test player to verify the badge appears in the player's collection
    await page.getByRole("button", { name: /Sign out of application/i }).click();
    await signInWithEmail(page, PLAYER_EMAIL, TEST_PASS);

    await page.locator('[data-testid="header-profile-avatar"]').click();
    await expect(page.locator('[data-testid="profile-badges-all"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="profile-badges-all"]').click();

    const collection = page.locator('[data-testid="player-badge-collection"]');
    await expect(collection).toBeVisible({ timeout: 10_000 });
    const earnedSection = page.locator('[data-testid="badges-earned-section"]');
    await expect(earnedSection.getByText(/1 Year with KAvach/i)).toBeVisible();
    await expect(earnedSection.getByText(/KAvach Original/i)).toBeVisible();

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "04-player-collection-verified.png"),
      fullPage: true,
    });

    // Cleanup test player, awarded badges, and test accounts
    await adminDb.collection("badges").doc(badgeDocId).delete();
    await adminDb.collection("badges").doc(originalBadgeId).delete();
    await adminDb.collection("players").doc(PLAYER_ID).delete();
    await adminDb.collection("appUsers").doc(PLAYER_UID).delete();
    await adminAuth.deleteUser(PLAYER_UID);

    const remainingPlayer = await adminDb.collection("players").doc(PLAYER_ID).get();
    const remainingBadges = await adminDb.collection("badges").where("playerId", "==", PLAYER_ID).get();
    expect(remainingPlayer.exists).toBe(false);
    expect(remainingBadges.size).toBe(0);
    evidence.cleanup = {
      playerExistsAfterDelete: remainingPlayer.exists,
      badgesCountAfterDelete: remainingBadges.size,
    };

    fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(evidence, null, 2));
  });
});
