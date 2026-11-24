/**
 * Circuit Standings (`lib/circuit-standings.ts`). Pure; shared by the server
 * route, the Admin Club manager and the Player Club card.
 *
 * Source of truth: admin-maintained records in Firestore `circuitStandings`,
 * one document per (circuit, player): id `${circuit}__${playerId}`, so a player
 * cannot appear twice in the same circuit. Records are written ONLY by
 * POST/PUT/DELETE /api/admin/circuit-standings (Club Admin / Super Admin);
 * Firestore rules deny every client write and allow signed-in reads.
 *
 * Stored shape:
 *   { circuit, playerId, playerName, rank, value, asOf, updatedAt, updatedBy }
 *   - circuit:    one of CIRCUIT_KEYS
 *   - playerId:   players/{playerId} (active, not merged) — never a Firebase UID
 *   - playerName: snapshot of players/{playerId}.name taken by the server on save
 *   - rank:       position in that circuit, integer 1..CIRCUIT_RANK_MAX (ties allowed)
 *   - value:      the circuit's metric — wins (Most Wins) or matches played (Most Played),
 *                 integer 0..CIRCUIT_VALUE_MAX
 *   - asOf:       date the standing was taken from the circuit, "YYYY-MM-DD"
 */

export const CIRCUIT_STANDINGS_COLLECTION = "circuitStandings";
export const CIRCUIT_RANK_MAX = 999;
export const CIRCUIT_VALUE_MAX = 10_000;

export const CIRCUITS = [
  { key: "india-wins", scope: "India", metric: "Most Wins", valueLabel: "Wins", unit: ["win", "wins"] },
  { key: "india-played", scope: "India", metric: "Most Played", valueLabel: "Matches played", unit: ["match", "matches"] },
  { key: "bangalore-wins", scope: "Bangalore", metric: "Most Wins", valueLabel: "Wins", unit: ["win", "wins"] },
  { key: "bangalore-played", scope: "Bangalore", metric: "Most Played", valueLabel: "Matches played", unit: ["match", "matches"] },
] as const;

export type CircuitKey = (typeof CIRCUITS)[number]["key"];
export const CIRCUIT_KEYS: readonly CircuitKey[] = CIRCUITS.map((c) => c.key);

export function circuitInfo(key: string) {
  return CIRCUITS.find((c) => c.key === key) ?? null;
}

export interface CircuitStandingInput {
  circuit: CircuitKey;
  playerId: string;
  rank: number;
  value: number;
  asOf: string;
}

export interface CircuitStanding extends CircuitStandingInput {
  id: string;
  playerName: string;
}

export type CircuitStandingValidation = { ok: true; value: CircuitStandingInput } | { ok: false; error: string };

const ALLOWED_KEYS = ["circuit", "playerId", "rank", "value", "asOf"];

export function standingDocId(circuit: string, playerId: string): string {
  return `${circuit}__${playerId}`;
}

function parseWhole(raw: unknown, label: string, min: number, max: number): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!/^\d+$/.test(t)) return { ok: false, error: `${label} must be a whole number.` };
    raw = Number(t);
  }
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) return { ok: false, error: `${label} must be a whole number.` };
  if (raw < min) return { ok: false, error: `${label} must be at least ${min}.` };
  if (raw > max) return { ok: false, error: `${label} cannot be more than ${max}.` };
  return { ok: true, value: raw };
}

/** Valid calendar date "YYYY-MM-DD", not later than `today` (same format). */
export function isValidAsOf(raw: unknown, today: string): raw is string {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const [y, m, d] = raw.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
  if (y < 2000) return false;
  return raw <= today;
}

/** Today's date in the club's timezone (Asia/Kolkata) as "YYYY-MM-DD". */
export function clubToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const PLAYER_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function validateCircuitStandingInput(input: unknown, today: string = clubToday()): CircuitStandingValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Request body must be an object." };
  const body = input as Record<string, unknown>;
  const unknown = Object.keys(body).filter((k) => !ALLOWED_KEYS.includes(k));
  if (unknown.length) return { ok: false, error: `Unknown fields: ${unknown.join(", ")}.` };

  if (typeof body.circuit !== "string" || !CIRCUIT_KEYS.includes(body.circuit as CircuitKey)) return { ok: false, error: "Choose one of the four circuits." };
  if (typeof body.playerId !== "string" || !PLAYER_ID_RE.test(body.playerId)) return { ok: false, error: "Choose a player." };
  const rank = parseWhole(body.rank, "Rank", 1, CIRCUIT_RANK_MAX);
  if (!rank.ok) return rank;
  const info = circuitInfo(body.circuit)!;
  const value = parseWhole(body.value, info.valueLabel, 0, CIRCUIT_VALUE_MAX);
  if (!value.ok) return value;
  if (!isValidAsOf(body.asOf, today)) return { ok: false, error: "As-of date must be a real date, not in the future." };

  return { ok: true, value: { circuit: body.circuit as CircuitKey, playerId: body.playerId, rank: rank.value, value: value.value, asOf: body.asOf as string } };
}

/** Defensive read of a stored record; null when malformed (never displayed). */
export function readStoredStanding(id: string, data: unknown): CircuitStanding | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.circuit !== "string" || !CIRCUIT_KEYS.includes(d.circuit as CircuitKey)) return null;
  if (typeof d.playerId !== "string" || !d.playerId) return null;
  if (!Number.isSafeInteger(d.rank) || (d.rank as number) < 1) return null;
  if (!Number.isSafeInteger(d.value) || (d.value as number) < 0) return null;
  if (typeof d.asOf !== "string") return null;
  return {
    id,
    circuit: d.circuit as CircuitKey,
    playerId: d.playerId,
    playerName: typeof d.playerName === "string" && d.playerName ? d.playerName : "Player",
    rank: d.rank as number,
    value: d.value as number,
    asOf: d.asOf,
  };
}

/** Records of one circuit, best rank first (ties: higher value, then name). */
export function standingsFor(all: CircuitStanding[], circuit: CircuitKey): CircuitStanding[] {
  return all
    .filter((s) => s.circuit === circuit)
    .sort((a, b) => a.rank - b.rank || b.value - a.value || a.playerName.localeCompare(b.playerName));
}

export function formatStandingValue(circuit: string, value: number): string {
  const info = circuitInfo(circuit);
  if (!info) return String(value);
  return `${value} ${value === 1 ? info.unit[0] : info.unit[1]}`;
}

/** "12 Nov 2026" from "2026-11-12" (no timezone shift). */
export function formatAsOf(asOf: string): string {
  const [y, m, d] = asOf.split("-").map(Number);
  if (!y || !m || !d) return asOf;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}

/** A player may be chosen for a standing only while active and not merged. */
export function isSelectablePlayer(p: { disabled?: unknown; mergedInto?: unknown; mergeStatus?: unknown } | null | undefined): boolean {
  return Boolean(p) && p!.disabled !== true && !p!.mergedInto && p!.mergeStatus !== "in_progress";
}
