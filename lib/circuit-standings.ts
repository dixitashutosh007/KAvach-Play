/**
 * Club Rankings (`lib/circuit-standings.ts`). Pure; shared by the server
 * route, the Admin Club manager and the Player Club Stats window.
 *
 * Active rankings are strictly two:
 *   - `bangalore`: Ranking in Bangalore
 *   - `india`: Ranking in India
 *
 * Backward compatibility: legacy four-category keys (`bangalore-wins`,
 * `bangalore-played`, `india-wins`, `india-played`) are still read defensively
 * if the new `bangalore` / `india` doc has not been saved yet, without
 * deleting historical documents.
 *
 * Written ONLY by PUT/DELETE /api/admin/circuit-standings (Club Admin / Super Admin);
 * Firestore rules deny every client write and allow signed-in reads.
 */

export const CIRCUIT_STANDINGS_COLLECTION = "circuitStandings";
export const CIRCUIT_RANK_MAX = 100_000;
export const CIRCUIT_VALUE_MAX = 100_000;

export const CIRCUITS = [
  { key: "bangalore", scope: "Bangalore", metric: "Ranking in Bangalore", valueLabel: "Matches", unit: ["match", "matches"] },
  { key: "india", scope: "India", metric: "Ranking in India", valueLabel: "Matches", unit: ["match", "matches"] },
] as const;

export const LEGACY_CIRCUIT_KEYS = [
  "india-wins",
  "india-played",
  "bangalore-wins",
  "bangalore-played",
] as const;

export type CircuitKey = (typeof CIRCUITS)[number]["key"];
export type AnyStoredCircuitKey = CircuitKey | (typeof LEGACY_CIRCUIT_KEYS)[number];
export const CIRCUIT_KEYS: readonly CircuitKey[] = CIRCUITS.map((c) => c.key);

export function circuitInfo(key: string) {
  return CIRCUITS.find((c) => c.key === key) ?? null;
}

export function isCircuitKey(key: unknown): key is CircuitKey {
  return typeof key === "string" && CIRCUIT_KEYS.includes(key as CircuitKey);
}

export function isStoredCircuitKey(key: unknown): key is AnyStoredCircuitKey {
  return (
    isCircuitKey(key) ||
    (typeof key === "string" && (LEGACY_CIRCUIT_KEYS as readonly string[]).includes(key))
  );
}

export interface CircuitStanding {
  circuit: AnyStoredCircuitKey;
  rank: number | null;
  value: number;
  cleared?: boolean;
}

export type CircuitStandingValidation =
  | { ok: true; value: { circuit: CircuitKey; rank: number; value: number } }
  | { ok: false; error: string };

function parseWhole(
  raw: unknown,
  label: string,
  min: number,
  max: number,
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!/^\d+$/.test(t)) return { ok: false, error: `${label} must be a whole number.` };
    raw = Number(t);
  }
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
    return { ok: false, error: `${label} must be a whole number.` };
  }
  if (raw < min) return { ok: false, error: `${label} must be at least ${min}.` };
  if (raw > max) return { ok: false, error: `${label} cannot be more than ${max}.` };
  return { ok: true, value: raw };
}

/** Body of PUT: { circuit, rank, value? }. `value` is optional and defaults to 0. */
export function validateCircuitStandingInput(input: unknown): CircuitStandingValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Request body must be an object." };
  }
  const body = input as Record<string, unknown>;
  const unknown = Object.keys(body).filter((k) => !["circuit", "rank", "value"].includes(k));
  if (unknown.length) return { ok: false, error: `Unknown fields: ${unknown.join(", ")}.` };
  if (!isCircuitKey(body.circuit)) return { ok: false, error: "Choose Bangalore or India." };
  const rank = parseWhole(body.rank, "Rank", 1, CIRCUIT_RANK_MAX);
  if (!rank.ok) return rank;
  const rawValue = body.value === undefined || body.value === null || body.value === "" ? 0 : body.value;
  const value = parseWhole(rawValue, "Value", 0, CIRCUIT_VALUE_MAX);
  if (!value.ok) return value;
  return { ok: true, value: { circuit: body.circuit, rank: rank.value, value: value.value } };
}

/** Defensive read of a stored standing (active, cleared tombstone, or legacy doc id); null when malformed. */
export function readStoredStanding(id: string, data: unknown): CircuitStanding | null {
  if (!isStoredCircuitKey(id) || !data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.circuit !== id) return null;
  if (isCircuitKey(id) && d.cleared === true) {
    return { circuit: id, rank: null, value: 0, cleared: true };
  }
  if (!Number.isSafeInteger(d.rank) || (d.rank as number) < 1) return null;
  const value = Number.isSafeInteger(d.value) && (d.value as number) >= 0 ? (d.value as number) : 0;
  return { circuit: id, rank: d.rank as number, value };
}

/** Legacy fallback keys per canonical ranking key (ordered by precedence). */
export const LEGACY_FALLBACK_KEYS: Record<CircuitKey, readonly AnyStoredCircuitKey[]> = {
  bangalore: ["bangalore-wins", "bangalore-played"],
  india: ["india-wins", "india-played"],
};

/**
 * Map stored standings to the two active ranking keys (`bangalore`, `india`):
 * - If canonical doc has `cleared: true`, suppress legacy fallback (returns undefined).
 * - If canonical doc has a rank, return canonical value.
 * - Otherwise fall back to legacy `-wins` then `-played` records.
 */
export function standingsByCircuit(all: CircuitStanding[]): Partial<Record<CircuitKey, CircuitStanding>> {
  const byRaw = new Map<string, CircuitStanding>();
  for (const s of all) byRaw.set(s.circuit, s);

  const out: Partial<Record<CircuitKey, CircuitStanding>> = {};
  for (const key of CIRCUIT_KEYS) {
    const canonical = byRaw.get(key);
    if (canonical?.cleared) {
      continue;
    }
    if (canonical && canonical.rank !== null) {
      out[key] = canonical;
      continue;
    }
    for (const legacyKey of LEGACY_FALLBACK_KEYS[key]) {
      const legacy = byRaw.get(legacyKey);
      if (legacy && legacy.rank !== null) {
        out[key] = { ...legacy, circuit: key };
        break;
      }
    }
  }
  return out;
}

export function formatStanding(s: CircuitStanding): string {
  if (s.cleared || s.rank === null) return "";
  return `#${s.rank.toLocaleString("en-IN")}`;
}
