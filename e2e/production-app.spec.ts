import { test, expect, Page } from "@playwright/test";

// =============================================================================
// Deterministic Synthetic Fixtures (Strictly Non-Production)
// =============================================================================

const FIXED_TEST_TIMESTAMP = 1764000000; // Fixed deterministic timestamp: 2025-11-24T16:00:00.000Z

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
      result: "Abandoned", // Option A policy: Zero match-fee obligation
      fee: 550,
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
      status: "Unpaid", // Unpaid on Abandoned match -> MUST be excluded from dues
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
      createdAt: { seconds: FIXED_TEST_TIMESTAMP },
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
  const pattern = label === "Payments" || label === "Finance" ? /(Payments|Finance)/i : new RegExp(label, "i");
  return page
    .locator("nav button, button")
    .filter({ hasText: pattern })
    .filter({ visible: true })
    .first();
}

// =============================================================================
// TEST SUITE: Hardened Production Route (/) End-to-End Verification
// =============================================================================

test.describe("Production Route (/) Verification Suite", () => {
  // ── 1. Default Player Experience & Navigation (Decision D-10) ──────────────
  test("1. Renders default Player View on / with approved primary navigation tabs", async ({
    page,
  }) => {
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
      page
        .locator("text=Digital Player Card")
        .or(page.locator("text=Player Profile"))
        .or(page.locator("text=Studio & Nets"))
        .or(page.locator("text=Club"))
        .first(),
    ).toBeVisible({ timeout: 5000 });
  });

  // ── 2. Dues Calculation (Mandatory Assertions & Abandoned Match Exclusion) ──
  test("2. Correctly displays calculated billable dues, excluding abandoned match obligations", async ({
    page,
  }) => {
    await injectSyntheticSession(page, {
      uid: "player-dues-test",
      role: "player",
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 1. Mandatory Home Tab Dues Card assertion
    // - match-upcoming-1: fee = 650 (Unpaid, Billable)
    // - match-abandoned-1: fee = 550 (Unpaid, Abandoned -> MUST BE EXCLUDED)
    // - otherFee: amount = 150 (Unpaid)
    // Expected Total Due = 650 + 150 = ₹800 (Abandonment policy Option A)
    const duesCard = page.locator("section:has-text('Outstanding Club Dues')").first();
    await expect(duesCard).toBeVisible({ timeout: 10000 });
    await expect(duesCard.locator("text=/2 pending obligations?/i")).toBeVisible();
    await expect(duesCard.locator("text=₹800")).toBeVisible();

    // Abandoned match obligation (₹550) must NOT be included (total must not be ₹1,350)
    await expect(page.locator("text=₹1,350")).not.toBeVisible();
    await expect(page.locator("text=₹1350")).not.toBeVisible();

    // 2. Mandatory Payments Tab Line-Item assertion
    const paymentsTab = getNavigationTab(page, "Payments");
    await paymentsTab.click();

    // Billable match fee (₹650) and late fee (₹150) must appear in pending dues
    await expect(page.locator("text=Delhi Challengers").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=₹650").first()).toBeVisible();
    await expect(page.locator("text=₹150").first()).toBeVisible();

    // Abandoned match (Gurgaon Strikers) must NOT appear in pending dues
    await expect(page.locator("text=Gurgaon Strikers")).not.toBeVisible();
  });

  // ── 3. RSVP and Tactical Notes (Mandatory Interactive Toggle) ───────────────
  test("3. Displays upcoming match card, RSVP status, and interacts with tactical notes toggle", async ({
    page,
  }) => {
    await injectSyntheticSession(page, {
      uid: "player-rsvp-test",
      role: "player",
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Verify upcoming fixture and RSVP badge
    await expect(page.locator("text=Delhi Challengers").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Confirmed").or(page.locator("text=Playing")).first()).toBeVisible();

    // Tactical Notes Interactive Toggle Verification / Modern 1-Tap RSVP Controls
    const addNoteButton = page.locator('button:has-text("+ Add Note for Captain"), button:has-text("Add Note")').first();
    if (await addNoteButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      expect(await addNoteButton.getAttribute("aria-expanded")).toBe("false");

      const noteInput = page.locator('input[aria-label="Tactical note for captain"]');
      await expect(noteInput).not.toBeVisible();

      // Click toggle button to open tactical note input
      await addNoteButton.click();
      await expect(noteInput).toBeVisible({ timeout: 5000 });

      const hideButton = page.locator('button:has-text("Hide Note")').first();
      await expect(hideButton).toBeVisible();
      expect(await hideButton.getAttribute("aria-expanded")).toBe("true");

      // Enter tactical note text
      await noteInput.fill("Available for opening bowling spell");
      await expect(noteInput).toHaveValue("Available for opening bowling spell");

      // Click toggle button again to hide tactical note input
      await hideButton.click();
      await expect(noteInput).not.toBeVisible();
      await expect(addNoteButton).toBeVisible();
      expect(await addNoteButton.getAttribute("aria-expanded")).toBe("false");
    } else {
      // Three-position availability selector
      const playingBtn = page.locator('[role="radio"][aria-label="Mark availability as Playing"]').first();
      await expect(playingBtn).toBeVisible({ timeout: 5000 });
      expect(await playingBtn.getAttribute("aria-checked")).toBe("true");
    }
  });

  // ── 4. Match Search and Filtering (Mandatory Non-Conditional Assertions) ────
  test("4. Filters matches by query and result status with mandatory search input assertion", async ({
    page,
  }) => {
    await injectSyntheticSession(page, {
      uid: "player-filter-test",
      role: "player",
    });

    await page.goto("/");
    const matchesTab = getNavigationTab(page, "Matches");
    await matchesTab.click();

    // Mandatory Search Input Assertion
    const searchInput = page.locator('input[aria-label="Search matches by opponent or venue"], input[placeholder*="Search opponent"]').first();
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Both matches initially rendered
    await expect(page.locator("text=Delhi Challengers").first()).toBeVisible();
    await expect(page.locator("text=NCR Tigers").first()).toBeVisible();

    // Search for "Delhi"
    await searchInput.fill("Delhi");
    await expect(page.locator("text=Delhi Challengers").first()).toBeVisible();
    await expect(page.locator("text=NCR Tigers")).not.toBeVisible();

    // Clear search
    await searchInput.fill("");
    await expect(page.locator("text=Delhi Challengers").first()).toBeVisible();
    await expect(page.locator("text=NCR Tigers").first()).toBeVisible();
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

  // ── 6. Complete 7-Role x 7-Hub Granular RBAC Authorization Matrix ───────────
  test.describe("6. Complete 7-Role x 7-Hub Granular RBAC Authorization Matrix", () => {
    const ALL_7_HUBS = [
      { tab: "home", name: "Overview", rejectionMsg: "Your administrative role does not grant access to the Overview hub." },
      { tab: "matches", name: "Match Centre", rejectionMsg: "You do not have Match Admin permissions for Match Centre management." },
      { tab: "club", name: "Player Roster", rejectionMsg: "You do not have Club Admin permissions for Player Roster management." },
      { tab: "finance", name: "Finance & Dues", rejectionMsg: "You do not have Finance Admin permissions for Finance & Dues operations." },
      { tab: "studio", name: "Studio & Nets", rejectionMsg: "You do not have Studio Admin permissions for Studio & Nets management." },
      { tab: "design", name: "Club Operations", rejectionMsg: "You do not have Designer permissions for Design Studio." },
      { tab: "settings", name: "Settings & Access", rejectionMsg: "Only Super Admins may access Settings & Access." },
    ] as const;

    // Helper to evaluate a role across all 7 hubs
    async function verifyHubAccessMatrix(
      page: Page,
      authorizedTabs: Set<string>,
    ) {
      for (const hub of ALL_7_HUBS) {
        // Direct navigation attempt via non-production navigation hook
        await page.evaluate((t) => (window as any).__KAVACH_NAVIGATE_TAB__?.(t), hub.tab);
        await page.waitForTimeout(50);

        if (authorizedTabs.has(hub.tab)) {
          // Positive Authorization: Hub Restricted card MUST NOT be visible
          await expect(
            page.locator("text=Hub Restricted"),
            `Hub '${hub.name}' (${hub.tab}) should be authorized but displayed Hub Restricted`,
          ).not.toBeVisible();

          // Specific positive component / heading assertions per hub
          if (hub.tab === "home") {
            await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible({ timeout: 5000 });
          } else if (hub.tab === "matches") {
            await expect(page.getByRole("heading", { name: "Match Schedule" })).toBeVisible({ timeout: 5000 });
            await expect(page.locator('button:has-text("Add Match")').first()).toBeVisible();
          } else if (hub.tab === "club") {
            await expect(page.locator('[data-testid="club-sub-tabs"]')).toBeVisible({ timeout: 5000 });
            await expect(page.locator('[data-testid="club-sub-tab-players"]')).toBeVisible();
          } else if (hub.tab === "finance") {
            await expect(page.getByRole("heading", { name: "Match Fee Accounting" })).toBeVisible({ timeout: 5000 });
            await expect(page.locator('button:has-text("Match Fees")').first()).toBeVisible();
          } else if (hub.tab === "studio") {
            await expect(page.locator('[data-testid="studio-tabs"]')).toBeVisible({ timeout: 5000 });
            await expect(page.locator('[data-testid="studio-crm-tab"]')).toBeVisible();
          } else if (hub.tab === "design") {
            await expect(page.getByRole("heading", { name: "KAvach Design" })).toBeVisible({ timeout: 5000 });
            await expect(page.locator('button:has-text("Match / POTM")').first()).toBeVisible();
          } else if (hub.tab === "settings") {
            await expect(page.getByRole("heading", { name: "Admin Settings" })).toBeVisible({ timeout: 5000 });
            await expect(page.locator("text=App Configuration").first()).toBeVisible();
          }
        } else {
          // Negative Authorization: Hub Restricted card MUST be visible with exact error message
          await expect(
            page.locator("text=Hub Restricted"),
            `Hub '${hub.name}' (${hub.tab}) should be restricted but Hub Restricted card was missing`,
          ).toBeVisible({ timeout: 5000 });

          await expect(
            page.locator(`text=${hub.rejectionMsg}`),
            `Hub '${hub.name}' rejection message was missing or incorrect`,
          ).toBeVisible();
        }
      }
    }

    // 6A. Super Admin: Authorized for ALL 7 hubs
    test("6A. Super Admin: full positive authorization across all 7 administrative hubs", async ({
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

      // Test all 7 hubs: all 7 are authorized
      await verifyHubAccessMatrix(
        page,
        new Set(["home", "matches", "club", "finance", "studio", "design", "settings"]),
      );

      // Return to Player View button restores player session without persona switching
      const returnBtn = page
        .locator('button:has-text("Player View"), button:has-text("Return to Player View"), button[title*="Player View"]')
        .filter({ visible: true })
        .first();
      await expect(returnBtn).toBeVisible({ timeout: 5000 });
      await returnBtn.click();
      await expect(page.locator("h1", { hasText: /KAVACH/i })).toBeVisible();
    });

    // 6B. Club Admin: Overview, Match Centre, Player Roster, Club Operations (design) authorized; Finance, Studio, Settings rejected
    test("6B. Club Admin: 7-hub authorization matrix (authorized: Overview, Matches, Roster, Ops; rejected: Finance, Studio, Settings)", async ({
      page,
    }) => {
      await injectSyntheticSession(page, {
        uid: "user-club-admin",
        role: "player",
        isClubAdmin: true,
      });

      await page.goto("/");
      const adminEntry = page.locator('button[title*="Admin Console"], button:has-text("Admin Console"), button:has-text("Admin")').first();
      await expect(adminEntry).toBeVisible({ timeout: 10000 });
      await adminEntry.click();

      await verifyHubAccessMatrix(
        page,
        new Set(["home", "matches", "club", "design"]),
      );
    });

    // 6C. Match Admin: Match Centre authorized; remaining 6 hubs rejected
    test("6C. Match Admin: 7-hub authorization matrix (authorized: Match Centre; rejected: remaining 6 hubs)", async ({
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

      await verifyHubAccessMatrix(
        page,
        new Set(["matches"]),
      );
    });

    // 6D. Finance Admin: Finance & Dues authorized; remaining 6 hubs rejected
    test("6D. Finance Admin: 7-hub authorization matrix (authorized: Finance & Dues; rejected: remaining 6 hubs)", async ({
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

      await verifyHubAccessMatrix(
        page,
        new Set(["finance"]),
      );
    });

    // 6E. Studio Admin: Studio & Nets authorized; remaining 6 hubs rejected
    test("6E. Studio Admin: 7-hub authorization matrix (authorized: Studio & Nets; rejected: remaining 6 hubs)", async ({
      page,
    }) => {
      await injectSyntheticSession(page, {
        uid: "user-studio-admin",
        role: "player",
        isStudioAdmin: true,
      });

      await page.goto("/");
      const adminEntry = page.locator('button[title*="Admin Console"], button:has-text("Admin Console"), button:has-text("Admin")').first();
      await expect(adminEntry).toBeVisible({ timeout: 10000 });
      await adminEntry.click();

      await verifyHubAccessMatrix(
        page,
        new Set(["studio"]),
      );
    });

    // 6F. Designer: Club Operations (design) authorized; remaining 6 hubs rejected
    test("6F. Designer: 7-hub authorization matrix (authorized: Club Operations; rejected: remaining 6 hubs)", async ({
      page,
    }) => {
      await injectSyntheticSession(page, {
        uid: "user-designer",
        role: "player",
        isDesigner: true,
      });

      await page.goto("/");
      const adminEntry = page.locator('button[title*="Admin Console"], button:has-text("Admin Console"), button:has-text("Admin")').first();
      await expect(adminEntry).toBeVisible({ timeout: 10000 });
      await adminEntry.click();

      await verifyHubAccessMatrix(
        page,
        new Set(["design"]),
      );
    });

    // 6G. Standard Player: No Admin Console access; client-side tampering rejected
    test("6G. Standard Player: player view only; no Admin Console; client-side tampering rejected", async ({
      page,
    }) => {
      await injectSyntheticSession(page, {
        uid: "user-standard-player",
        role: "player",
      });

      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      // Negative check: Admin Console entry must NOT be rendered in header or sidebar
      const adminEntry = page.locator('button[title*="Admin Console"], button:has-text("Admin Console")');
      await expect(adminEntry).not.toBeVisible();

      // Negative check: Attempt client-side persona tampering
      await page.evaluate(() => (window as any).__KAVACH_SET_PERSONA__?.("admin"));
      await page.waitForTimeout(500);

      // Guard in app/page.tsx immediately forces persona back to player
      await expect(page.locator("text=Return to Player View")).not.toBeVisible();
      await expect(page.locator("text=Admin Hub Context Banner")).not.toBeVisible();
      await expect(page.locator("h1", { hasText: /KAVACH/i })).toBeVisible();

      // Verifying that navigating while unprivileged keeps player in standard player experience
      for (const hub of ALL_7_HUBS) {
        await page.evaluate((t) => (window as any).__KAVACH_NAVIGATE_TAB__?.(t), hub.tab);
        await page.waitForTimeout(50);
        // Standard player mode renders Player tabs, never the admin error card 'Hub Restricted'
        await expect(page.locator("text=Hub Restricted")).not.toBeVisible();
      }
    });
  });

  // ── 7. Responsive Ergonomics & Minimum 44px Touch Targets (E2E-03) ─────────
  test.describe("7. Responsive Ergonomics & Touch Target Sizing (>= 44px)", () => {
    const viewports = [
      { name: "360x800 Mobile", width: 360, height: 800 },
      { name: "390x844 Mobile", width: 390, height: 844 },
      { name: "1280x800 Desktop", width: 1280, height: 800 },
    ];

    for (const vp of viewports) {
      test(`Renders cleanly at ${vp.name} with zero horizontal overflow and >= 44px touch targets`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await injectSyntheticSession(page, {
          uid: "player-responsive",
          role: "player",
        });

        await page.goto("/");
        await page.waitForLoadState("domcontentloaded");

        // Verify zero horizontal scroll overflow
        const isOverflowing = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(isOverflowing).toBeFalsy();

        // Verify primary header is visible
        const header = page.locator("header").first();
        await expect(header).toBeVisible({ timeout: 10000 });

        // Check interactive touch target sizes on mobile (>= 44px)
        if (vp.width < 768) {
          const nav = page.locator('nav[data-testid="player-mobile-bottom-nav"]');
          await expect(nav).toBeVisible({ timeout: 5000 });

          const navButtons = nav.locator("button");
          const count = await navButtons.count();

          // Exactly 5 primary buttons (Home, Matches, Payments, Performance, Club)
          expect(count).toBe(5);

          for (let i = 0; i < count; i++) {
            const btn = navButtons.nth(i);
            const box = await btn.boundingBox();
            expect(box).not.toBeNull();
            // Strict 44px touch target ergonomics requirement
            expect(box!.height).toBeGreaterThanOrEqual(44);
            expect(box!.width).toBeGreaterThanOrEqual(44);
          }
        }
      });
    }
  });
});
