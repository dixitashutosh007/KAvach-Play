import { NextRequest, NextResponse } from "next/server";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "@/firebase-applet-config.json";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  const expectedSecret = process.env.REPORT_API_SECRET || process.env.API_SECRET;

  if (!expectedSecret) {
    return NextResponse.json({ error: "Server error: API Secret is not set." }, { status: 500 });
  }

  if (secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized. Invalid secret." }, { status: 401 });
  }

  try {
    const apps = getApps();
    const app = apps.length ? apps[0] : initializeApp({ projectId: firebaseConfig.projectId });
    const dbId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || (firebaseConfig as any).firestoreDatabaseId;
    let db;
    try { db = getFirestore(app, dbId); } catch { db = getFirestore(app); }

    const [playersSnap, matchesSnap, paymentsSnap, appConfigSnap] = await Promise.all([
      db.collection("players").get(),
      db.collection("matches").get(),
      db.collectionGroup("payments").get(),
      db.collection("appConfig").doc("default").get()
    ]);

    const appConfig = appConfigSnap.data() || {};
    const emailEnabled = appConfig.emailAutomationEnabled !== false; // Default true

    const playersMap = new Map<string, any>();
    playersSnap.forEach((d) => playersMap.set(d.id, { id: d.id, name: d.data().name, email: d.data().email, mobile: d.data().mobile }));
    const matchesMap = new Map<string, any>();
    matchesSnap.forEach((d) => matchesMap.set(d.id, { id: d.id, opponent: d.data().opponent, fee: d.data().fee || 0, date: d.data().date }));

    const playerDues = new Map<string, { player: any, totalDue: number, dues: { desc: string, amount: number }[] }>();

    const unpaidPayments = paymentsSnap.docs.map(d => d.data()).filter(p => p.status === "Unpaid");
    for (const payment of unpaidPayments) {
      if (!payment.playerId || !payment.matchId) continue;
      const player = playersMap.get(payment.playerId);
      const match = matchesMap.get(payment.matchId);
      if (!player || !match) continue;
      
      if (!playerDues.has(player.id)) playerDues.set(player.id, { player, totalDue: 0, dues: [] });
      const entry = playerDues.get(player.id)!;
      entry.totalDue += match.fee;
      entry.dues.push({ desc: `Match vs ${match.opponent} (${match.date})`, amount: match.fee });
    }

    const playersToRemind = Array.from(playerDues.values()).filter(d => d.totalDue > 0 && (emailEnabled && d.player.email));
    const origin = req.nextUrl.origin;
    let emailSent = 0;
    let failed = 0;

    for (const data of playersToRemind) {
      const link = `${origin}/pay/${data.player.id}`;
      let successForPlayer = false;

      // Email
      if (emailEnabled && data.player.email) {
        const reminderTemplate = appConfig.emailTemplates?.due_reminder || {
          subject: "Pending Match Fee Reminder - {{clubName}}",
          body: "Hi {{playerName}},\n\nThis is a friendly reminder that you have an outstanding fee of {{amount}} for: {{duesText}}.\n\nPlease log in to clear your dues at your earliest convenience using this link: {{link}}\n\nBest regards,\n{{clubName}} Admin Team",
        };
        
        const renderTpl = (txt: string) => {
          return txt
            .replace(/{{clubName}}/g, appConfig.clubName || "Kavach Play")
            .replace(/{{playerName}}/g, data.player.name || "Player")
            .replace(/{{amount}}/g, `₹${data.totalDue}`)
            .replace(/{{duesText}}/g, data.dues.map((d: any) => `${d.desc} (₹${d.amount})`).join(", "))
            .replace(/{{link}}/g, link);
        };

        try {
          const res = await fetch(`${origin}/api/email/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: [data.player.email],
              subject: renderTpl(reminderTemplate.subject),
              text: renderTpl(reminderTemplate.body),
              config: appConfig,
            })
          });
          if (res.ok) {
            emailSent++;
            successForPlayer = true;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }
      
      // If we failed both but they were enabled, we count as failures. (Handled above per-channel)
    }

    return NextResponse.json({ success: true, processed: playersToRemind.length, emailSent, failed });

  } catch (err: any) {
    console.error("Match Fee Reminder Error", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
