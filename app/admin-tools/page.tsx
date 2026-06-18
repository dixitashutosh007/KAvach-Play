"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/hooks/useStore";
import { useAuth } from "@/components/AuthProvider";
import { doc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function AdminToolsPage() {
  const { user } = useAuth();
  const store = useStore(user);
  const [logs, setLogs] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);

  const runAnonymousCleanup = async () => {
    if (processing) return;
    setProcessing(true);
    setLogs(["Starting anonymous profiles cleanup..."]);
    
    for (const p of store.players) {
      if (p.name.startsWith("Player (") && p.name.includes(")") && p.name.length < 20 && p.inviteStatus === "Unverified") {
        setLogs((l) => [...l, `Found anonymous player: ${p.name} (${p.id})`]);
        try {
          await store.deletePlayer(p.id);
          setLogs((l) => [...l, `Deleted anonymous player: ${p.id}`]);
        } catch (e: any) {
          setLogs((l) => [...l, `Error deleting anonymous player: ${e.message}`]);
        }
      }
    }

    for (const u of store.appUsers) {
      if (u.name?.startsWith("Player (") && u.name?.includes(")") && u.name.length < 20) {
        setLogs((l) => [...l, `Found anonymous appUser: ${u.name} (${u.id})`]);
        try {
          await deleteDoc(doc(db, "appUsers", u.id));
          setLogs((l) => [...l, `Deleted anonymous appUser: ${u.id}`]);
        } catch (e: any) {
          setLogs((l) => [...l, `Error deleting anonymous appUser: ${e.message}`]);
        }
      }
    }
    
    setLogs((l) => [...l, "Anonymous cleanup done!"]);
    setProcessing(false);
  };

  const runAakashCleanup = async () => {
    if (processing) return;
    setProcessing(true);
    setLogs(["Searching for Aakash in players & appUsers..."]);
    
    for (const p of store.players) {
      const nameMatch = p.name.toLowerCase().includes("aakash");
      const phoneMatch = p.mobile?.includes("aakash") || p.mobile?.endsWith("1219"); // Trying to catch common ones
      if (nameMatch || phoneMatch) {
        setLogs((l) => [...l, `Found Aakash player: ${p.name} (${p.id})`]);
        try {
          await store.deletePlayer(p.id);
          setLogs((l) => [...l, `Deleted player: ${p.id}`]);
        } catch (e: any) {
          setLogs((l) => [...l, `Error deleting player: ${e.message}`]);
        }
      }
    }

    for (const u of store.appUsers) {
      const nameMatch = u.name?.toLowerCase().includes("aakash");
      const emailMatch = u.email?.toLowerCase().includes("aakash");
      const phoneMatch = u.mobile?.includes("aakash") || u.mobile?.endsWith("1219");
      if (nameMatch || emailMatch || phoneMatch) {
        setLogs((l) => [...l, `Found Aakash appUser: ${u.name} (${u.id})`]);
        try {
          await deleteDoc(doc(db, "appUsers", u.id));
          setLogs((l) => [...l, `Deleted appUser: ${u.id}`]);
        } catch (e: any) {
          setLogs((l) => [...l, `Error deleting appUser: ${e.message}`]);
        }
      }
    }
    
    setLogs((l) => [...l, "Aakash cleanup done! Tell him to log out and log in again."]);
    setProcessing(false);
  };

  return (
    <div className="p-8 space-y-4 text-white">
      <h1 className="text-2xl font-bold">Admin Utility</h1>
      <div className="flex gap-4">
        <button 
          onClick={runAnonymousCleanup} 
          disabled={processing || !store.isLoaded}
          className="bg-red-600 px-4 py-2 rounded font-bold disabled:opacity-50"
        >
          Cleanup Anonymous Profiles
        </button>
        <button 
          onClick={runAakashCleanup} 
          disabled={processing || !store.isLoaded}
          className="bg-blue-600 px-4 py-2 rounded font-bold disabled:opacity-50"
        >
          Cleanup Aakash Records
        </button>
      </div>
      <pre className="p-4 bg-black/50 rounded overflow-auto h-[400px] text-xs font-mono">
        {logs.join("\n")}
      </pre>
    </div>
  );
}


