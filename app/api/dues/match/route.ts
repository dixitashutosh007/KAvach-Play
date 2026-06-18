import { NextRequest, NextResponse } from "next/server";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "@/firebase-applet-config.json";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  const expectedSecret = process.env.REPORT_API_SECRET;

  if (!expectedSecret) {
    return new NextResponse("Server configuration error: REPORT_API_SECRET is not set in environment variables.", { status: 500 });
  }

  if (secret !== expectedSecret) {
    return new NextResponse("Unauthorized. Invalid secret.", { status: 401 });
  }

  try {
    const apps = getApps();
    const app = apps.length ? apps[0] : initializeApp({ projectId: firebaseConfig.projectId });
    const dbId = (firebaseConfig as any).firestoreDatabaseId;
    
    let db;
    try {
      db = getFirestore(app, dbId);
    } catch {
      db = getFirestore(app);
    }

    const [playersSnap, matchesSnap, paymentsSnap] = await Promise.all([
      db.collection("players").get(),
      db.collection("matches").get(),
      db.collectionGroup("payments").get(),
    ]);

    type Player = { id: string; name: string; mobile?: string };
    type Match = { id: string; opponent: string; fee: number; date: string };
    type MatchPayment = { id: string; matchId: string; playerId: string; guestName?: string; status: string };

    const playersMap = new Map<string, Player>();
    playersSnap.forEach((d) => playersMap.set(d.id, { id: d.id, name: d.data().name, mobile: d.data().mobile }));

    const matchesMap = new Map<string, Match>();
    matchesSnap.forEach((d) => {
      const data = d.data();
      matchesMap.set(d.id, { id: d.id, opponent: data.opponent, fee: data.fee || 0, date: data.date });
    });

    const unpaidPayments = paymentsSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as MatchPayment))
      .filter(p => p.status === "Unpaid");

    // Group by player
    const playerDues = new Map<string, { params: Player; total: number; breakdown: string[] }>();

    playersMap.forEach((player) => {
      playerDues.set(player.id, { params: player, total: 0, breakdown: [] });
    });

    for (const payment of unpaidPayments) {
      const match = matchesMap.get(payment.matchId);
      if (!match) continue;

      const player = playersMap.get(payment.playerId);
      if (!player) continue;

      const entry = playerDues.get(player.id)!;
      const amount = match.fee;
      entry.total += amount;

      const guestStr = payment.guestName ? ` (Guest: ${payment.guestName})` : "";
      
      // format date nicely if it's YYYY-MM-DD
      let dateString = match.date;
      try {
        const d = new Date(match.date);
        dateString = d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
      } catch (e) {}

      entry.breakdown.push(`  Match vs ${match.opponent} (${dateString})${guestStr}: Rs ${amount}`);
    }

    let reportText = `🚨 *Match Fee Due Report* 🚨\n`;
    reportText += `_Generated on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}_\n\n`;

    // Sort players by total due descending
    const sortedPlayers = Array.from(playerDues.values())
      .filter(p => p.total > 0)
      .sort((a, b) => b.total - a.total);

    if (sortedPlayers.length === 0) {
      reportText += `✅ All match dues are cleared!\n`;
    } else {
      let playerNumber = 1;
      for (const p of sortedPlayers) {
        const cleanMobile = p.params.mobile ? p.params.mobile.replace(/[^\d+]/g, '') : '';
        const playerTag = cleanMobile ? `*${p.params.name}* (@${cleanMobile})` : `*${p.params.name}*`;
        reportText += `${playerNumber}. ${playerTag}\n`;
        for (const item of p.breakdown) {
          reportText += `${item}\n`;
        }
        reportText += `\n`;
        playerNumber++;
      }
      reportText += `💡 *Please clear your match dues as soon as possible.*\n`;
      reportText += `⚠️ Post Tuesday 9 PM, we will be adding 150 rs towards the late charges.\n`;
      reportText += `🔗 Login to make payment: https://play.kavachcricket.com\n`;
    }

    return new NextResponse(reportText, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });

  } catch (err: any) {
    console.error("API Error", err);
    return new NextResponse(`Error generating report: ${err.message}`, { status: 500 });
  }
}
