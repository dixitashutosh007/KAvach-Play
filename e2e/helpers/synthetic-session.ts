import { Page } from "@playwright/test";

export const FIXED_TEST_TIMESTAMP = 1764000000;

export interface RoleConfig {
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
  features?: {
    payments?: boolean;
    studio?: boolean;
    leaderboard?: boolean;
    feed?: boolean;
    matches?: boolean;
    shop?: boolean;
    opinion?: boolean;
  };
}

export function createSyntheticStore(roleConfig: RoleConfig) {
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
      result: "Abandoned",
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
      status: "Unpaid",
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
        ...(roleConfig.features || {}),
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

export async function injectSyntheticSession(
  page: Page,
  roleConfig: RoleConfig,
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
