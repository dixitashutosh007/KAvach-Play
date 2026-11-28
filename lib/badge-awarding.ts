import type { BadgeAwardMode, BadgeCategory, BadgeTier, BadgeTypeDef } from "./types.ts";

export type AwardOutcomeStatus = "succeeded" | "skipped" | "failed";

export interface AwardOutcomeItem {
  playerId: string;
  playerName: string;
  status: AwardOutcomeStatus;
  reason?: string;
  idempotencyKey?: string;
  badgeId?: string;
}

export interface BatchAwardResult {
  badgeType: string;
  succeeded: AwardOutcomeItem[];
  skipped: AwardOutcomeItem[];
  failed: AwardOutcomeItem[];
}

export interface StandardizedBadgeMeta {
  id: string;
  label: string;
  short: string;
  tier: BadgeTier;
  emoji: string;
  stackable: boolean;
  category: BadgeCategory;
  description: string;
  criteria: string;
  artworkKey: string;
  active: boolean;
  awardMode: BadgeAwardMode;
  isBuiltin: boolean;
  order: number;
}

const VALID_TIERS: ReadonlySet<string> = new Set(["bronze", "silver", "gold", "diamond"]);

export const VALID_BADGE_CATEGORIES: ReadonlySet<BadgeCategory> = new Set([
  "tenure",
  "milestone",
  "performance",
  "club",
  "special",
  "custom",
]);

export const VALID_BADGE_AWARD_MODES: ReadonlySet<BadgeAwardMode> = new Set([
  "manual",
  "auto_tenure",
  "auto_stats",
  "system_potw",
]);

export const SYSTEM_ONLY_AWARD_MODES: ReadonlySet<BadgeAwardMode> = new Set(["system_potw"]);

export function isValidBadgeCategory(value: unknown): value is BadgeCategory {
  return typeof value === "string" && VALID_BADGE_CATEGORIES.has(value as BadgeCategory);
}

export function isValidBadgeAwardMode(value: unknown): value is BadgeAwardMode {
  return typeof value === "string" && VALID_BADGE_AWARD_MODES.has(value as BadgeAwardMode);
}

export function normalizeBadgeTier(tier: unknown): BadgeTier {
  return typeof tier === "string" && VALID_TIERS.has(tier) ? (tier as BadgeTier) : "bronze";
}

export function isBadgeTypeActive(def?: Pick<BadgeTypeDef, "active"> | null): boolean {
  return def?.active !== false;
}

