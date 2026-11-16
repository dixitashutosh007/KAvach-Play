/**
 * report-match-dues.js
 * 
 * Fetches all players with unpaid match fees from KAvach Play Firestore
 * and formats the output for display in Antigravity chat.
 */
const { initializeApp } = require("firebase/app");
const { getAuth, signInWithEmailAndPassword } = require("firebase/auth");
const { initializeFirestore, collection, collectionGroup, getDocs } = require("firebase/firestore");
const fs = require("fs");
const path = require("path");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...vals] = trimmed.split("=");
    env[key.trim()] = vals.join("=").trim();
  }
  return env;
}

async function getMatchDuesData() {
  const projectRoot = path.resolve(__dirname, "..");
  const envLocal = loadEnv(path.join(projectRoot, ".env.local"));
  const envRoot = loadEnv(path.join(projectRoot, ".env"));
  const env = { ...envRoot, ...envLocal, ...process.env };

  const configPath = path.join(projectRoot, "firebase-applet-config.json");
  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const dbId = firebaseConfig.firestoreDatabaseId || "(default)";
  const db = initializeFirestore(app, {}, dbId);

  const adminEmail = env.ADMIN_EMAIL;
  const adminPassword = env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be configured in .env.local");
  }

  await signInWithEmailAndPassword(auth, adminEmail, adminPassword);

  // Fetch matches
  const matchesSnap = await getDocs(collection(db, "matches"));
  const matchesMap = new Map();
  matchesSnap.forEach((d) => {
    matchesMap.set(d.id, { id: d.id, ...d.data() });
  });

  // Fetch players
  const playersSnap = await getDocs(collection(db, "players"));
  const playersMap = new Map();
  playersSnap.forEach((d) => {
    playersMap.set(d.id, { id: d.id, ...d.data() });
  });

  // Fetch payments
  const paymentsSnap = await getDocs(collectionGroup(db, "payments"));
  const playerDuesMap = new Map();

  paymentsSnap.forEach((docSnap) => {
    const pay = docSnap.data();
    if (pay.status !== "Unpaid") return;

    const match = matchesMap.get(pay.matchId);
    if (match && match.result === "Abandoned") return;
    const player = playersMap.get(pay.playerId);
    const amount = Number(pay.feeOverride !== undefined ? pay.feeOverride : (match ? match.fee : 0)) || 0;
    if (amount <= 0) return;

    const playerId = pay.playerId;
    if (!playerDuesMap.has(playerId)) {
      playerDuesMap.set(playerId, {
        playerId,
        playerName: player ? player.name : (pay.playerName || "Unknown"),
        mobile: player ? player.mobile : "",
        email: player ? player.email : "",
        totalDue: 0,
        matches: [],
      });
    }

    const record = playerDuesMap.get(playerId);
    record.totalDue += amount;
    record.matches.push({
      matchId: pay.matchId,
      date: match ? match.date : "N/A",
      opponent: match ? match.opponent : "Unknown",
      amount,
    });
  });

  const duesList = Array.from(playerDuesMap.values()).sort((a, b) => b.totalDue - a.totalDue);
  const grandTotal = duesList.reduce((sum, p) => sum + p.totalDue, 0);

  return {
    duesList,
    grandTotal,
    playerCount: duesList.length,
    generatedAt: new Date().toISOString(),
  };
}

function formatMarkdownReport(data) {
  let lines = [];
  lines.push(`## 🏏 KAvach Play — Match Fee Dues Report`);
  lines.push(`*Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST*\n`);
  lines.push(`> [!NOTE]`);
  lines.push(`> **Summary**: **${data.playerCount} players** with outstanding match fees totaling **₹${data.grandTotal}**.\n`);

  if (data.duesList.length === 0) {
    lines.push(`All players are currently cleared of match fee dues! 🎉`);
    return lines.join("\n");
  }

  lines.push(`### Outstanding Dues Summary`);
  lines.push(`| # | Player | Mobile / Contact | Pending Matches | Total Due |`);
  lines.push(`| :--- | :--- | :--- | :---: | :---: |`);

  data.duesList.forEach((player, idx) => {
    const contact = player.mobile || player.email || "N/A";
    lines.push(`| ${idx + 1} | **${player.playerName}** | \`${contact}\` | ${player.matches.length} | **₹${player.totalDue}** |`);
  });

  lines.push(`\n### Detailed Match Breakdown`);
  data.duesList.forEach((player, idx) => {
    lines.push(`#### ${idx + 1}. ${player.playerName} (Total: ₹${player.totalDue})`);
    player.matches.forEach((m) => {
      lines.push(`- vs **${m.opponent}** (${m.date}): ₹${m.amount}`);
    });
    lines.push(``);
  });

  return lines.join("\n");
}

async function main() {
  const data = await getMatchDuesData();
  const mdReport = formatMarkdownReport(data);
  console.log(mdReport);
  process.exit(0);
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
