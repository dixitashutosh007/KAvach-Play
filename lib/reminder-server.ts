import type { Firestore } from "firebase-admin/firestore";
import { calculatePlayerDues } from "./player-dues.ts";
import type { Match, MatchPayment, OtherFee, Player } from "./types.ts";

export interface AuthorizedReminderPayload {
  ok: true;
  playerId: string;
  playerName: string;
  amount: number;
  duesText: string;
  link: string;
  email?: string;
  mobile?: string;
  subject?: string;
  text?: string;
  appConfig: Record<string, any>;
}

export type AuthorizedReminderResult =
  | AuthorizedReminderPayload
  | { ok: false; status: number; error: string };

const DEFAULT_DUE_REMINDER_TEMPLATE = {
  subject: "Payment Reminder: ₹{{amount}} Pending — {{clubName}}",
  body: "Hi {{playerName}},\n\nYou have pending club dues of ₹{{amount}} ({{duesText}}).\nPlease pay here: {{link}}\n\nThanks,\n{{clubName}}",
};

export async function resolveAuthorizedDueReminder(
  db: Firestore,
  {
    playerId,
    channel,
    origin,
  }: {
    playerId: unknown;
    channel: "email" | "whatsapp";
    origin: string;
  },
): Promise<AuthorizedReminderResult> {
  if (
    typeof playerId !== "string" ||
    !playerId.trim() ||
    playerId.includes("/") ||
    playerId === "." ||
    playerId === ".."
  ) {
    return { ok: false, status: 400, error: "Valid playerId is required for due reminders." };
  }

  const pid = playerId.trim();
  const [playerSnap, paymentsSnap, otherFeesSnap, appConfigSnap] = await Promise.all([
    db.collection("players").doc(pid).get(),
    db.collection("payments").where("playerId", "==", pid).get(),
    db.collection("otherFees").where("playerId", "==", pid).get(),
    db.collection("appConfig").doc("default").get(),
  ]);

  if (!playerSnap.exists) {
    return { ok: false, status: 404, error: "Target player record not found." };
  }

  const player = { id: playerSnap.id, ...(playerSnap.data() as any) } as Player;
  if (player.disabled || player.mergedInto) {
    return { ok: false, status: 400, error: "Cannot send reminder to a disabled or merged player." };
  }

  const playerPayments = paymentsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as MatchPayment[];
  const playerOtherFees = otherFeesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as OtherFee[];

  const matchIds = Array.from(
    new Set(playerPayments.map((p) => p.matchId).filter((id): id is string => Boolean(id))),
  );
  const matchSnaps = await Promise.all(
    matchIds.map((mid) => db.collection("matches").doc(mid).get()),
  );
  const matches = matchSnaps
    .filter((s) => s.exists)
    .map((s) => ({ id: s.id, ...(s.data() as any) })) as Match[];

  const dues = calculatePlayerDues([player], playerPayments, matches, playerOtherFees);
  if (!dues.hasDues || dues.totalDue <= 0) {
    return { ok: false, status: 400, error: "Player has no verified outstanding dues." };
  }

  const appConfig = appConfigSnap.exists ? (appConfigSnap.data() as Record<string, any>) : {};
  const clubName = String(appConfig.clubName || "KAvach Play");
  const playerName = String(player.name || "Player");
  const link = `${origin.replace(/\/$/, "")}/pay/${pid}`;

  const duesParts = [
    ...dues.billableMatchPayments.map((item) => `vs ${item.match.opponent || "Match"} (₹${item.fee})`),
    ...dues.unpaidOtherFees.map((f) => `${f.title || "Fee"} (₹${f.amount})`),
  ];
  const duesText = duesParts.join(", ") || `₹${dues.totalDue} pending`;

  if (channel === "email") {
    const email = typeof player.email === "string" ? player.email.trim() : "";
    if (!email || !email.includes("@")) {
      return { ok: false, status: 400, error: "Target player does not have a valid email address." };
    }
    const tpl = appConfig.emailTemplates?.due_reminder || DEFAULT_DUE_REMINDER_TEMPLATE;
    const render = (s: string) =>
      String(s || "")
        .replace(/{{clubName}}/g, clubName)
        .replace(/{{playerName}}/g, playerName)
        .replace(/{{amount}}/g, String(dues.totalDue))
        .replace(/{{duesText}}/g, duesText)
        .replace(/{{link}}/g, link);

    return {
      ok: true,
      playerId: pid,
      playerName,
      amount: dues.totalDue,
      duesText,
      link,
      email,
      subject: render(tpl.subject || DEFAULT_DUE_REMINDER_TEMPLATE.subject),
      text: render(tpl.body || DEFAULT_DUE_REMINDER_TEMPLATE.body),
      appConfig,
    };
  }

  const mobile = typeof player.mobile === "string" ? player.mobile.trim() : "";
  if (!mobile || mobile.replace(/\D/g, "").length < 10) {
    return { ok: false, status: 400, error: "Target player does not have a valid mobile number." };
  }

  return {
    ok: true,
    playerId: pid,
    playerName,
    amount: dues.totalDue,
    duesText,
    link,
    mobile,
    appConfig,
  };
}