export function formatLegacyBadgeLabel(badgeType: string): string {
  if (!badgeType) return "Badge";
  return badgeType
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const BUILTIN_BADGE_CATALOG: Readonly<Record<string, Omit<StandardizedBadgeMeta, "id" | "isBuiltin">>> = {
  year_1: {
    label: "1 Year with KAvach",
    short: "1 Year",
    tier: "bronze",
    emoji: "1",
    stackable: false,
    category: "tenure",
    description: "Completed 1 year as a member of KAvach Cricket Club.",
    criteria: "1+ year since KAvach joining date",
    artworkKey: "year_1",
    active: true,
    awardMode: "auto_tenure",
    order: 1,
  },
  year_2: {
    label: "2 Years with KAvach",
    short: "2 Years",
    tier: "bronze",
    emoji: "2",
    stackable: false,
    category: "tenure",
    description: "Completed 2 years as a member of KAvach Cricket Club.",
    criteria: "2+ years since KAvach joining date",
    artworkKey: "year_2",
    active: true,
    awardMode: "auto_tenure",
    order: 2,
  },
  year_3: {
    label: "3 Years with KAvach",
    short: "3 Years",
    tier: "silver",
    emoji: "3",
    stackable: false,
    category: "tenure",
    description: "Completed 3 years as a member of KAvach Cricket Club.",
    criteria: "3+ years since KAvach joining date",
    artworkKey: "year_3",
    active: true,
    awardMode: "auto_tenure",
    order: 3,
  },
  year_4: {
    label: "4 Years with KAvach",
    short: "4 Years",
    tier: "silver",
    emoji: "4",
    stackable: false,
    category: "tenure",
    description: "Completed 4 years as a member of KAvach Cricket Club.",
    criteria: "4+ years since KAvach joining date",
    artworkKey: "year_4",
    active: true,
    awardMode: "auto_tenure",
    order: 4,
  },
  year_5: {
    label: "5 Years with KAvach",
    short: "5 Years",
    tier: "gold",
    emoji: "5",
    stackable: false,
    category: "tenure",
    description: "Completed 5 years as a member of KAvach Cricket Club.",
    criteria: "5+ years since KAvach joining date",
    artworkKey: "year_5",
    active: true,
    awardMode: "auto_tenure",
    order: 5,
  },
  original: {
    label: "KAvach Original",
    short: "Original",
    tier: "gold",
    emoji: "OG",
    stackable: false,
    category: "club",
    description: "Founding-era KAvach Cricket Club member.",
    criteria: "Awarded by Club Admin",
    artworkKey: "original",
    active: true,
    awardMode: "manual",
    order: 6,
  },
  core: {
    label: "KAvach Core",
    short: "Core",
    tier: "gold",
    emoji: "★",
    stackable: false,
    category: "club",
    description: "Core squad contributor and pillar of the club.",
    criteria: "Awarded by Club Admin",
    artworkKey: "core",
    active: true,
    awardMode: "manual",
    order: 7,
  },
  elite: {
    label: "KAvach Elite",
    short: "Elite",
    tier: "diamond",
    emoji: "♛",
    stackable: false,
    category: "club",
    description: "Highest tier of club distinction and commitment.",
    criteria: "Awarded by Club Admin",
    artworkKey: "elite",
    active: true,
    awardMode: "manual",
    order: 8,
  },
  centurion: {
    label: "KAvach Centurion",
    short: "Centurion",
    tier: "diamond",
    emoji: "💯",
    stackable: true,
    category: "performance",
    description: "Scored 100+ runs in a single KAvach match innings.",
    criteria: "100+ runs in a match",
    artworkKey: "centurion",
    active: true,
    awardMode: "manual",
    order: 9,
  },
  hattrick: {
    label: "KAvach Hattrick",
    short: "Hattrick",
    tier: "diamond",
    emoji: "🎯",
    stackable: true,
    category: "performance",
    description: "Claimed three wickets in three consecutive deliveries.",
    criteria: "3 wickets in 3 balls",
    artworkKey: "hattrick",
    active: true,
    awardMode: "manual",
    order: 10,
  },
  "5wh": {
    label: "KAvach 5 Wicket Haul",
    short: "5WH",
    tier: "diamond",
    emoji: "🔥",
    stackable: true,
    category: "performance",
    description: "Claimed 5 or more wickets in a single match innings.",
    criteria: "5+ wickets in an innings",
    artworkKey: "5wh",
    active: true,
    awardMode: "manual",
    order: 11,
  },
  runs_1k: {
    label: "KAvach 1K Run Club",
    short: "1K Runs",
    tier: "bronze",
    emoji: "1K",
    stackable: false,
    category: "milestone",
    description: "Reached 1,000 career runs for KAvach Cricket Club.",
    criteria: "1,000+ career runs",
    artworkKey: "runs_1k",
    active: true,
    awardMode: "auto_stats",
    order: 12,
  },
  runs_2k: {
    label: "KAvach 2K Run Club",
    short: "2K Runs",
    tier: "silver",
    emoji: "2K",
    stackable: false,
    category: "milestone",
    description: "Reached 2,000 career runs for KAvach Cricket Club.",
    criteria: "2,000+ career runs",
    artworkKey: "runs_2k",
    active: true,
    awardMode: "auto_stats",
    order: 13,
  },
  runs_5k: {
    label: "KAvach 5K Run Club",
    short: "5K Runs",
    tier: "gold",
    emoji: "5K",
    stackable: false,
    category: "milestone",
    description: "Reached 5,000 career runs for KAvach Cricket Club.",
    criteria: "5,000+ career runs",
    artworkKey: "runs_5k",
    active: true,
    awardMode: "auto_stats",
    order: 14,
  },
  runs_10k: {
    label: "KAvach 10K Run Club",
    short: "10K Runs",
    tier: "diamond",
    emoji: "10K",
    stackable: false,
    category: "milestone",
    description: "Reached 10,000 career runs for KAvach Cricket Club.",
    criteria: "10,000+ career runs",
    artworkKey: "runs_10k",
    active: true,
    awardMode: "auto_stats",
    order: 15,
  },
  wickets_100: {
    label: "KAvach 100 Wicket Club",
    short: "100 Wkts",
    tier: "silver",
    emoji: "100",
    stackable: false,
    category: "milestone",
    description: "Claimed 100 career wickets for KAvach Cricket Club.",
    criteria: "100+ career wickets",
    artworkKey: "wickets_100",
    active: true,
    awardMode: "auto_stats",
    order: 16,
  },
  wickets_200: {
    label: "KAvach 200 Wicket Club",
    short: "200 Wkts",
    tier: "gold",
    emoji: "200",
    stackable: false,
    category: "milestone",
    description: "Claimed 200 career wickets for KAvach Cricket Club.",
    criteria: "200+ career wickets",
    artworkKey: "wickets_200",
    active: true,
    awardMode: "auto_stats",
    order: 17,
  },
  wickets_300: {
    label: "KAvach 300 Wicket Club",
    short: "300 Wkts",
    tier: "gold",
    emoji: "300",
    stackable: false,
    category: "milestone",
    description: "Claimed 300 career wickets for KAvach Cricket Club.",
    criteria: "300+ career wickets",
    artworkKey: "wickets_300",
    active: true,
    awardMode: "auto_stats",
    order: 18,
  },
  wickets_500: {
    label: "KAvach 500 Wicket Club",
    short: "500 Wkts",
    tier: "diamond",
    emoji: "500",
    stackable: false,
    category: "milestone",
    description: "Claimed 500 career wickets for KAvach Cricket Club.",
    criteria: "500+ career wickets",
    artworkKey: "wickets_500",
    active: true,
    awardMode: "auto_stats",
    order: 19,
  },
  player_of_weekend: {
    label: "Player of the Weekend",
    short: "POTW",
    tier: "gold",
    emoji: "🏆",
    stackable: true,
    category: "special",
    description: "Recognised as KAvach Player of the Weekend.",
    criteria: "Selected via weekly Player of the Weekend workflow",
    artworkKey: "player_of_weekend",
    active: true,
    awardMode: "system_potw",
    order: 20,
  },
};

export function resolveStandardizedBadgeMeta(
  badgeType: string,
  customDefs?: BadgeTypeDef[],
): StandardizedBadgeMeta {
  const builtin = Object.prototype.hasOwnProperty.call(BUILTIN_BADGE_CATALOG, badgeType)
    ? BUILTIN_BADGE_CATALOG[badgeType]
    : undefined;
  const custom = customDefs?.find((d) => d.id === badgeType);

  if (builtin) {
    return {
      id: badgeType,
      label: custom?.label?.trim() || builtin.label,
      short: custom?.short?.trim() || builtin.short,
      tier: custom?.tier ? normalizeBadgeTier(custom.tier) : builtin.tier,
      emoji: custom?.emoji?.trim() || builtin.emoji,
      // Built-in ID, stackability, active status, awardMode, and category are governed by the authoritative catalogue.
      stackable: builtin.stackable,
      category: builtin.category,
      description: custom?.description?.trim() || builtin.description,
      criteria: custom?.criteria?.trim() || builtin.criteria,
      artworkKey: custom?.artworkKey?.trim() || builtin.artworkKey,
      active: true,
      awardMode: builtin.awardMode,
      isBuiltin: true,
      order: typeof custom?.order === "number" ? custom.order : builtin.order,
    };
  }

  if (custom) {
    const label = custom.label?.trim() || formatLegacyBadgeLabel(badgeType);
    return {
      id: badgeType,
      label,
      short: custom.short?.trim() || label.slice(0, 12),
      tier: normalizeBadgeTier(custom.tier),
      emoji: custom.emoji?.trim() || "🏅",
      stackable: Boolean(custom.stackable),
      category: custom.category || "custom",
      description: custom.description?.trim() || "",
      criteria: custom.criteria?.trim() || "",
      artworkKey: custom.artworkKey?.trim() || "custom",
      active: isBadgeTypeActive(custom),
      awardMode: custom.awardMode || "manual",
      isBuiltin: false,
      order: typeof custom.order === "number" ? custom.order : 999,
    };
  }

  // Safe fallback for historical awards whose custom definition is missing/deleted
  const fallbackLabel = formatLegacyBadgeLabel(badgeType);
  return {
    id: badgeType || "unknown",
    label: fallbackLabel,
    short: fallbackLabel.slice(0, 12),
    tier: "bronze",
    emoji: "🏅",
    stackable: false,
    category: "custom",
    description: "",
    criteria: "",
    artworkKey: "custom",
    active: false,
    awardMode: "manual",
    isBuiltin: false,
    order: 999,
  };
}

export const DEFAULT_STACKABLE_BADGES: ReadonlySet<string> = new Set(
  Object.entries(BUILTIN_BADGE_CATALOG)
    .filter(([, meta]) => meta.stackable)
    .map(([id]) => id),
);

export const SYSTEM_AWARDED_BADGES: ReadonlySet<string> = new Set([
  "player_of_weekend",
]);

export function getEligiblePlayersForBadge(
  playerIds: string[],
  badgeType: string,
  existingBadgesByPlayer: ReadonlyMap<string, ReadonlySet<string>>,
  stackableSet: ReadonlySet<string> = DEFAULT_STACKABLE_BADGES,
): { eligible: string[]; skipped: string[] } {
  const seen = new Set<string>();
  const eligible: string[] = [];
  const skipped: string[] = [];

  for (const pid of playerIds) {
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);

    if (SYSTEM_AWARDED_BADGES.has(badgeType)) {
      skipped.push(pid);
      continue;
    }

    if (stackableSet.has(badgeType)) {
      eligible.push(pid);
      continue;
    }

    const existing = existingBadgesByPlayer.get(pid);
    if (existing?.has(badgeType)) {
      skipped.push(pid);
    } else {
      eligible.push(pid);
    }
  }

  return { eligible, skipped };
}

