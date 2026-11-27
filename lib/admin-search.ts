import type { AdminDestination } from "./admin-navigation.ts";

export type AdminSearchCategory =
  | "players"
  | "matches"
  | "grounds"
  | "finance"
  | "announcements"
  | "pulse"
  | "badges"
  | "catches"
  | "noShows"
  | "tournaments"
  | "studio"
  | "shop";

export interface AdminSearchRoleContext {
  isSuperAdmin: boolean;
  isClubAdmin: boolean;
  isFinanceAdmin: boolean;
}

export interface AdminSearchDestination {
  tab: AdminDestination;
  action?: string;
}

export interface AdminSearchResultItem {
  id: string;
  category: AdminSearchCategory;
  title: string;
  subtitle?: string;
  badges?: string[];
  meta?: string;
  destination: AdminSearchDestination;
}

export interface AdminSearchGroup {
  category: AdminSearchCategory;
  label: string;
  items: AdminSearchResultItem[];
  totalMatched: number;
}

export interface AdminSearchResponse {
  query: string;
  groups: AdminSearchGroup[];
  totalCount: number;
}

export const ADMIN_SEARCH_CATEGORY_LABELS: Readonly<Record<AdminSearchCategory, string>> = {
  players: "Players",
  matches: "Matches",
  grounds: "Grounds",
  finance: "Finance & Dues",
  announcements: "Announcements",
  pulse: "Pulse",
  badges: "Badges",
  catches: "Catches",
  noShows: "No-Shows",
  tournaments: "Tournaments",
  studio: "Studio",
  shop: "Shop",
};

const ALL_CATEGORIES: readonly AdminSearchCategory[] = [
  "players",
  "matches",
  "grounds",
  "finance",
  "announcements",
  "pulse",
  "badges",
  "catches",
  "noShows",
  "tournaments",
  "studio",
  "shop",
];

const CLUB_ADMIN_CATEGORIES: readonly AdminSearchCategory[] = [
  "players",
  "matches",
  "grounds",
  "announcements",
  "pulse",
  "badges",
  "catches",
  "tournaments",
  "studio",
  "shop",
];

const FINANCE_ADMIN_CATEGORIES: readonly AdminSearchCategory[] = [
  "finance",
  "noShows",
  "players",
  "matches",
  "studio",
];

/**
 * Authoritative category allowlist for an admin caller.
 * Club Admin is strictly excluded from financial categories (`finance`, `noShows`).
 */
export function getPermittedAdminSearchCategories(
  roles: AdminSearchRoleContext,
): AdminSearchCategory[] {
  if (roles.isSuperAdmin) {
    return [...ALL_CATEGORIES];
  }
  const allowed = new Set<AdminSearchCategory>();
  if (roles.isClubAdmin) {
    for (const c of CLUB_ADMIN_CATEGORIES) allowed.add(c);
  }
  if (roles.isFinanceAdmin) {
    for (const c of FINANCE_ADMIN_CATEGORIES) allowed.add(c);
  }
  return ALL_CATEGORIES.filter((c) => allowed.has(c));
}

export interface AdminSearchDataset {
  players?: Array<Record<string, unknown> & { id: string }>;
  matches?: Array<Record<string, unknown> & { id: string }>;
  grounds?: Array<Record<string, unknown> & { id: string }>;
  tournaments?: Array<Record<string, unknown> & { id: string }>;
  announcements?: Array<Record<string, unknown> & { id: string }>;
  polls?: Array<Record<string, unknown> & { id: string }>;
  badges?: Array<Record<string, unknown> & { id: string }>;
  badgeTypeDefs?: Array<Record<string, unknown> & { id: string }>;
  catches?: Array<Record<string, unknown> & { id: string }>;
  matchPayments?: Array<Record<string, unknown> & { id: string; matchId?: string }>;
  otherFees?: Array<Record<string, unknown> & { id: string; playerId?: string }>;
  feePlans?: Array<Record<string, unknown> & { id: string }>;
  feePlanAssignments?: Array<Record<string, unknown> & { id: string }>;
  subscriptionHistory?: Array<Record<string, unknown> & { id: string }>;
  merchandises?: Array<Record<string, unknown> & { id: string }>;
  merchOrders?: Array<Record<string, unknown> & { id: string }>;
}

