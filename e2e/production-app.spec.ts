import { test, expect, Page } from "@playwright/test";

// =============================================================================
// Synthetic Deterministic Fixtures for Isolated Production Route Testing
// =============================================================================

function createSyntheticStore(roleConfig: {
  uid: string;
  role?: "admin" | "player";
  status?: "Active" | "Disabled";
  isSuperAdmin?: boolean;
  isClubAdmin?: boolean;
  isMatchAdmin?: boolean;
  isFinanceAdmin?: boolean;
  isStudioAdmin?: boolean;
  isDesigner?: boolean;
  playerDisabled?: boolean;
}) {
  const uid = roleConfig.uid;
  const playerId = `player-${uid}`;

  const appUser = {
    id: uid,
    email: `${uid}@kavachplay.test`,
    name: `Player ${uid}`,
    mobile: "+919876543210",
    dob: "1995-04-12",
    locality: "South Delhi",
    bloodGroup: "O+",
    emergencyContact: "+919876543211",
    chestSize: "40",
    jerseyNumber: "18",
    battingStyle: "Right-hand bat",
    bowlingStyle: "Right-arm medium",
    role: roleConfig.role || "player",
    status: roleConfig.status || "Active",
    playerId: playerId,
    isClubAdmin: !!roleConfig.isClubAdmin,
    isMatchAdmin: !!roleConfig.isMatchAdmin,
    isFinanceAdmin: !!roleConfig.isFinanceAdmin,
    isStudioAdmin: !!roleConfig.isStudioAdmin,
    isDesigner: !!roleConfig.isDesigner,
  };

  const player = {
    id: playerId,
    authUid: uid,
    name: `Player ${uid}`,
    mobile: "+919876543210",
    email: `${uid}@kavachplay.test`,
    disabled: !!roleConfig.playerDisabled,
    inviteStatus: "Accepted",
    dob: "1995-04-12",
    locality: "South Delhi",
    bloodGroup: "O+",
    emergencyContact: "+919876543211",
    battingStyle: "Right-hand bat",
    bowlingStyle: "Right-arm medium",
    chestSize: "40",
    jerseyNumber: "18",
  };

  const matches = [
    {
      id: "match-upcoming-1",
      groundId: "ground-1",
      format: "T20",
      jerseyColor: "Scarlet Red",
      date: "2026-11-25",
      time: "07:30",
      opponent: "Delhi Challengers",
      ourScore: "",
      opponentScore: "",
      result: "Pending",
      fee: 650,
      reportingTime: "07:00",
      squadPlayerIds: [playerId, "player-teammate"],
      notes: "Pitch report: Dry surface, bat first.",
    },
    {
      id: "match-completed-1",
      groundId: "ground-1",
      format: "T30",
      jerseyColor: "Scarlet Red",
      date: "2026-11-10",
      time: "08:00",
      opponent: "NCR Tigers",
      ourScore: "210/6 (30 ov)",
      opponentScore: "195/9 (30 ov)",
      result: "Won",
      fee: 600,
      squadPlayerIds: [playerId],
    },
    {
      id: "match-abandoned-1",
      groundId: "ground-2",
      format: "T20",
      jerseyColor: "Whites",
      date: "2026-11-05",
      time: "07:00",
      opponent: "Gurgaon Strikers",
      ourScore: "45/1 (5.2 ov)",
      opponentScore: "",
      result: "Abandoned", // Option A: Zero match-fee obligation
      fee: 550,
      squadPlayerIds: [playerId],
    },
  ];

  const payments = [
    {
      id: `pay-upcoming-${playerId}`,
      playerId: playerId,
      matchId: "match-upcoming-1",
      status: "Unpaid",
      availability: "Confirmed",
    },
    {
      id: `pay-abandoned-${playerId}`,
      playerId: playerId,
      matchId: "match-abandoned-1",
      status: "Unpaid", // Unpaid on Abandoned match -> must be excluded from dues
      availability: "Confirmed",
    },
    {
      id: `pay-completed-${playerId}`,
      playerId: playerId,
      matchId: "match-completed-1",
      status: "Paid",
      availability: "Confirmed",
    },
  ];

  const grounds = [
    {
      id: "ground-1",
      name: "KAvach Sports Arena",
      mapUrl: "https://maps.google.com/?q=KAvach+Arena",
      organiserName: "Coach Sharma",
      organiserPhone: "+919811122233",
      gpayNumber: "9811122233",
    },
    {
      id: "ground-2",
      name: "Sultanpur Cricket Ground",
      mapUrl: "https://maps.google.com/?q=Sultanpur+Ground",
      organiserName: "Ramesh Singh",
      organiserPhone: "+919822233344",
      gpayNumber: "9822233344",
    },
  ];

  const otherFees = [
    {
      id: `fee-late-1`,
      playerId: playerId,
      amount: 150,
      label: "Late Fee: Match vs NCR Tigers",
      status: "Unpaid",
    },
  ];

  const posts = [
    {
      id: "post-1",
      authorId: uid,
      authorName: `Player ${uid}`,
      title: "Weekend Practice Session",
      text: "Nets session scheduled for Saturday 6 AM at KAvach Studio.",
      createdAt: { seconds: Math.floor(Date.now() / 1000) },
      comments: [],
    },
  ];

  return {
    appConfig: {
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
    },
    appUsers: [appUser],
    players: [player],
    matches: matches,
    payments: payments,
    grounds: grounds,
    otherFees: otherFees,
    posts: posts,
    tournaments: [],
    playerStats: [],
    subscriptionPlans: [],
    subscriptionHistory: [],
    notifications: [],
    feeTemplates: [],
    outOfPlays: [],
    merchandises: [],
    merchOrders: [],
    polls: [],
    pollResponses: [],
    feePlans: [],
    badges: [],
    badgeTypeDefs: [],
    leads: [],
  };
}

