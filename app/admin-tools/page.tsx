"use client";

import { useState } from "react";
import { useStore } from "@/hooks/useStore";
import { useAuth } from "@/components/AuthProvider";
import { doc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Player } from "@/lib/types";

const GHOST_PATTERN = /^(Player|Demo Player)\s*\([a-zA-Z0-9]{2,6}\)$/;

function isGhostProfile(p: Player): boolean {
  if (!GHOST_PATTERN.test(p.name)) return false;
  if (p.dob || p.locality || p.bloodGroup || p.emergencyContact) return false;
  if (p.inviteStatus === "Verified" || p.inviteStatus === "Accepted") return false;
  return true;
}

export default function AdminToolsPage() {
  const { user } = useAuth();
  const store = useStore(user);
  const [logs, setLogs] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [phase, setPhase] = useState<"idle" | "scan" | "confirm" | "deleting" | "done">("idle");
  const [ghostPlayers, setGhostPlayers] = useState<Player[]>([]);
  const [ghostAppUserIds, setGhostAppUserIds] = useState<string[]>([]);

  const runScan = () => {
    const gPlayers = store.players.filter(isGhostProfile);
    const gAppUsers = store.appUsers.filter(
      (u) => GHOST_PATTERN.test(u.name || "") && !u.dob && !u.locality,
    );

    setGhostPlayers(gPlayers);
    setGhostAppUserIds(gAppUsers.map((u) => u.id));

    const lines: string[] = [
      `Scan complete. Found ${gPlayers.length} ghost player(s) and ${gAppUsers.length} ghost appUser(s).`,
      "",
      "--- Ghost Players ---",
    ];
    for (const p of gPlayers) {
      lines.push(
        `  ${p.name}  |  status: ${p.inviteStatus}  |  mobile: ${p.mobile || "-"}  |  id: ${p.id}`,
      );
    }
    if (gPlayers.length === 0) lines.push("  (none)");

    lines.push("", "--- Ghost AppUsers ---");
    for (const u of gAppUsers) {
      lines.push(
        `  ${u.name}  |  email: ${(u as any).email || "-"}  |  id: ${u.id}`,
      );
    }
    if (gAppUsers.length === 0) lines.push("  (none)");

    if (gPlayers.length + gAppUsers.length > 0) {
      lines.push("", 'Click "Confirm Delete" to remove all of the above.');
    } else {
      lines.push("", "Nothing to clean up.");
    }

    setLogs(lines);
    setPhase(gPlayers.length + gAppUsers.length > 0 ? "confirm" : "done");
  };

  const runDelete = async () => {
    if (processing) return;
    setProcessing(true);
    setPhase("deleting");

    let deletedPlayers = 0;
    let deletedAppUsers = 0;
    const errors: string[] = [];

    setLogs((l) => [...l, "", "Deleting..."]);

    for (const p of ghostPlayers) {
      try {
        await store.deletePlayer(p.id);
        deletedPlayers++;
      } catch (e: any) {
        errors.push(`player ${p.name} (${p.id}): ${e.message}`);
      }
    }

    for (const uid of ghostAppUserIds) {
      try {
        await deleteDoc(doc(db, "appUsers", uid));
        deletedAppUsers++;
      } catch (e: any) {
        errors.push(`appUser ${uid}: ${e.message}`);
      }
    }

    const summary = [
      "",
      "========== SUMMARY ==========",
      `Players deleted:  ${deletedPlayers} / ${ghostPlayers.length}`,
      `AppUsers deleted: ${deletedAppUsers} / ${ghostAppUserIds.length}`,
    ];
    if (errors.length) {
      summary.push("", "Errors:", ...errors.map((e) => `  ${e}`));
    } else {
      summary.push("", "All ghost profiles removed successfully.");
    }

    setLogs((l) => [...l, ...summary]);
    setPhase("done");
    setProcessing(false);
  };

  return (
    <div className="p-8 space-y-4 text-white max-w-3xl">
      <h1 className="text-2xl font-bold">Admin Utility</h1>
      <p className="text-sm text-white/60">
        Scans for ghost profiles — auto-created &quot;Player (xxxxx)&quot; entries with no
        real profile data. Skips players who are Verified/Accepted or have DOB,
        locality, blood group, or emergency contact filled in.
      </p>

      <div className="flex gap-3">
        <button
          onClick={runScan}
          disabled={processing || !store.isLoaded || phase === "confirm"}
          className="bg-amber-600 px-4 py-2 rounded font-bold disabled:opacity-50 text-sm"
        >
          {phase === "idle" || phase === "done" ? "Scan for Ghost Profiles" : "Scanning..."}
        </button>
        {phase === "confirm" && (
          <button
            onClick={runDelete}
            disabled={processing}
            className="bg-red-600 px-4 py-2 rounded font-bold disabled:opacity-50 text-sm animate-pulse"
          >
            Confirm Delete ({ghostPlayers.length + ghostAppUserIds.length})
          </button>
        )}
        {phase !== "idle" && (
          <button
            onClick={() => {
              setPhase("idle");
              setLogs([]);
              setGhostPlayers([]);
              setGhostAppUserIds([]);
            }}
            disabled={processing}
            className="bg-white/10 px-4 py-2 rounded font-bold disabled:opacity-50 text-sm"
          >
            Reset
          </button>
        )}
      </div>

      {logs.length > 0 && (
        <pre className="p-4 bg-black/50 rounded overflow-auto max-h-[500px] text-xs font-mono whitespace-pre-wrap">
          {logs.join("\n")}
        </pre>
      )}
    </div>
  );
}
