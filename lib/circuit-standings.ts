/**
 * Circuit Standings (`lib/circuit-standings.ts`). Pure; shared by the server
 * route, the Admin Club manager and the Player Club card.
 *
 * A standing is the CLUB's own position in a circuit, e.g.
 *   "KAvach is #20 in all-time wins across India with 500 wins".
 * There are exactly four, one per circuit. Source of truth: Firestore
 * `circuitStandings/{circuit}` (doc id = circuit key):
 *   { circuit, rank, value, updatedAt, updatedBy }
 *   - rank:  the club's position in that circuit, integer 1..CIRCUIT_RANK_MAX
 *   - value: wins (Most Wins circuits) or matches played (Most Played circuits),
 *            integer 0..CIRCUIT_VALUE_MAX
 * Written ONLY by PUT/DELETE /api/admin/circuit-standings (Club Admin / Super Admin);
 * Firestore rules deny every client write and allow signed-in reads.
 */

export const CIRCUIT_STANDINGS_COLLECTION = "circuitStandings";
export const CIRCUIT_RANK_MAX = 100_000;
export const CIRCUIT_VALUE_MAX = 100_000;

export const CIRCUITS = [
  { key: "india-wins", scope: "India", metric: "Most Wins", valueLabel: "Wins", unit: ["win", "wins"] },
  { key: "india-played", scope: "India", metric: "Most Played", valueLabel: "Matches played", unit: ["match played", "matches played"] },
  { key: "bangalore-wins", scope: "Bangalore", metric: "Most Wins", valueLabel: "Wins", unit: ["win", "wins"] },
  { key: "bangalore-played", scope: "Bangalore", metric: "Most Played", valueLabel: "Matches played", unit: ["match played", "matches played"] },
] as const;

export type CircuitKey = (typeof CIRCUITS)[number]["key"];
export const CIRCUIT_KEYS: readonly CircuitKey[] = CIRCUITS.map((c) => c.key);

export function circuitInfo(key: string) {
  return CIRCUITS.find((c) => c.key === key) ?? null;
}

export function isCircuitKey(key: unknown): key is CircuitKey {
  return typeof key === "string" && CIRCUIT_KEYS.includes(key as CircuitKey);
}

export interface CircuitStanding {
  circuit: CircuitKey;
  rank: number;
  value: number;
}

export type CircuitStandingValidation = { ok: true; value: CircuitStanding } | { ok: false; error: string };

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

/** Body of PUT: exactly { circuit, rank, value }. */
export function validateCircuitStandingInput(input: unknown): CircuitStandingValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Request body must be an object." };
  const body = input as Record<string, unknown>;
  const unknown = Object.keys(body).filter((k) => !["circuit", "rank", "value"].includes(k));
  if (unknown.length) return { ok: false, error: `Unknown fields: ${unknown.join(", ")}.` };
  if (!isCircuitKey(body.circuit)) return { ok: false, error: "Choose one of the four circuits." };
  const rank = parseWhole(body.rank, "Rank", 1, CIRCUIT_RANK_MAX);
  if (!rank.ok) return rank;
  const value = parseWhole(body.value, circuitInfo(body.circuit)!.valueLabel, 0, CIRCUIT_VALUE_MAX);
  if (!value.ok) return value;
  return { ok: true, value: { circuit: body.circuit, rank: rank.value, value: value.value } };
}

/** Defensive read of a stored standing (doc id must be the circuit key); null when malformed. */
export function readStoredStanding(id: string, data: unknown): CircuitStanding | null {
  if (!isCircuitKey(id) || !data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.circuit !== id) return null;
  if (!Number.isSafeInteger(d.rank) || (d.rank as number) < 1) return null;
  if (!Number.isSafeInteger(d.value) || (d.value as number) < 0) return null;
  return { circuit: id, rank: d.rank as number, value: d.value as number };
}

/** Map circuit → standing (missing circuits absent). */
export function standingsByCircuit(all: CircuitStanding[]): Partial<Record<CircuitKey, CircuitStanding>> {
  const out: Partial<Record<CircuitKey, CircuitStanding>> = {};
  for (const s of all) out[s.circuit] = s;
  return out;
}

export function formatStandingValue(circuit: string, value: number): string {
  const info = circuitInfo(circuit);
  if (!info) return String(value);
  return `${value.toLocaleString("en-IN")} ${value === 1 ? info.unit[0] : info.unit[1]}`;
}

/** "#20 · 500 wins" */
export function formatStanding(s: CircuitStanding): string {
  return `#${s.rank.toLocaleString("en-IN")} · ${formatStandingValue(s.circuit, s.value)}`;
}