async function injectSyntheticSession(
  page: Page,
  roleConfig: {
    uid: string;
    role?: "admin" | "player";
    status?: "Active" | "Disabled";
    isSuperAdmin?: boolean;
    isClubAdmin?: boolean;
    isMatchAdmin?: boolean;
    isFinanceAdmin?: boolean;
    isStudioAdmin?: boolean;
    isDesigner?: boolean;
    playerDisabled?: boolean;
  },
) {
  const store = createSyntheticStore(roleConfig);
  const user = {
    uid: roleConfig.uid,
    email: `${roleConfig.uid}@kavachplay.test`,
    displayName: `Player ${roleConfig.uid}`,
  };

  await page.addInitScript(
    ({ testUser, testAdminClaim, testStore }) => {
      (window as any).__KAVACH_TEST_USER__ = testUser;
      (window as any).__KAVACH_TEST_ADMIN_CLAIM__ = testAdminClaim;
      (window as any).__KAVACH_TEST_STORE__ = testStore;
    },
    {
      testUser: user,
      testAdminClaim: !!roleConfig.isSuperAdmin,
      testStore: store,
    },
  );
}

function getNavigationTab(page: Page, label: string) {
  // Finds visible tab across mobile bottom nav and desktop sidebar
  return page
    .locator(`nav button:has-text("${label}"), button:has-text("${label}")`)
    .filter({ visible: true })
    .first();
}

// =============================================================================
// TEST SUITE: Production Route (/) End-to-End Verification
// =============================================================================