export function getAvailableBadgesForPlayers(
  allBadgeTypes: string[],
  playerIds: string[],
  existingBadgesByPlayer: ReadonlyMap<string, ReadonlySet<string>>,
  stackableSet: ReadonlySet<string> = DEFAULT_STACKABLE_BADGES,
  inactiveBadgeTypes?: ReadonlySet<string>,
): string[] {
  return allBadgeTypes.filter((bt) => {
    if (SYSTEM_AWARDED_BADGES.has(bt)) return false;
    if (inactiveBadgeTypes?.has(bt)) return false;
    if (stackableSet.has(bt)) return true;
    const { eligible } = getEligiblePlayersForBadge(playerIds, bt, existingBadgesByPlayer, stackableSet);
    return eligible.length > 0;
  });
}

export interface BatchAwardPlayer {
  id: string;
  name: string;
}

export async function awardBadgesBatch({
  playerIds,
  badgeType,
  playersById,
  existingBadgesByPlayer,
  stackableSet = DEFAULT_STACKABLE_BADGES,
  awardOne,
  idempotencyKeys,
  createKey = () => crypto.randomUUID(),
}: {
  playerIds: string[];
  badgeType: string;
  playersById: ReadonlyMap<string, BatchAwardPlayer>;
  existingBadgesByPlayer: ReadonlyMap<string, ReadonlySet<string>>;
  stackableSet?: ReadonlySet<string>;
  awardOne: (player: BatchAwardPlayer, key: string) => Promise<string | void>;
  idempotencyKeys?: ReadonlyMap<string, string>;
  createKey?: () => string;
}): Promise<BatchAwardResult> {
  const succeeded: AwardOutcomeItem[] = [];
  const skipped: AwardOutcomeItem[] = [];
  const failed: AwardOutcomeItem[] = [];

  const { eligible, skipped: preSkipped } = getEligiblePlayersForBadge(
    playerIds,
    badgeType,
    existingBadgesByPlayer,
    stackableSet,
  );

  for (const pid of preSkipped) {
    const player = playersById.get(pid);
    skipped.push({
      playerId: pid,
      playerName: player?.name || pid,
      status: "skipped",
      reason: SYSTEM_AWARDED_BADGES.has(badgeType)
        ? "Awarded only via Player of the Weekend workflow"
        : "Already holds this non-stackable badge",
    });
  }

  for (const pid of eligible) {
    const player = playersById.get(pid);
    if (!player) {
      skipped.push({
        playerId: pid,
        playerName: pid,
        status: "skipped",
        reason: "Player record not found",
      });
      continue;
    }

    const key = idempotencyKeys?.get(pid) || createKey();
    try {
      const badgeId = await awardOne(player, key);
      succeeded.push({
        playerId: pid,
        playerName: player.name,
        status: "succeeded",
        idempotencyKey: key,
        ...(typeof badgeId === "string" ? { badgeId } : {}),
      });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      const message = err instanceof Error ? err.message : "Failed to award badge";
      if (status === 409) {
        skipped.push({
          playerId: pid,
          playerName: player.name,
          status: "skipped",
          reason: message,
        });
      } else {
        failed.push({
          playerId: pid,
          playerName: player.name,
          status: "failed",
          reason: message,
          idempotencyKey: key,
        });
      }
    }
  }

  return { badgeType, succeeded, skipped, failed };
}
