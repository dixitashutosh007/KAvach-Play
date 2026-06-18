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
    const dbId = (firebaseConfig as any).firestoreDatabaseId;
    let db;
    try { db = getFirestore(app, dbId); } catch { db = getFirestore(app); }

    const [playersSnap, otherFeesSnap, appConfigSnap] = await Promise.all([
      db.collection("players").get(),
      db.collectionGroup("otherFees").get(),
      db.collection("appConfig").doc("default").get()
    ]);

    const appConfig = appConfigSnap.data() || {};
    const playersMap = new Map<string, any>();
    playersSnap.forEach((d) => playersMap.set(d.id, { id: d.id, name: d.data().name, email: d.data().email }));

    const playerDues = new Map<string, { player: any, totalDue: number, dues: { desc: string, amount: number }[] }>();

    const unpaidOtherFees = otherFeesSnap.docs.map(d => d.data()).filter(p => p.status === "Unpaid");
    for (const fee of unpaidOtherFees) {
      if (!fee.playerId) continue;
      const player = playersMap.get(fee.playerId);
      if (!player) continue;

      const title = fee.title?.toLowerCase() || "";
      const isNoShow = title.includes("no show") || title.includes("noshow");
      if (isNoShow) continue;

      if (!playerDues.has(player.id)) playerDues.set(player.id, { player, totalDue: 0, dues: [] });
      const entry = playerDues.get(player.id)!;
      const amount = Number(fee.amount) || 0;
      entry.totalDue += amount;
      entry.dues.push({ desc: fee.title, amount });
    }

    const playersToEmail = Array.from(playerDues.values()).filter(d => !!d.player.email && d.totalDue > 0);
    const origin = req.nextUrl.origin;
    let sent = 0;
    let failed = 0;

    for (const data of playersToEmail) {
      const link = `${origin}/pay/${data.player.id}`;
      const reminderTemplate = appConfig.emailTemplates?.due_reminder || {
        subject: "Pending Fee Reminder - {{clubName}}",
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
        if (res.ok) sent++;
        else failed++;
      } catch {
        failed++;
      }
    }

    return NextResponse.json({ success: true, processed: playersToEmail.length, sent, failed });

  } catch (err: any) {
    console.error("Other Fee Reminder Error", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