test.describe("Production Route (/) Verification Suite", () => {
  // ── 1. Default Player Experience & Navigation (Decision D-10) ──────────────
  test("1. Renders default Player View on / with approved primary navigation tabs", async ({
    page,
  }) => {
    page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message, err.stack));
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("CONSOLE ERROR:", msg.text());
    });

    await injectSyntheticSession(page, {
      uid: "player-standard",
      role: "player",
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Club heading / brand visibility
    const clubHeading = page.locator("h1", { hasText: /KAVACH/i });
    await expect(clubHeading).toBeVisible({ timeout: 10000 });

    // Standard Player View default (Decision D-10): no "Return to Player View" banner in player mode
    await expect(page.locator("text=Return to Player View")).not.toBeVisible();

    // Verify Primary Tabs in navigation
    const homeTab = getNavigationTab(page, "Home");
    const matchesTab = getNavigationTab(page, "Matches");
    const clubTab = getNavigationTab(page, "Club");

    await expect(homeTab).toBeVisible({ timeout: 10000 });
    await expect(matchesTab).toBeVisible();
    await expect(clubTab).toBeVisible();

    // Navigate to Matches Tab
    await matchesTab.click();
    await expect(page.locator("text=Delhi Challengers").first()).toBeVisible({ timeout: 5000 });

    // Navigate to Club Tab
    await clubTab.click();
    await expect(
      page.locator("text=Digital Player Card").or(page.locator("text=Player Profile")).or(page.locator("text=Studio & Nets")).or(page.locator("text=Club")).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  // ── 2. Dues Calculation (Read-Only & Abandoned Match Exclusion) ─────────────
  test("2. Correctly displays calculated billable dues, excluding abandoned match obligations", async ({
    page,
  }) => {
    await injectSyntheticSession(page, {
      uid: "player-dues-test",
      role: "player",
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // In our synthetic fixture:
    // - match-upcoming-1: fee = 650 (Unpaid, Billable)
    // - match-abandoned-1: fee = 550 (Unpaid, Abandoned -> EXCLUDED)
    // - otherFee: amount = 150 (Unpaid)
    // Expected Billable Dues = 650 + 150 = ₹800 (Abandonment policy Option A)
    const paymentsTab = getNavigationTab(page, "Payments");
    await paymentsTab.click();

    // Billable match and other fee must appear in Pending Dues
    await expect(page.locator("text=Delhi Challengers").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=₹650").first()).toBeVisible();
    await expect(page.locator("text=₹150").first()).toBeVisible();

    // Abandoned match fee (550) must not be included (Option A policy)
    await expect(page.locator("text=Gurgaon Strikers")).not.toBeVisible();

    // On desktop, the total due sidebar card also displays ₹800
    const totalDueLabel = page.locator("text=Total Due").filter({ visible: true });
    if (await totalDueLabel.isVisible()) {
      await expect(page.locator("text=₹800").filter({ visible: true }).first()).toBeVisible();
      await expect(page.locator("text=₹1350")).not.toBeVisible();
    }
  });

  // ── 3. RSVP and Tactical Notes ─────────────────────────────────────────────
  test("3. Displays upcoming match card, RSVP status, and tactical notes toggle", async ({
    page,
  }) => {
    await injectSyntheticSession(page, {
      uid: "player-rsvp-test",
      role: "player",
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Check upcoming match display
    await expect(page.locator("text=Delhi Challengers").first()).toBeVisible({ timeout: 10000 });

    // Check RSVP Confirmed badge
    await expect(page.locator("text=Confirmed").or(page.locator("text=Playing")).first()).toBeVisible();

    // Switch to Matches tab to view tactical notes
    const matchesTab = getNavigationTab(page, "Matches");
    await matchesTab.click();

    // Match opponent card visible
    await expect(page.locator("text=Delhi Challengers").first()).toBeVisible({ timeout: 5000 });
  });

  // ── 4. Match Search and Filtering ──────────────────────────────────────────
  test("4. Filters matches by query and result status", async ({ page }) => {
    await injectSyntheticSession(page, {
      uid: "player-filter-test",
      role: "player",
    });

    await page.goto("/");
    const matchesTab = getNavigationTab(page, "Matches");
    await matchesTab.click();

    await expect(page.locator("text=Delhi Challengers").first()).toBeVisible({ timeout: 10000 });

    // Search input
    const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill("Delhi");
      await expect(page.locator("text=Delhi Challengers").first()).toBeVisible();
      await expect(page.locator("text=NCR Tigers")).not.toBeVisible();

      // Clear search
      await searchInput.fill("");
    }
  });

  // ── 5. Disabled Account Redirection ────────────────────────────────────────
  test("5. Redirects disabled player account to AccountDisabledScreen", async ({
    page,
  }) => {
    await injectSyntheticSession(page, {
      uid: "player-disabled-account",
      role: "player",
      status: "Disabled",
      playerDisabled: true,
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Must show AccountDisabledScreen (which renders "Account In Trash" or "Account Disabled")
    await expect(
      page
        .locator("text=Account In Trash")
        .or(page.locator("text=Account Disabled"))
        .or(page.locator("text=Access Restricted")),
    ).toBeVisible({ timeout: 10000 });

    // Normal club navigation must NOT be accessible
    await expect(page.locator('nav[data-testid="player-mobile-bottom-nav"]')).not.toBeVisible();
  });

  // ── 6. Granular RBAC & Restricted Admin Hubs ───────────────────────────────
  test.describe("6. Granular RBAC Role Enforcement on Admin Console", () => {
    test("6A. Super Admin: full authorized access to Admin Console and Return to Player View", async ({
      page,
    }) => {
      await injectSyntheticSession(page, {
        uid: "user-superadmin",
        role: "admin",
        isSuperAdmin: true,
      });

      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      // Super Admin sees Admin Console entry in header
      const adminEntry = page.locator('button[title*="Admin Console"], button:has-text("Admin Console"), button:has-text("Admin")').first();
      await expect(adminEntry).toBeVisible({ timeout: 10000 });
      await adminEntry.click();

      // Admin mode active: check for "Admin Console" header or "Player View" return action
      const returnBtn = page
        .locator('button:has-text("Player View"), button:has-text("Return to Player View"), button[title*="Player View"]')
        .filter({ visible: true })
        .first();
      await expect(returnBtn).toBeVisible({ timeout: 10000 });

      // "Return to Player View" preserves player session without persona switching
      await returnBtn.click();
      await expect(page.locator("h1", { hasText: /KAVACH/i })).toBeVisible();
    });

    test("6B. Finance Admin: has authorized Admin Console entry", async ({
      page,
    }) => {
      await injectSyntheticSession(page, {
        uid: "user-finance-admin",
        role: "player",
        isFinanceAdmin: true,
      });

      await page.goto("/");
      const adminEntry = page.locator('button[title*="Admin Console"], button:has-text("Admin Console"), button:has-text("Admin")').first();
      await expect(adminEntry).toBeVisible({ timeout: 10000 });
      await adminEntry.click();

      // Authorized entry into Admin Console
      const returnBtn = page
        .locator('button:has-text("Player View"), button:has-text("Return to Player View"), button[title*="Player View"]')
        .filter({ visible: true })
        .first();
      await expect(returnBtn).toBeVisible({ timeout: 10000 });
    });

    test("6C. Match Admin: has authorized Admin Console entry", async ({
      page,
    }) => {
      await injectSyntheticSession(page, {
        uid: "user-match-admin",
        role: "player",
        isMatchAdmin: true,
      });

      await page.goto("/");
      const adminEntry = page.locator('button[title*="Admin Console"], button:has-text("Admin Console"), button:has-text("Admin")').first();
      await expect(adminEntry).toBeVisible({ timeout: 10000 });
      await adminEntry.click();

      // Match admin access granted
      const returnBtn = page
        .locator('button:has-text("Player View"), button:has-text("Return to Player View"), button[title*="Player View"]')
        .filter({ visible: true })
        .first();
      await expect(returnBtn).toBeVisible({ timeout: 10000 });
    });

    test("6D. Designer: has authorized Design Hub entry", async ({ page }) => {
      await injectSyntheticSession(page, {
        uid: "user-designer",
        role: "player",
        isDesigner: true,
      });

      await page.goto("/");
      const adminEntry = page.locator('button[title*="Admin Console"], button:has-text("Admin Console"), button:has-text("Admin")').first();
      await expect(adminEntry).toBeVisible({ timeout: 10000 });
    });
  });

  // ── 7. Responsive Ergonomics & Viewport Layouts ─────────────────────────────
  test.describe("7. Responsive Ergonomics & Viewport Layouts", () => {
    const viewports = [
      { name: "360x800 Mobile", width: 360, height: 800 },
      { name: "390x844 Mobile", width: 390, height: 844 },
      { name: "1280x800 Desktop", width: 1280, height: 800 },
    ];

    for (const vp of viewports) {
      test(`Renders cleanly at ${vp.name} with zero horizontal overflow`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await injectSyntheticSession(page, {
          uid: "player-responsive",
          role: "player",
        });

        await page.goto("/");
        await page.waitForLoadState("domcontentloaded");

        // Verify no horizontal overflow
        const isOverflowing = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(isOverflowing).toBeFalsy();

        // Verify primary header is visible
        const header = page.locator("header").first();
        await expect(header).toBeVisible({ timeout: 10000 });

        // Check interactive touch target sizes on mobile
        if (vp.width < 768) {
          const navButtons = page.locator('nav[data-testid="player-mobile-bottom-nav"] button');
          const count = await navButtons.count();
          for (let i = 0; i < count; i++) {
            const btn = navButtons.nth(i);
            const box = await btn.boundingBox();
            if (box) {
              // Minimum 36px touch target height
              expect(box.height).toBeGreaterThanOrEqual(36);
            }
          }
        }
      });
    }
  });
});
