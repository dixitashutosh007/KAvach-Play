import { FieldValue, type Firestore } from "firebase-admin/firestore";

export function formatKavachId(year: number, seq: number): string {
  return `K${year}${String(seq).padStart(3, "0")}`;
}

/**
 * Atomically allocates the next unique Official Player ID (`K<YYYY><NNN>`)
 * inside a Firestore transaction, preserving all existing Player IDs.
 */
export async function allocateNextKavachId(
  db: Firestore,
  {
    year = new Date().getFullYear(),
    playerId,
  }: {
    year?: number;
    playerId?: string;
  } = {},
): Promise<{ kavachId: string; alreadyAssigned: boolean }> {
  const safeYear = Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : new Date().getFullYear();
  const prefix = `K${safeYear}`;
  const counterRef = db.collection("appConfig").doc("kavachIdCounters");

  return db.runTransaction(async (tx) => {
    const playerRef = playerId ? db.collection("players").doc(playerId) : null;
    const [counterSnap, playerSnap] = await Promise.all([
      tx.get(counterRef),
      playerRef ? tx.get(playerRef) : Promise.resolve(null),
    ]);

    if (playerSnap) {
      if (!playerSnap.exists) {
        throw new Error("Player not found.");
      }
      const existingId = playerSnap.data()?.kavachId;
      if (typeof existingId === "string" && existingId.trim()) {
        return { kavachId: existingId.trim(), alreadyAssigned: true };
      }
    }

    const counters = counterSnap.exists ? (counterSnap.data() as Record<string, unknown>) : {};
    let maxSeq = typeof counters[String(safeYear)] === "number" ? Number(counters[String(safeYear)]) : 0;

    // Seed from existing player docs once if counter for this year hasn't been initialized
    if (maxSeq === 0) {
      const existingPlayers = await tx.get(
        db.collection("players").where("kavachId", ">=", prefix).where("kavachId", "<", `K${safeYear + 1}`),
      );
      for (const docSnap of existingPlayers.docs) {
        const kid = String(docSnap.data()?.kavachId || "");
        if (kid.startsWith(prefix)) {
          const parsed = parseInt(kid.slice(prefix.length), 10);
          if (Number.isFinite(parsed) && parsed > maxSeq) {
            maxSeq = parsed;
          }
        }
      }
    }

    let nextSeq = maxSeq + 1;
    let candidateId = formatKavachId(safeYear, nextSeq);

    // Ensure reservation doc does not collide with any previously reserved/legacy ID
    for (let attempts = 0; attempts < 50; attempts++) {
      const resRef = db.collection("kavachIdReservations").doc(candidateId);
      const resSnap = await tx.get(resRef);
      if (!resSnap.exists) {
        tx.set(
          counterRef,
          { [String(safeYear)]: nextSeq, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
        tx.create(resRef, {
          kavachId: candidateId,
          year: safeYear,
          seq: nextSeq,
          playerId: playerId || null,
          allocatedAt: FieldValue.serverTimestamp(),
        });
        if (playerRef) {
          tx.update(playerRef, {
            kavachId: candidateId,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        return { kavachId: candidateId, alreadyAssigned: false };
      }
      nextSeq += 1;
      candidateId = formatKavachId(safeYear, nextSeq);
    }

    throw new Error("Could not allocate a unique Player ID.");
  });
}
