"use client";

import { useState, useMemo } from "react";
import { useStore } from "@/hooks/useStore";
import { useAuth } from "@/components/AuthProvider";
import { doc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Player, AppUser } from "@/lib/types";
import { normalizeIndianMobile } from "@/lib/utils";

const GHOST_PATTERN = /^(Player|Demo Player)\s*\([a-zA-Z0-9]{2,6}\)$/;

function isGhostProfile(p: Player): boolean {
  if (!GHOST_PATTERN.test(p.name)) return false;
  if (p.dob || p.locality || p.bloodGroup || p.emergencyContact) return false;
  if (p.inviteStatus === "Verified" || p.inviteStatus === "Accepted") return false;
  return true;
}

type AuditFlag = {
  label: string;
  color: string;
};

type AuditRow = {
  player: Player;
  appUser: AppUser | undefined;
  flags: AuditFlag[];
};

function buildAuditRows(players: Player[], appUsers: AppUser[]): AuditRow[] {
  const appUserMap = new Map<string, AppUser>();
  for (const u of appUsers) appUserMap.set(u.id, u);

  return players
    .filter((p) => !p.disabled && !p.mergedInto)
    .map((p) => {
      const flags: AuditFlag[] = [];
      const authUid = (p as any).authUid as string | undefined;
      const appUser = appUserMap.get(authUid || p.id) || appUserMap.get(p.id);

      if (!authUid) {
        flags.push({ label: "No authUid", color: "text-red-400" });
      } else if (authUid !== p.id) {
        flags.push({ label: "ID != authUid", color: "text-amber-400" });
      }

      if (!appUser) {
        flags.push({ label: "No appUser doc", color: "text-red-400" });
      }

      const providers = appUser?.authProviders || [];
      if (providers.length === 0 && appUser) {
        flags.push({ label: "No auth providers", color: "text-amber-400" });
      }

      const hasMobile = p.mobile && normalizeIndianMobile(p.mobile).length >= 12;
      const hasPhoneAuth = providers.includes("phone");
      const hasGoogleAuth = providers.includes("google.com");

      if (hasMobile && !hasPhoneAuth && !hasGoogleAuth && appUser) {
        flags.push({ label: "Has mobile, no auth linked", color: "text-amber-400" });
      }

      if (hasPhoneAuth && !hasMobile) {
        flags.push({ label: "Phone auth but no mobile", color: "text-amber-400" });
      }

      if (p.inviteStatus === "Pending" || p.inviteStatus === "Unverified") {
        flags.push({ label: p.inviteStatus, color: "text-blue-400" });
      }

      return { player: p, appUser, flags };
    })
    .sort((a, b) => {
      if (a.flags.length !== b.flags.length) return b.flags.length - a.flags.length;
      return a.player.name.localeCompare(b.player.name);
    });
}