function str(val: unknown): string {
  return typeof val === "string" ? val : val != null && typeof val !== "object" ? String(val) : "";
}

function num(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string" && val.trim() && Number.isFinite(Number(val))) return Number(val);
  return null;
}

function formatInr(amount: number | null): string | undefined {
  if (amount === null) return undefined;
  return `₹${amount.toLocaleString("en-IN")}`;
}

function formatTimestamp(val: unknown): string {
  if (!val) return "";
  if (typeof val === "string") return val.slice(0, 10);
  if (typeof val === "number") return new Date(val).toISOString().slice(0, 10);
  if (typeof val === "object" && val !== null) {
    const maybe = val as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof maybe.toDate === "function") return maybe.toDate().toISOString().slice(0, 10);
    const secs = maybe.seconds ?? maybe._seconds;
    if (typeof secs === "number") return new Date(secs * 1000).toISOString().slice(0, 10);
  }
  return "";
}

function matchesQuery(q: string, ...fields: Array<unknown>): boolean {
  for (const field of fields) {
    if (Array.isArray(field)) {
      if (field.some((item) => str(item).toLowerCase().includes(q))) return true;
    } else if (str(field).toLowerCase().includes(q)) {
      return true;
    }
  }
  return false;
}

const DEFAULT_CATEGORY_LIMIT = 15;

