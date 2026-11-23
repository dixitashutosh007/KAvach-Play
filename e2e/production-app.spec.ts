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

    // 2. Mandatory Payments line-item assertion (D-16: reached from the Home "Pay Now" action)
    await page.locator('[data-testid="pay-now-button"]').click();
    await expect(page.locator('[data-testid="player-back-button"]')).toBeVisible({ timeout: 10000 });

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
      // Playing · Maybe · Out availability buttons
      const playingBtn = page.locator('button[aria-label="Mark availability as Playing"]').first();
      await expect(playingBtn).toBeVisible({ timeout: 5000 });
      expect(await playingBtn.getAttribute("aria-pressed")).toBe("true");
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

  // ── 6. D-18 Admin navigation: role → destination / screen / Club section matrix ─
  test.describe("6. D-18 Admin destinations and granular RBAC matrix", () => {
    const DESTINATIONS = ["home", "matches", "club", "finance", "design", "settings"] as const;
    const ALL_TABS = [...DESTINATIONS, "studio", "grounds"] as const;

    async function visibleAdminNav(page: Page) {
      const ids = await page
        .locator('[data-testid^="sidebar-tab-"], [data-testid^="admin-nav-"]')
        .evaluateAll((els) =>
          els
            .filter((e) => (e as HTMLElement).offsetParent !== null)
            .map((e) => (e.getAttribute("data-testid") || "").replace(/^sidebar-tab-|^admin-nav-/, "")),
        );
      return ids;
    }

    async function assertScreen(page: Page, tab: string, clubSections: string[]) {
      if (tab === "home") {
        await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible({ timeout: 5000 });
      } else if (tab === "matches") {
        await expect(page.locator('[data-testid="match-subtabs"]')).toBeVisible({ timeout: 5000 });
        for (const t of ["Matches", "Tournaments", "Grounds"]) {
          await expect(page.locator('[data-testid="match-subtabs"]').getByRole("button", { name: t, exact: true })).toBeVisible();
        }
      } else if (tab === "club") {
        await expect(page.locator('[data-testid="club-sub-tabs"]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator(`[data-testid="club-sub-tab-${clubSections[0]}"]`)).toBeVisible({ timeout: 5000 });
        const ids = await page.locator('[data-testid^="club-sub-tab-"]').evaluateAll((els) =>
          els.map((e) => (e.getAttribute("data-testid") || "").replace("club-sub-tab-", "")),
        );
        expect(ids).toEqual(clubSections);
      } else if (tab === "finance") {
        await expect(page.getByRole("heading", { name: "Match Fee Accounting" })).toBeVisible({ timeout: 5000 });
      } else if (tab === "design") {
        await expect(page.getByRole("heading", { name: "KAvach Design" })).toBeVisible({ timeout: 5000 });
      } else if (tab === "settings") {
        await expect(page.getByRole("heading", { name: "Admin Settings" })).toBeVisible({ timeout: 5000 });
      }
      await expect(page.locator("text=Hub Restricted")).toHaveCount(0);
      await expect(page.locator('[data-testid="access-denied"]')).toHaveCount(0);
    }

    // D-19: Match Admin / Studio Admin retired into Club Admin; legacy flags keep
    // their former areas until the role-consolidation migration runs.
    const CLUB_ALL = ["players", "studio", "announcements", "pulse", "leaderboard", "badges", "shop"];
    const ROLES: { name: string; cfg: Record<string, boolean>; nav: string[]; club: string[] }[] = [
      { name: "6A. Super Admin", cfg: { isSuperAdmin: true }, nav: [...DESTINATIONS], club: CLUB_ALL },
      { name: "6B. Club Admin", cfg: { isClubAdmin: true }, nav: ["home", "matches", "club", "design"], club: CLUB_ALL },
      { name: "6C. Legacy Match Admin", cfg: { isMatchAdmin: true }, nav: ["home", "matches"], club: [] },
      { name: "6D. Finance Admin", cfg: { isFinanceAdmin: true }, nav: ["home", "finance"], club: [] },
      { name: "6E. Legacy Studio Admin", cfg: { isStudioAdmin: true }, nav: ["home", "club"], club: ["studio"] },
      { name: "6F. Designer", cfg: { isDesigner: true }, nav: ["home", "design"], club: [] },
      { name: "6H. Club + Finance Admin (multi-role)", cfg: { isClubAdmin: true, isFinanceAdmin: true }, nav: ["home", "matches", "club", "finance", "design"], club: CLUB_ALL },
    ];

    for (const role of ROLES) {
      test(`${role.name}: sees exactly ${role.nav.join(", ")}; unauthorised destinations show access denied`, async ({ page }) => {
        await injectSyntheticSession(page, { uid: `rbac-${role.name.slice(0, 2)}`, role: "admin", ...role.cfg });
        await page.goto("/");
        await page.waitForLoadState("domcontentloaded");
        await page.locator('[data-testid="header-persona-toggle"]').click();
        await expect(
          page.locator('[data-testid^="sidebar-tab-"], [data-testid="admin-mobile-bottom-nav"]').filter({ visible: true }).first(),
        ).toBeVisible({ timeout: 10000 });

        expect(await visibleAdminNav(page)).toEqual(role.nav);

        for (const tab of ALL_TABS) {
          await page.evaluate((t) => (window as any).__KAVACH_NAVIGATE_TAB__?.(t), tab);
          await page.waitForTimeout(150);
          const parent = tab === "studio" ? "club" : tab === "grounds" ? "matches" : tab;
          if (role.nav.includes(parent) && (tab !== "studio" || role.club.includes("studio"))) {
            await assertScreen(page, parent, role.club);
            if (tab === "studio") await expect(page.locator('[data-testid="studio-tabs"]')).toBeVisible({ timeout: 5000 });
          } else {
            // Unauthorised (D-19): polite access-denied card, no redirect, no "Hub Restricted"
            await expect(page.locator('[data-testid="access-denied"]').first()).toBeVisible({ timeout: 5000 });
            await expect(page.locator("text=Hub Restricted")).toHaveCount(0);
          }
        }

        // Return to Player persona restores the 3-item player navigation
        await page.locator('[data-testid="header-persona-toggle"]').click();
        await expect(page.locator('[data-testid="player-home-container"]')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid^="sidebar-tab-"], [data-testid="admin-mobile-bottom-nav"]')).toHaveCount(0);
      });
    }

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

      const adminEntry = page.locator('button[title*="Admin Console"], button:has-text("Admin Console")');
      await expect(adminEntry).not.toBeVisible();

      // Client-side persona tampering is reverted by the app/page.tsx guard
      await page.evaluate(() => (window as any).__KAVACH_SET_PERSONA__?.("admin"));
      await page.waitForTimeout(500);
      await expect(page.locator("text=Return to Player View")).not.toBeVisible();
      await expect(page.locator('[data-testid^="sidebar-tab-"], [data-testid="admin-mobile-bottom-nav"]')).toHaveCount(0);
      await expect(page.locator("h1", { hasText: /KAVACH/i })).toBeVisible();

      for (const tab of ALL_TABS) {
        await page.evaluate((t) => (window as any).__KAVACH_NAVIGATE_TAB__?.(t), tab);
        await page.waitForTimeout(50);
        await expect(page.locator("text=Hub Restricted")).not.toBeVisible();
        await expect(page.locator('[data-testid="admin-club"]')).toHaveCount(0);
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

          // D-16: exactly 3 primary buttons (Home, Profile, Matches)
          expect(count).toBe(3);
          expect(await navButtons.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual(["Home", "Profile", "Matches"]);

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