function PlayerIdAudit({ store }: { store: ReturnType<typeof useStore> }) {
  const [filter, setFilter] = useState<"all" | "issues">("issues");
  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const rows = useMemo(
    () => buildAuditRows(store.players, store.appUsers),
    [store.players, store.appUsers],
  );

  const filtered = useMemo(() => {
    let result = rows;
    if (filter === "issues") result = result.filter((r) => r.flags.length > 0);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (r) =>
          r.player.name.toLowerCase().includes(q) ||
          r.player.id.toLowerCase().includes(q) ||
          ((r.player as any).authUid || "").toLowerCase().includes(q) ||
          (r.player.mobile || "").includes(q) ||
          (r.player.email || "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [rows, filter, search]);

  const issueCount = rows.filter((r) => r.flags.length > 0).length;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const CopyableId = ({ value, label }: { value: string; label?: string }) => (
    <button
      onClick={() => copyToClipboard(value)}
      className="text-left font-mono text-[10px] hover:bg-white/10 px-1 py-0.5 rounded cursor-pointer transition group"
      title={`Click to copy: ${value}`}
    >
      <span className="text-white/40 mr-1">{label || "ID"}:</span>
      <span className="text-white/80 group-hover:text-white">
        {value.slice(0, 8)}...{value.slice(-4)}
      </span>
      {copiedId === value && (
        <span className="ml-1 text-emerald-400 text-[9px]">copied</span>
      )}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Player ID Audit</h2>
        <span className="text-xs text-white/40">
          {store.players.filter((p) => !p.disabled && !p.mergedInto).length} active players
          {issueCount > 0 && (
            <span className="text-amber-400 ml-2">{issueCount} with issues</span>
          )}
        </span>
      </div>

      <div className="flex gap-2 items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, ID, phone, email..."
          className="flex-1 px-3 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
        />
        <button
          onClick={() => setFilter("issues")}
          className={`px-3 py-1.5 rounded text-xs font-bold transition ${filter === "issues" ? "bg-amber-600 text-white" : "bg-white/10 text-white/60 hover:bg-white/15"}`}
        >
          Issues Only ({issueCount})
        </button>
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1.5 rounded text-xs font-bold transition ${filter === "all" ? "bg-white/20 text-white" : "bg-white/10 text-white/60 hover:bg-white/15"}`}
        >
          All
        </button>
      </div>

      <div className="overflow-auto max-h-[600px] rounded border border-white/10">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-zinc-900 z-10">
            <tr className="border-b border-white/10 text-left">
              <th className="px-3 py-2 text-white/50 font-medium">#</th>
              <th className="px-3 py-2 text-white/50 font-medium">Player</th>
              <th className="px-3 py-2 text-white/50 font-medium">Doc ID / authUid</th>
              <th className="px-3 py-2 text-white/50 font-medium">Auth</th>
              <th className="px-3 py-2 text-white/50 font-medium">Mobile</th>
              <th className="px-3 py-2 text-white/50 font-medium">Status</th>
              <th className="px-3 py-2 text-white/50 font-medium">Issues</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-white/30">
                  {filter === "issues" ? "No issues found" : "No players found"}
                </td>
              </tr>
            )}
            {filtered.map((row, i) => {
              const authUid = (row.player as any).authUid as string | undefined;
              const providers = row.appUser?.authProviders || [];
              const hasIssue = row.flags.length > 0;
              return (
                <tr
                  key={row.player.id}
                  className={`border-b border-white/5 ${hasIssue ? "bg-red-500/5" : "hover:bg-white/5"}`}
                >
                  <td className="px-3 py-2 text-white/30">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-white">{row.player.name}</div>
                    {row.player.email && (
                      <div className="text-[10px] text-white/40">{row.player.email}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="space-y-0.5">
                      <CopyableId value={row.player.id} label="Doc" />
                      {authUid && authUid !== row.player.id && (
                        <CopyableId value={authUid} label="Auth" />
                      )}
                      {authUid && authUid === row.player.id && (
                        <div className="text-[10px] text-emerald-400/60 px-1">authUid matches</div>
                      )}
                      {!authUid && (
                        <div className="text-[10px] text-red-400/60 px-1">authUid not set</div>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {providers.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {providers.map((p: string) => (
                          <span
                            key={p}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              p === "phone"
                                ? "bg-blue-500/20 text-blue-300"
                                : p === "google.com"
                                  ? "bg-emerald-500/20 text-emerald-300"
                                  : "bg-white/10 text-white/60"
                            }`}
                          >
                            {p === "google.com" ? "Google" : p}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-white/20">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-white/60">
                    {row.player.mobile || <span className="text-white/20">-</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        row.player.inviteStatus === "Verified" || row.player.inviteStatus === "Accepted"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : row.player.inviteStatus === "Pending"
                            ? "bg-amber-500/20 text-amber-300"
                            : "bg-white/10 text-white/50"
                      }`}
                    >
                      {row.player.inviteStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {row.flags.length > 0 ? (
                      <div className="flex flex-col gap-0.5">
                        {row.flags.map((f, fi) => (
                          <span key={fi} className={`text-[10px] font-medium ${f.color}`}>
                            {f.label}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-emerald-400/40 text-[10px]">OK</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
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

  if (!store.isLoaded) {
    return (
      <div className="p-8 text-white/50 text-sm">Loading store data...</div>
    );
  }

  return (
    <div className="p-8 space-y-8 text-white max-w-6xl">
      <h1 className="text-2xl font-bold">Admin Utility</h1>

      <PlayerIdAudit store={store} />

      <div className="border-t border-white/10 pt-6 space-y-4 max-w-3xl">
        <h2 className="text-lg font-bold">Ghost Profile Cleanup</h2>
        <p className="text-sm text-white/60">
          Scans for ghost profiles — auto-created &quot;Player (xxxxx)&quot; entries with no
          real profile data. Skips players who are Verified/Accepted or have DOB,
          locality, blood group, or emergency contact filled in.
        </p>

        <div className="flex gap-3">
          <button
            onClick={runScan}
            disabled={processing || phase === "confirm"}
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
    </div>
  );
}