export function executeAdminSearch(
  dataset: AdminSearchDataset,
  rawQuery: string,
  roles: AdminSearchRoleContext,
  perCategoryLimit = DEFAULT_CATEGORY_LIMIT,
): AdminSearchResponse {
  const query = rawQuery.trim();
  const q = query.toLowerCase();
  const permitted = new Set(getPermittedAdminSearchCategories(roles));

  if (!q || permitted.size === 0) {
    return { query, groups: [], totalCount: 0 };
  }

  const canSeeClub = roles.isSuperAdmin || roles.isClubAdmin;
  const canSeeFinance = roles.isSuperAdmin || roles.isFinanceAdmin;
  const limit = Math.max(1, Math.min(perCategoryLimit, 50));

  const players = dataset.players || [];
  const matches = dataset.matches || [];
  const grounds = dataset.grounds || [];
  const tournaments = dataset.tournaments || [];

  const playerById = new Map(players.map((p) => [p.id, p]));
  const groundNameById = new Map(grounds.map((g) => [g.id, str(g.name)]));
  const tournamentNameById = new Map(tournaments.map((t) => [t.id, str(t.name)]));
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const badgeDefById = new Map((dataset.badgeTypeDefs || []).map((b) => [b.id, b]));

  const groups: AdminSearchGroup[] = [];
  const pushGroup = (category: AdminSearchCategory, allItems: AdminSearchResultItem[]) => {
    if (!permitted.has(category) || allItems.length === 0) return;
    groups.push({
      category,
      label: ADMIN_SEARCH_CATEGORY_LABELS[category],
      items: allItems.slice(0, limit),
      totalMatched: allItems.length,
    });
  };

  // 1. Players
  if (permitted.has("players")) {
    const items: AdminSearchResultItem[] = [];
    for (const p of players) {
      const name = str(p.name) || "Unnamed Player";
      const kavachId = str(p.kavachId);
      const jerseyNumber = str(p.jerseyNumber);
      const jerseyName = str(p.jerseyName);
      // Club Admin & Super Admin may search authorized contact details; Finance-only Admin searches non-PII fields only.
      const hit = canSeeClub
        ? matchesQuery(q, name, kavachId, jerseyNumber, jerseyName, p.mobile, p.email, p.locality)
        : matchesQuery(q, name, kavachId, jerseyNumber);

      if (!hit) continue;

      const badges: string[] = [];
      if (kavachId) badges.push(kavachId);
      if (p.disabled === true) badges.push("Disabled");
      else if (str(p.inviteStatus)) badges.push(str(p.inviteStatus));

      const subtitleParts: string[] = [];
      if (jerseyNumber) subtitleParts.push(`#${jerseyNumber}`);
      if (canSeeClub) {
        if (str(p.mobile)) subtitleParts.push(str(p.mobile));
        if (str(p.email)) subtitleParts.push(str(p.email));
      }

      items.push({
        id: p.id,
        category: "players",
        title: name,
        subtitle: subtitleParts.join(" • ") || undefined,
        badges: badges.length ? badges : undefined,
        destination: canSeeClub ? { tab: "club", action: "players" } : { tab: "finance", action: "dues" },
      });
    }
    pushGroup("players", items);
  }

  // 2. Matches
  if (permitted.has("matches")) {
    const items: AdminSearchResultItem[] = [];
    for (const m of matches) {
      const opponent = str(m.opponent) || "TBD";
      const gName = m.groundId ? groundNameById.get(str(m.groundId)) || "" : "";
      const tName = m.tournamentId ? tournamentNameById.get(str(m.tournamentId)) || "" : "";
      const resultText = [str(m.result), str(m.resultMarginAmount), str(m.resultMarginType)]
        .filter(Boolean)
        .join(" ");

      if (!matchesQuery(q, opponent, m.date, gName, m.format, m.matchType, resultText, tName)) {
        continue;
      }

      const subtitleParts = [str(m.date), str(m.format) || "T20", str(m.matchType) || "Practice"];
      if (gName) subtitleParts.push(gName);

      const badges: string[] = [];
      if (str(m.result)) badges.push(str(m.result));
      if (m.isArchived === true) badges.push("Archived");

      items.push({
        id: m.id,
        category: "matches",
        title: `vs ${opponent}`,
        subtitle: subtitleParts.filter(Boolean).join(" • "),
        badges: badges.length ? badges : undefined,
        meta: canSeeFinance && num(m.fee) !== null ? formatInr(num(m.fee)) : undefined,
        destination: canSeeClub ? { tab: "matches", action: `match_${m.id}` } : { tab: "finance", action: "matches" },
      });
    }
    pushGroup("matches", items);
  }

  // 3. Grounds
  if (permitted.has("grounds")) {
    const items: AdminSearchResultItem[] = [];
    for (const g of grounds) {
      const location = str(g.location) || str(g.address) || str(g.city);
      if (!matchesQuery(q, g.name, location, g.organiserName)) continue;
      items.push({
        id: g.id,
        category: "grounds",
        title: str(g.name) || "Ground",
        subtitle: [location, str(g.organiserName)].filter(Boolean).join(" • ") || undefined,
        destination: { tab: "matches", action: "grounds" },
      });
    }
    pushGroup("grounds", items);
  }

  // 4. Finance & Dues (STRICTLY Finance Admin / Super Admin)
  if (permitted.has("finance") && canSeeFinance) {
    const items: AdminSearchResultItem[] = [];

    for (const pay of dataset.matchPayments || []) {
      const m = pay.matchId ? matchById.get(pay.matchId) : undefined;
      const pl = pay.playerId ? playerById.get(str(pay.playerId)) : undefined;
      const playerName = str(pay.guestName) || str(pl?.name) || str(pay.playerId);
      const kavachId = str(pl?.kavachId);
      const opponent = m ? str(m.opponent) : "";
      const matchDate = m ? str(m.date) : "";
      const status = str(pay.status) || "Unpaid";
      const amount = num(pay.feeCollectedAmount) ?? num(pay.feeOverride) ?? (m ? num(m.fee) : null);

      if (
        !matchesQuery(
          q,
          playerName,
          kavachId,
          opponent,
          matchDate,
          status,
          pay.manualMethod,
          pay.planTag,
          pay.razorpayPaymentId,
        )
      ) {
        continue;
      }

      items.push({
        id: `pay_${pay.matchId || ""}_${pay.id}`,
        category: "finance",
        title: `${playerName} — ${opponent ? `vs ${opponent}` : "Match Payment"}`,
        subtitle: [matchDate, str(pay.manualMethod || pay.paymentMethod)].filter(Boolean).join(" • ") || undefined,
        badges: ["Match Fee", status],
        meta: formatInr(amount),
        destination: { tab: "finance", action: "matches" },
      });
    }

    for (const fee of dataset.otherFees || []) {
      const title = str(fee.title);
      if (/no[\s-]?show/i.test(title)) continue; // Surfaced in dedicated No-Shows category
      const pl = fee.playerId ? playerById.get(str(fee.playerId)) : undefined;
      const playerName = str(pl?.name) || str(fee.playerId);
      const kavachId = str(pl?.kavachId);
      const status = str(fee.status) || "Unpaid";

      if (!matchesQuery(q, title, fee.comment, status, playerName, kavachId)) continue;

      items.push({
        id: `fee_${fee.id}`,
        category: "finance",
        title: `${playerName} — ${title || "Other Fee"}`,
        subtitle: str(fee.comment) || undefined,
        badges: ["Other Fee", status],
        meta: formatInr(num(fee.amount)),
        destination: { tab: "finance", action: "dues" },
      });
    }

    for (const plan of dataset.feePlans || []) {
      if (!matchesQuery(q, plan.name, plan.type, plan.description)) continue;
      const amt = num(plan.feeAmount) ?? num(plan.monthlyAmount);
      items.push({
        id: `plan_${plan.id}`,
        category: "finance",
        title: str(plan.name) || "Fee Plan",
        subtitle: [str(plan.type), str(plan.description)].filter(Boolean).join(" • ") || undefined,
        badges: ["Fee Plan", plan.isActive === false ? "Inactive" : "Active"],
        meta: amt !== null ? formatInr(amt) : plan.discountPct != null ? `${plan.discountPct}% off` : undefined,
        destination: { tab: "finance", action: "plans" },
      });
    }

    for (const asgn of dataset.feePlanAssignments || []) {
      const pl = asgn.playerId ? playerById.get(str(asgn.playerId)) : undefined;
      const playerName = str(pl?.name) || str(asgn.playerId);
      if (!matchesQuery(q, asgn.planName, playerName, asgn.startDate, asgn.endDate)) continue;
      items.push({
        id: `asgn_${asgn.id}`,
        category: "finance",
        title: `${playerName} — ${str(asgn.planName)}`,
        subtitle: [str(asgn.startDate) || "Legacy", str(asgn.endDate) || "Ongoing"].join(" → "),
        badges: ["Plan Assignment", asgn.cancelled ? "Cancelled" : "Active"],
        destination: { tab: "finance", action: "plans" },
      });
    }

    pushGroup("finance", items);
  }

  // 5. Announcements
  if (permitted.has("announcements")) {
    const items: AdminSearchResultItem[] = [];
    for (const a of dataset.announcements || []) {
      if (a.isAnnouncement !== true) continue;
      if (!matchesQuery(q, a.title, a.text, a.authorName)) continue;
      const title = str(a.title) || str(a.text).slice(0, 60) || "Announcement";
      items.push({
        id: a.id,
        category: "announcements",
        title,
        subtitle: [str(a.authorName), formatTimestamp(a.createdAt), str(a.text).slice(0, 80)]
          .filter(Boolean)
          .join(" • "),
        badges: a.isPinned === true ? ["Pinned"] : undefined,
        destination: { tab: "club", action: "announcements" },
      });
    }
    pushGroup("announcements", items);
  }

  // 6. Pulse (polls only; never pollResponses)
  if (permitted.has("pulse")) {
    const items: AdminSearchResultItem[] = [];
    for (const poll of dataset.polls || []) {
      const status = poll.isActive === false ? "Closed" : "Active";
      const options = Array.isArray(poll.options) ? poll.options : [];
      if (!matchesQuery(q, poll.title, options, status, poll.type)) continue;
      items.push({
        id: poll.id,
        category: "pulse",
        title: str(poll.title) || "Poll",
        subtitle: options.length ? options.slice(0, 3).join(", ") : str(poll.type),
        badges: [status, ...(poll.isSticked ? ["Pinned"] : [])],
        destination: { tab: "club", action: "pulse" },
      });
    }
    pushGroup("pulse", items);
  }

  // 7. Badges
  if (permitted.has("badges")) {
    const items: AdminSearchResultItem[] = [];
    for (const b of dataset.badges || []) {
      const def = b.badgeType ? badgeDefById.get(str(b.badgeType)) : undefined;
      const badgeName = def ? str(def.label) : str(b.badgeType);
      const awardedDate = formatTimestamp(b.awardedAt);
      const recipient = str(b.playerName) || str(playerById.get(str(b.playerId))?.name);
      if (!matchesQuery(q, badgeName, recipient, awardedDate, b.note)) continue;

      items.push({
        id: b.id,
        category: "badges",
        title: `${badgeName} — ${recipient || "Player"}`,
        subtitle: [awardedDate, str(b.note)].filter(Boolean).join(" • ") || undefined,
        badges: def?.tier ? [str(def.tier)] : undefined,
        destination: { tab: "club", action: "badges" },
      });
    }
    pushGroup("badges", items);
  }

  // 8. Catches
  if (permitted.has("catches")) {
    const items: AdminSearchResultItem[] = [];
    for (const c of dataset.catches || []) {
      const playerName = str(c.playerName) || str(playerById.get(str(c.playerId))?.name);
      const m = c.matchId ? matchById.get(str(c.matchId)) : undefined;
      const matchLabel = m ? `vs ${str(m.opponent)} (${str(m.date)})` : "";
      const catchTypeLabel = c.type === "dropped" ? "Dropped Catch" : "Stunning Catch";
      if (!matchesQuery(q, catchTypeLabel, c.type, playerName, matchLabel, c.comment)) continue;

      items.push({
        id: c.id,
        category: "catches",
        title: `${playerName || "Player"} — ${catchTypeLabel} (×${num(c.count) ?? 1})`,
        subtitle: [matchLabel, str(c.comment), formatTimestamp(c.recordedAt)].filter(Boolean).join(" • ") || undefined,
        badges: [c.type === "dropped" ? "Dropped" : "Stunning"],
        destination: { tab: "club", action: "badges" },
      });
    }
    pushGroup("catches", items);
  }

  // 9. No-Shows (Finance Admin / Super Admin only — backed by financial otherFees)
  if (permitted.has("noShows") && canSeeFinance) {
    const items: AdminSearchResultItem[] = [];
    for (const fee of dataset.otherFees || []) {
      const title = str(fee.title);
      if (!/no[\s-]?show/i.test(title)) continue;
      const pl = fee.playerId ? playerById.get(str(fee.playerId)) : undefined;
      const playerName = str(pl?.name) || str(fee.playerId);
      const dateStr = formatTimestamp(fee.createdAt);
      const status = str(fee.status) || "Unpaid";
      if (!matchesQuery(q, title, playerName, dateStr, fee.comment, status)) continue;

      items.push({
        id: fee.id,
        category: "noShows",
        title: `${playerName} — ${title}`,
        subtitle: [dateStr, str(fee.comment)].filter(Boolean).join(" • ") || undefined,
        badges: [status],
        meta: formatInr(num(fee.amount)),
        destination: { tab: "finance", action: "dues" },
      });
    }
    pushGroup("noShows", items);
  }

  // 10. Tournaments
  if (permitted.has("tournaments")) {
    const items: AdminSearchResultItem[] = [];
    for (const t of tournaments) {
      const gName = t.groundId ? groundNameById.get(str(t.groundId)) || "" : "";
      if (!matchesQuery(q, t.name, gName, t.startDate, t.endDate, t.status, t.format)) continue;

      const dates = [str(t.startDate), str(t.endDate)].filter(Boolean).join(" → ");
      items.push({
        id: t.id,
        category: "tournaments",
        title: str(t.name) || "Tournament",
        subtitle: [gName, dates, str(t.format)].filter(Boolean).join(" • ") || undefined,
        badges: str(t.status) ? [str(t.status)] : undefined,
        destination: { tab: "matches", action: "tournaments" },
      });
    }
    pushGroup("tournaments", items);
  }

  // 11. Studio (memberships & subscriptions; paidAmount restricted to Finance/Super Admin)
  if (permitted.has("studio")) {
    const items: AdminSearchResultItem[] = [];
    const studioDest: AdminSearchDestination = canSeeClub
      ? { tab: "club", action: "studio" }
      : { tab: "finance", action: "razor" };

    for (const p of players) {
      if (!p.isStudioMember && !p.studioPlan && !p.studioExpiryDate) continue;
      if (!matchesQuery(q, p.name, p.kavachId, p.studioPlan, p.studioExpiryDate, "studio")) continue;
      items.push({
        id: `studio_member_${p.id}`,
        category: "studio",
        title: `${str(p.name)} — Studio Membership`,
        subtitle: [str(p.studioPlan), p.studioExpiryDate ? `Exp: ${str(p.studioExpiryDate)}` : ""]
          .filter(Boolean)
          .join(" • ") || undefined,
        badges: [p.isStudioMember ? "Active Member" : "Past Member"],
        destination: studioDest,
      });
    }

    for (const sub of dataset.subscriptionHistory || []) {
      const pl = sub.playerId ? playerById.get(str(sub.playerId)) : undefined;
      const playerName = str(pl?.name) || str(sub.playerId);
      if (!matchesQuery(q, playerName, sub.planName, sub.newExpiryDate, "subscription")) continue;
      items.push({
        id: `studio_sub_${sub.id}`,
        category: "studio",
        title: `${playerName} — ${str(sub.planName) || "Subscription"}`,
        subtitle: sub.newExpiryDate ? `Valid until ${str(sub.newExpiryDate)}` : undefined,
        badges: ["Subscription"],
        meta: canSeeFinance ? formatInr(num(sub.paidAmount)) : undefined,
        destination: studioDest,
      });
    }

    pushGroup("studio", items);
  }

  // 12. Shop (merchandise & orders)
  if (permitted.has("shop")) {
    const items: AdminSearchResultItem[] = [];

    for (const item of dataset.merchandises || []) {
      if (!matchesQuery(q, item.name, item.description, item.category, item.status)) continue;
      items.push({
        id: `merch_${item.id}`,
        category: "shop",
        title: str(item.name) || "Merchandise",
        subtitle: [str(item.category), str(item.description).slice(0, 60)].filter(Boolean).join(" • ") || undefined,
        badges: str(item.status) ? [str(item.status)] : undefined,
        destination: { tab: "club", action: "shop:products" },
      });
    }

    for (const ord of dataset.merchOrders || []) {
      if (!matchesQuery(q, ord.merchName, ord.playerName, ord.size, ord.orderStatus)) continue;
      items.push({
        id: `order_${ord.id}`,
        category: "shop",
        title: `${str(ord.playerName)} — ${str(ord.merchName)}`,
        subtitle: [str(ord.size) ? `Size ${str(ord.size)}` : "", str(ord.orderStatus)]
          .filter(Boolean)
          .join(" • ") || undefined,
        badges: ["Order", str(ord.orderStatus)].filter(Boolean),
        destination: { tab: "club", action: "shop:orders" },
      });
    }

    pushGroup("shop", items);
  }

  const totalCount = groups.reduce((sum, g) => sum + g.totalMatched, 0);
  return { query, groups, totalCount };
}
