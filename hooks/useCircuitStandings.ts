"use client";

/**
 * Live read of the admin-maintained Circuit Standings (`circuitStandings`).
 * A small collection (four circuits, a handful of ranked players each); subscribed
 * only by the components that show it. Malformed records are dropped, never shown.
 */
import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { handleFirestoreError, OperationType } from "@/lib/errorHandling";
import { CIRCUIT_STANDINGS_COLLECTION, readStoredStanding, type CircuitStanding } from "@/lib/circuit-standings";

export interface CircuitStandingsState {
  standings: CircuitStanding[];
  loading: boolean;
  error: boolean;
}

/** e2e synthetic sessions only; never present in production builds. */
function testStandings(): unknown[] | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const ts = (window as any).__KAVACH_TEST_STORE__;
  return ts && Array.isArray(ts.circuitStandings) ? ts.circuitStandings : null;
}

function parseAll(rows: { id: string; data: unknown }[]): CircuitStanding[] {
  return rows.map((r) => readStoredStanding(r.id, r.data)).filter((s): s is CircuitStanding => s !== null);
}

export function useCircuitStandings(): CircuitStandingsState {
  const [state, setState] = useState<CircuitStandingsState>({ standings: [], loading: true, error: false });

  useEffect(() => {
    const fake = testStandings();
    if (fake) {
      const read = () => setState({ standings: parseAll((testStandings() || []).map((d: any) => ({ id: d.id, data: d }))), loading: false, error: false });
      read();
      window.addEventListener("kavach:test:circuit-standings", read);
      return () => window.removeEventListener("kavach:test:circuit-standings", read);
    }
    const unsub = onSnapshot(
      collection(db, CIRCUIT_STANDINGS_COLLECTION),
      (snap) => setState({ standings: parseAll(snap.docs.map((d) => ({ id: d.id, data: d.data() }))), loading: false, error: false }),
      (err) => {
        handleFirestoreError(err, OperationType.LIST, CIRCUIT_STANDINGS_COLLECTION);
        setState((s) => ({ ...s, loading: false, error: true }));
      },
    );
    return unsub;
  }, []);

  return state;
}
