import { NextResponse } from "next/server";
import { getServerFirestore } from "@/lib/server-db";

const SEED_MAP: Record<string, string> = {
  "K2022001": "AD",
  "K2022002": "Laxmi MD",
  "K2022003": "Shivam Pandey",
  "K2022004": "Aman",
  "K2022005": "Kaustav",
};

export async function POST(req: Request) {
  try {
    const { requireClubAdmin } = await import("@/lib/server-auth");
    const guard = await requireClubAdmin(req);
    if (!guard.ok) return guard.response;

    const db = getServerFirestore();

    const playersSnap = await db.collection("players").get();
    const players = playersSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    // Build reverse seed map: name (lowercase) → kavachId
    const seedByName: Record<string, string> = {};
    for (const [kid, name] of Object.entries(SEED_MAP)) {
      seedByName[name.toLowerCase()] = kid;
    }

    // Track used IDs to avoid collisions
    const usedIds = new Set<string>();

    // First pass: assign seeded IDs
    const assignments: { docId: string; kavachId: string; name: string }[] = [];

    for (const p of players) {
      const existing = (p as any).kavachId;
      if (existing) {
        usedIds.add(existing);
        continue;
      }

      const pName = ((p as any).name || "").trim();
      const seeded = seedByName[pName.toLowerCase()];
      if (seeded && !usedIds.has(seeded)) {
        assignments.push({ docId: p.id, kavachId: seeded, name: pName });
        usedIds.add(seeded);
      }
    }

    // Second pass: assign IDs to remaining players without kavachId
    // Group by joining year
    const remaining = players.filter(
      (p) => !(p as any).kavachId && !assignments.find((a) => a.docId === p.id),
    );

    // Determine year for each player
    function getYear(p: any): number {
      if (p.kavachJoining) {
        const y = new Date(p.kavachJoining).getFullYear();
        if (y >= 2000 && y <= 2100) return y;
      }
      if (p.createdAt) {
        const ts =
          typeof p.createdAt === "string"
            ? new Date(p.createdAt)
            : p.createdAt.toDate
              ? p.createdAt.toDate()
              : new Date(p.createdAt);
        const y = ts.getFullYear();
        if (y >= 2000 && y <= 2100) return y;
      }
      return 2026;
    }

    // Count existing IDs per year
    const yearCounters: Record<number, number> = {};
    for (const kid of usedIds) {
      const match = kid.match(/^K(\d{4})(\d{3})$/);
      if (match) {
        const y = parseInt(match[1]);
        const seq = parseInt(match[2]);
        yearCounters[y] = Math.max(yearCounters[y] || 0, seq);
      }
    }

    // Sort remaining by createdAt so earlier joiners get lower numbers
    remaining.sort((a: any, b: any) => {
      const aTime = a.createdAt?.toDate?.() || new Date(a.createdAt || "2026-01-01");
      const bTime = b.createdAt?.toDate?.() || new Date(b.createdAt || "2026-01-01");
      return aTime.getTime() - bTime.getTime();
    });

    for (const p of remaining) {
      const year = getYear(p);
      yearCounters[year] = (yearCounters[year] || 0) + 1;
      const seq = yearCounters[year];
      const kavachId = `K${year}${String(seq).padStart(3, "0")}`;
      assignments.push({
        docId: p.id,
        kavachId,
        name: (p as any).name || "Unknown",
      });
      usedIds.add(kavachId);
    }

    // Write all assignments to Firestore
    const batch = db.batch();
    for (const a of assignments) {
      batch.update(db.collection("players").doc(a.docId), {
        kavachId: a.kavachId,
      });
    }
    await batch.commit();

    return NextResponse.json({
      success: true,
      assigned: assignments.length,
      details: assignments.map((a) => ({
        name: a.name,
        kavachId: a.kavachId,
      })),
    });
  } catch (error: any) {
    console.error("Error generating KAvach IDs:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
