import { NextResponse } from "next/server";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "@/firebase-applet-config.json";

function normalizeIndianMobile(input: string | undefined | null): string {
  if (!input) return "";
  const raw = String(input).trim();
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("091")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length > 10) digits = digits.slice(-10);
  if (digits.length !== 10) return raw;
  return `+91${digits}`;
}

export async function POST(req: Request) {
  try {
    const { requireAdmin } = await import("@/lib/server-auth");
    const guard = await requireAdmin(req);
    if (!guard.ok) return guard.response;

    const apps = getApps();
    const app = apps.length
      ? apps[0]
      : initializeApp({ projectId: firebaseConfig.projectId });
    const dbId = (firebaseConfig as any).firestoreDatabaseId;
    let db;
    try {
      db = getFirestore(app, dbId);
    } catch {
      db = getFirestore(app);
    }

    const [playersSnap, appUsersSnap] = await Promise.all([
      db.collection("players").get(),
      db.collection("appUsers").get(),
    ]);

    const players = playersSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
    const appUsers = appUsersSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];

    const activePlayers = players.filter((p) => !p.disabled && !p.mergedInto);
    const appUserMap = new Map(appUsers.map((u) => [u.id, u]));

    // --- Edge Case 1: Players with NO mobile number ---
    const noMobile = activePlayers
      .filter((p) => !p.mobile || normalizeIndianMobile(p.mobile).length < 12)
      .map((p) => ({
        name: p.name,
        id: p.id,
        email: p.email || "",
        inviteStatus: p.inviteStatus,
        authProviders: appUserMap.get(p.authUid || p.id)?.authProviders || [],
      }));

    // --- Edge Case 2: Duplicate phone numbers ---
    const phoneToPlayers = new Map<string, any[]>();
    for (const p of activePlayers) {
      const norm = normalizeIndianMobile(p.mobile);
      if (norm.length < 12) continue;
      if (!phoneToPlayers.has(norm)) phoneToPlayers.set(norm, []);
      phoneToPlayers.get(norm)!.push(p);
    }
    const duplicatePhones = Array.from(phoneToPlayers.entries())
      .filter(([, arr]) => arr.length > 1)
      .map(([phone, arr]) => ({
        phone,
        players: arr.map((p: any) => ({
          name: p.name,
          id: p.id,
          inviteStatus: p.inviteStatus,
          authUid: p.authUid || null,
        })),
      }));

    // --- Edge Case 3: Google-only users (no phone provider linked) ---
    const googleOnlyNoPhone = activePlayers
      .filter((p) => {
        const au = appUserMap.get(p.authUid || p.id);
        const providers = au?.authProviders || [];
        return (
          providers.includes("google.com") &&
          !providers.includes("phone")
        );
      })
      .map((p) => ({
        name: p.name,
        id: p.id,
        mobile: p.mobile || "MISSING",
        email: p.email || "",
        hasMobile: !!p.mobile && normalizeIndianMobile(p.mobile).length >= 12,
      }));

    // --- Edge Case 4: Phone-only users (no Google linked, no email) ---
    const phoneOnlyNoEmail = activePlayers
      .filter((p) => {
        const au = appUserMap.get(p.authUid || p.id);
        const providers = au?.authProviders || [];
        return (
          providers.includes("phone") &&
          !providers.includes("google.com") &&
          (!p.email || !p.email.includes("@"))
        );
      })
      .map((p) => ({
        name: p.name,
        id: p.id,
        mobile: p.mobile || "",
      }));

    // --- Edge Case 5: Players with authUid different from doc id ---
    const authUidMismatch = activePlayers
      .filter((p) => p.authUid && p.authUid !== p.id)
      .map((p) => ({
        name: p.name,
        docId: p.id,
        authUid: p.authUid,
      }));

    // --- Edge Case 6: Players with NO appUser record ---
    const noAppUser = activePlayers
      .filter((p) => {
        const uid = p.authUid || p.id;
        return !appUserMap.has(uid);
      })
      .map((p) => ({
        name: p.name,
        id: p.id,
        authUid: p.authUid || null,
        inviteStatus: p.inviteStatus,
      }));

    // --- Edge Case 7: Orphaned appUsers (no matching player) ---
    const playerUids = new Set(activePlayers.map((p) => p.authUid || p.id));
    const playerDocIds = new Set(activePlayers.map((p) => p.id));
    const orphanedAppUsers = appUsers
      .filter((au) => !playerUids.has(au.id) && !playerDocIds.has(au.id))
      .map((au) => ({
        uid: au.id,
        name: au.name || "",
        email: au.email || "",
        providers: au.authProviders || [],
      }));

    // --- Summary stats ---
    const providerBreakdown = { google: 0, phone: 0, both: 0, emailPassword: 0, none: 0 };
    for (const p of activePlayers) {
      const au = appUserMap.get(p.authUid || p.id);
      const providers = au?.authProviders || [];
      const hasGoogle = providers.includes("google.com");
      const hasPhone = providers.includes("phone");
      const hasPassword = providers.includes("password");
      if (hasGoogle && hasPhone) providerBreakdown.both++;
      else if (hasGoogle) providerBreakdown.google++;
      else if (hasPhone) providerBreakdown.phone++;
      else if (hasPassword) providerBreakdown.emailPassword++;
      else providerBreakdown.none++;
    }

    return NextResponse.json({
      summary: {
        totalActivePlayers: activePlayers.length,
        totalAppUsers: appUsers.length,
        providerBreakdown,
      },
      edgeCases: {
        noMobile: { count: noMobile.length, players: noMobile },
        duplicatePhones: { count: duplicatePhones.length, groups: duplicatePhones },
        googleOnlyNoPhone: {
          count: googleOnlyNoPhone.length,
          withMobileInProfile: googleOnlyNoPhone.filter((p) => p.hasMobile).length,
          withoutMobileInProfile: googleOnlyNoPhone.filter((p) => !p.hasMobile).length,
          players: googleOnlyNoPhone,
        },
        phoneOnlyNoEmail: { count: phoneOnlyNoEmail.length, players: phoneOnlyNoEmail },
        authUidMismatch: { count: authUidMismatch.length, players: authUidMismatch },
        noAppUser: { count: noAppUser.length, players: noAppUser },
        orphanedAppUsers: { count: orphanedAppUsers.length, users: orphanedAppUsers },
      },
    });
  } catch (error: any) {
    console.error("Auth audit error:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
