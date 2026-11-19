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
  tournaments?: any[];
  matches?: any[];
  payments?: any[];
  posts?: any[];
  withAlertMatch?: boolean;
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
    kavachId: "KAV-018",
    locality: "South Delhi",
    bloodGroup: "O+",
    emergencyContact: "+919876543211",
    battingStyle: "Right-hand bat",
    bowlingStyle: "Right-arm medium",
    chestSize: "40",
    jerseyNumber: "18",
    totalRuns: 420,
    totalWickets: 14,
    stunningCatches: 5,
  };

  const todayDate = new Date();
  const todayDD = String(todayDate.getDate()).padStart(2, "0");
  const todayMM = String(todayDate.getMonth() + 1).padStart(2, "0");
  const upcomingDate = new Date(Date.now() + 4 * 86400000);
  const upcomingMMDD = `${String(upcomingDate.getMonth() + 1).padStart(2, "0")}-${String(upcomingDate.getDate()).padStart(2, "0")}`;

  const teammate1 = {
    id: "player-teammate-1",
    name: "Rohit Sharma",
    mobile: "+919811100001",
    // Deterministic DD/MM/YYYY format test for Today's birthday
    dob: `${todayDD}/${todayMM}/1990`,
    kavachId: "KAV-045",
    disabled: false,
    inviteStatus: "Accepted",
  };

  const teammate2 = {
    id: "player-teammate-2",
    name: "Virat Kohli",
    mobile: "+919811100002",
    // Deterministic YYYY-MM-DD format test for Upcoming birthday in 4 days
    dob: `1988-${upcomingMMDD}`,
    kavachId: "KAV-018A",
    disabled: false,
    inviteStatus: "Accepted",
  };

  const alertDate = new Date(Date.now() + 3 * 3600000);
  const alertDateStr = alertDate.toISOString().split("T")[0];
  const alertHours = String(alertDate.getHours()).padStart(2, "0");
  const alertMins = String(alertDate.getMinutes()).padStart(2, "0");

  const alertMatch = {
    id: "match-alert-today",
    groundId: "ground-1",
    format: "T20",
    jerseyColor: "Scarlet Red",
    date: alertDateStr,
    time: `${alertHours}:${alertMins}`,
    opponent: "Mumbai Masters",
    ourScore: "",
    opponentScore: "",
    result: "Pending",
    fee: 650,
    reportingTime: "06:30",
    notes: "Match Day Alert live fixture starting today.",
  };

  const tournamentMatch = {
    id: "match-tournament-1",
    tournamentId: "tournament-winter-cup-2026",
    groundId: "ground-1",
    format: "T20",
    jerseyColor: "Scarlet Red",
    date: "2026-12-15",
    time: "08:00",
    opponent: "Winter Warriors",
    ourScore: "",
    opponentScore: "",
    result: "Pending",
    fee: 650,
    reportingTime: "07:30",
    notes: "Round 1 of Winter Super Cup 2026.",
  };

  const baseMatches = [
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
      id: "match-upcoming-2",
      groundId: "ground-2",
      format: "T30",
      jerseyColor: "Whites",
      date: "2026-11-28",
      time: "08:00",
      opponent: "Noida Strikers",
      ourScore: "",
      opponentScore: "",
      result: "Pending",
      fee: 600,
      reportingTime: "07:30",
    },
    {
      id: "match-upcoming-3",
      groundId: "ground-1",
      format: "T20",
      jerseyColor: "Scarlet Red",
      date: "2026-12-02",
      time: "07:00",
      opponent: "Gurgaon Royals",
      ourScore: "",
      opponentScore: "",
      result: "Pending",
      fee: 650,
      reportingTime: "06:30",
    },
    {
      // OPEN FIXTURE: No confirmed squad assignment yet; all active players can view & RSVP
      id: "match-upcoming-4",
      groundId: "ground-2",
      format: "T30",
      jerseyColor: "Whites",
      date: "2026-12-06",
      time: "08:30",
      opponent: "Faridabad Kings",
      ourScore: "",
      opponentScore: "",
      result: "Pending",
      fee: 600,
      reportingTime: "08:00",
    },
    {
      // INELIGIBLE FIXTURE: Squad restricted to other teammates via MatchPayment records; excludes current player
      id: "match-ineligible-squad",
      groundId: "ground-1",
      format: "T20",
      jerseyColor: "Scarlet Red",
      date: "2026-12-08",
      time: "09:00",
      opponent: "Jaipur Strikers",
      ourScore: "",
      opponentScore: "",
      result: "Pending",
      fee: 650,
      reportingTime: "08:30",
    },
    {
      // INELIGIBLE FIXTURE: Tentatively blocked slot (only visible to admin)
      id: "match-ineligible-tentative",
      groundId: "ground-2",
      format: "T30",
      jerseyColor: "Whites",
      date: "2026-12-10",
      time: "07:30",
      opponent: "Tentative Challengers",
      ourScore: "",
      opponentScore: "",
      result: "Pending",
      fee: 600,
      reportingTime: "07:00",
      isTentative: true,
      tentativelyBlockedBy: "Admin",
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
      result: "Abandoned",
      fee: 550,
    },
  ];

  const basePayments = [
    {
      id: `pay-upcoming-${playerId}`,
      playerId: playerId,
      matchId: "match-upcoming-1",
      status: "Unpaid",
      availability: "Confirmed",
    },
    {
      id: `pay-upcoming-teammate-1`,
      playerId: "player-teammate-1",
      matchId: "match-upcoming-1",
      status: "Unpaid",
      availability: "Confirmed",
    },
    {
      id: `pay-upcoming-2-${playerId}`,
      playerId: playerId,
      matchId: "match-upcoming-2",
      status: "Unpaid",
      availability: "Tentative",
    },
    {
      id: `pay-upcoming-2-teammate-1`,
      playerId: "player-teammate-1",
      matchId: "match-upcoming-2",
      status: "Unpaid",
      availability: "Confirmed",
    },
    {
      id: `pay-upcoming-3-${playerId}`,
      playerId: playerId,
      matchId: "match-upcoming-3",
      status: "Unpaid",
      availability: "No",
    },
    {
      id: `pay-upcoming-3-teammate-1`,
      playerId: "player-teammate-1",
      matchId: "match-upcoming-3",
      status: "Unpaid",
      availability: "Confirmed",
    },
    // Realistic assigned squad for match-ineligible-squad: assigned to teammates, NO record for playerId
    {
      id: `pay-ineligible-teammate-1`,
      playerId: "player-teammate-1",
      matchId: "match-ineligible-squad",
      status: "Unpaid",
      availability: "Confirmed",
    },
    {
      id: `pay-ineligible-teammate-2`,
      playerId: "player-teammate-2",
      matchId: "match-ineligible-squad",
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

  let matches = [...baseMatches];
  let payments = [...basePayments];

  if (roleConfig.withAlertMatch) {
    matches.unshift(alertMatch);
    payments.unshift(
      {
        id: `pay-alert-${playerId}`,
        playerId: playerId,
        matchId: "match-alert-today",
        status: "Unpaid",
        availability: "Confirmed",
      },
      {
        id: "pay-alert-teammate-1",
        playerId: "player-teammate-1",
        matchId: "match-alert-today",
        status: "Unpaid",
        availability: "Confirmed",
      }
    );
  }

  if (
    roleConfig.tournaments &&
    roleConfig.tournaments.some((t) => t.id === "tournament-winter-cup-2026")
  ) {
    matches.push(tournamentMatch);
    payments.push({
      id: `pay-tourn-1-${playerId}`,
      playerId: playerId,
      matchId: "match-tournament-1",
      status: "Unpaid",
      availability: "Confirmed",
    });
  }

  if (roleConfig.matches) {
    matches = roleConfig.matches;
  }
  if (roleConfig.payments) {
    payments = roleConfig.payments;
  }

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
      id: "post-announcement-1",
      authorId: "admin-system",
      authorName: "Coach Sharma",
      title: "Annual Club Championship & Selection Trials",
      text: "Selections for the winter championship league will take place this Saturday 7 AM at KAvach Sports Arena. Please ensure availability is marked.",
      createdAt: { seconds: FIXED_TEST_TIMESTAMP },
      comments: [],
      isPinned: true,
      isAnnouncement: true,
    },
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

  const tournaments = [
    {
      id: "tournament-kpl",
      name: "KAvach Premier League 2026",
      groundId: "ground-1",
      organiserName: "Coach Sharma",
      organiserPhone: "+919811122233",
      gpayNumber: "9811122233",
      jerseyColor: "Scarlet Red" as const,
      format: "T20" as const,
      amountPerMatch: 7200,
      perPlayerFee: 650,
      status: "Ongoing" as const,
      notes: "Premier club championship with live scorecards and MVP leaderboard.",
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
    players: [player, teammate1, teammate2],
    matches: matches,
    payments: payments,
    grounds: grounds,
    otherFees: otherFees,
    posts: roleConfig.posts || posts,
    tournaments: roleConfig.tournaments || tournaments,
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
