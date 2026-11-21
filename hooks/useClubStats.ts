"use client";

/**
 * Live read of the admin-maintained club totals (`appConfig/clubStats`).
 * One small document; subscribed only by the components that show it.
 */
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { handleFirestoreError, OperationType } from "@/lib/errorHandling";
import {
  CLUB_STATS_COLLECTION,
  CLUB_STATS_DOC_ID,
  readStoredClubStats,
  type ClubStatsValues,
} from "@/lib/club-stats";

export interface ClubStatsState {
  stats: ClubStatsValues | null;
  updatedAt: Date | null;
  loading: boolean;
  error: boolean;
}

export function useClubStats(): ClubStatsState {
  const [state, setState] = useState<ClubStatsState>({ stats: null, updatedAt: null, loading: true, error: false });

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, CLUB_STATS_COLLECTION, CLUB_STATS_DOC_ID),
      (snap) => {
        const data = snap.exists() ? snap.data() : null;
        const ts = data?.updatedAt;
        setState({
          stats: readStoredClubStats(data),
          updatedAt: ts && typeof ts.toDate === "function" ? ts.toDate() : null,
          loading: false,
          error: false,
        });
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, `${CLUB_STATS_COLLECTION}/${CLUB_STATS_DOC_ID}`);
        setState((s) => ({ ...s, loading: false, error: true }));
      },
    );
    return unsub;
  }, []);

  return state;
}
