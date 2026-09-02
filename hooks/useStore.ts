/**
 * Global State & Database Synchronization Hook (`hooks/useStore.ts`)
 *
 * This hook is the core data layer of the application. It establishes real-time connections
 * to Firebase Firestore for all primary collections (players, matches, payments, grounds, posts, etc.).
 * It caches the data in local React state and provides mutation functions (add, update, delete)
 * to interact with the database. Error handling for network and quota issues is centralized here.
 */
"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Ground,
  Match,
  Player,
  MatchPayment,
  PlayerStat,
  AppConfig,
  AppUser,
  Post,
  PostComment,
  SubscriptionPlan,
  SubscriptionHistory,
  Notification,
  OtherFee,
  FeeTemplate,
  OutOfPlay,
  Merchandise,
  MerchOrder,
  Poll,
  PollResponse,
  Tournament,
  FeePlan,
  Badge,
  BadgeTypeDef,
  CatchLogEntry,
} from "@/lib/types";
import { db, auth } from "@/lib/firebase";
import {
  collection,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  getDocs,
  collectionGroup,
  query,
  orderBy,
  limit,
  startAfter,
  Timestamp,
  QueryDocumentSnapshot,
  DocumentData,
  writeBatch,
  deleteField,
  increment,
  addDoc,
} from "firebase/firestore";
import { handleFirestoreError, OperationType } from "@/lib/errorHandling";
import { User } from "firebase/auth";
import { createNotification } from "@/lib/notifications";
import { logAudit, diffChanges, AuditActorType } from "@/lib/auditLog";

function cleanPayload<T extends object>(obj: T): Partial<T> {
  const result: any = {};
  Object.keys(obj).forEach((key) => {
    const val = (obj as any)[key];
    if (val !== undefined) {
      result[key] = val;
    }
  });
  return result;
}

export function useStore(user: User | null, readOnly: boolean = false) {
  const [grounds, setGrounds] = useState<Ground[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [payments, setPayments] = useState<MatchPayment[]>([]);
  const [playerStats, setPlayerStats] = useState<PlayerStat[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState<
    SubscriptionPlan[]
  >([]);
  const [subscriptionHistory, setSubscriptionHistory] = useState<
    SubscriptionHistory[]
  >([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationsHasMore, setNotificationsHasMore] = useState(true);
  const [notificationsLoadingMore, setNotificationsLoadingMore] = useState(false);
  const notificationsCursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const NOTIFICATIONS_PAGE_SIZE = 50;
  const [otherFees, setOtherFees] = useState<OtherFee[]>([]);
  const [feeTemplates, setFeeTemplates] = useState<FeeTemplate[]>([]);
  const [outOfPlays, setOutOfPlays] = useState<OutOfPlay[]>([]);
  const [merchandises, setMerchandises] = useState<Merchandise[]>([]);
  const [merchOrders, setMerchOrders] = useState<MerchOrder[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [pollResponses, setPollResponses] = useState<PollResponse[]>([]);
  const [feePlans, setFeePlans] = useState<FeePlan[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [badgeTypeDefs, setBadgeTypeDefs] = useState<BadgeTypeDef[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Lazy subscription bookkeeping. Kept in refs so component re-renders don't
  // restart subscriptions. Keys: "allPayments" | "allOtherFees" |
  // `match-payments:${matchId}`. Values: the unsubscribe fn.
  const lazySubsRef = useRef<Map<string, () => void>>(new Map());
  const paymentsPerMatchRef = useRef<Map<string, MatchPayment[]>>(new Map());
  const allPaymentsSnapshotRef = useRef<MatchPayment[]>([]);
  const loadedOneShotsRef = useRef<Set<string>>(new Set());

  const recomputePayments = useCallback(() => {
    const dedupedMap = new Map<string, MatchPayment>();
    const consider = (p: MatchPayment) => {
      const key = p.guestName ? p.id : `${p.matchId}_${p.playerId}`;
      const prior = dedupedMap.get(key);
      if (
        !prior ||
        (p.updatedAt?.seconds || 0) > (prior.updatedAt?.seconds || 0)
      ) {
        dedupedMap.set(key, p);
      }
    };
    // Prefer whichever snapshot has richer data. If "allPayments" is active it
    // dominates; otherwise merge per-match snapshots.
    if (lazySubsRef.current.has("allPayments")) {
      allPaymentsSnapshotRef.current.forEach(consider);
    } else {
      paymentsPerMatchRef.current.forEach((list) => list.forEach(consider));
    }
    const merged = Array.from(dedupedMap.values()).sort(
      (a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0),
    );
    setPayments(merged);
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    // Register the user if they don't exist in appUsers
    const ensureUser = async () => {
      if (readOnly || user.isAnonymous) return;
      
      const userDoc = doc(db, "appUsers", user.uid);
      const playerDoc = doc(db, "players", user.uid);

      const isDemo = user.email === "demo_player@kavach.com";
      // Super-admin identity now comes from the `admin: true` Firebase Auth
      // custom claim, set via scripts/set-admin-claim.js. Read it once here
      // to decide the initial role for a brand-new appUser doc.
      let hasAdminClaim = false;
      try {
        const tokenResult = await user.getIdTokenResult();
        hasAdminClaim = tokenResult.claims?.admin === true;
      } catch {}

      const rawSuffix = user.uid.replace(/[^a-zA-Z0-9]/g, "").slice(-4);
      const nameVal =
        user.displayName ||
        (isDemo
          ? `Demo Player (${rawSuffix.toUpperCase()})`
          : `Player (${user.uid.slice(0, 5)})`);

      const numOnly = user.uid.replace(/[^0-9]/g, "");
      const digitSuffix = (numOnly ? numOnly : "55555")
        .slice(0, 5)
        .padEnd(5, "7");
      const mobileVal = isDemo ? `99900${digitSuffix}` : "";

      let resolvedRole = isDemo
        ? "player"
        : hasAdminClaim
          ? "admin"
          : "player";

      try {
        const userSnap = await getDoc(userDoc);
        if (!userSnap.exists()) {
          if (!isDemo && !hasAdminClaim) {
            // Do not auto-create for normal users (phone, google, etc.). let app/page.tsx handle registration
            return;
          }

          const email =
            user.email || `demo_player_${user.uid.slice(0, 5)}@example.com`;

          if (isDemo) {
            await setDoc(userDoc, {
              email,
              name: nameVal,
              role: resolvedRole,
              dob: "1998-05-18",
              locality: "Sector 5, Kavach Arena",
              bloodGroup: "O+",
              emergencyContact: "9876543210",
              battingStyle: "Right-hand bat",
              bowlingStyle: "Right-arm medium",
              isWicketKeeper: false,
              chestSize: "40",
              jerseyNumber: "10",
              mobile: mobileVal,
              isStudioMember: false,
            });
          } else {
            await setDoc(userDoc, { email, name: nameVal, role: resolvedRole });
          }
        } else {
          resolvedRole = userSnap.data()?.role || resolvedRole;
          // Anyone carrying the admin custom claim is granted the admin
          // role at the doc level too, so downstream role checks stay
          // consistent even where they read from appUsers.
          if (hasAdminClaim && resolvedRole !== "admin") {
            await updateDoc(userDoc, { role: "admin" });
            resolvedRole = "admin";
          }
        }
      } catch (e) {
        console.error("Error creating appUser:", e);
      }

      // Ensure they also exist in players collection so they show up in admin players tab
      try {
        const pSnap = await getDoc(playerDoc);
        const initialStatus =
          resolvedRole === "admin"
            ? "Verified"
            : isDemo
              ? "Pending"
              : "Unverified";

        if (!pSnap.exists()) {
          await setDoc(playerDoc, {
            name: nameVal,
            mobile: mobileVal,
            inviteStatus: initialStatus,
            dob: isDemo ? "1998-05-18" : "",
            locality: isDemo ? "Sector 5, Kavach Arena" : "",
            bloodGroup: isDemo ? "O+" : "",
            emergencyContact: isDemo ? "9876543210" : "",
            battingStyle: isDemo ? "Right-hand bat" : "",
            bowlingStyle: isDemo ? "Right-arm medium" : "",
            isWicketKeeper: isDemo ? false : false,
            jerseyNumber: isDemo ? "10" : "",
            chestSize: isDemo ? "40" : "",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          if (initialStatus === "Unverified" || initialStatus === "Pending") {
            createNotification(
              "admin",
              "New Player Request",
              `Player ${nameVal} has requested to join the club.`,
              "email",
              { type: "player_request", playerId: user.uid }
            );
            createNotification(
              user.uid,
              "Welcome to the Club",
              `Welcome ${nameVal}! Your request to join is currently pending approval.`,
              "email",
            );
          }
        } else {
          // If player document exists but status doesn't match verified status of an admin, auto-verify
          if (
            resolvedRole === "admin" &&
            pSnap.data()?.inviteStatus !== "Verified" &&
            pSnap.data()?.inviteStatus !== "Accepted"
          ) {
            await updateDoc(playerDoc, { inviteStatus: "Verified" });
          }
        }
      } catch (e) {
        console.error("Error creating player record:", e);
      }
    };
    if (!readOnly) {
      ensureUser();
    }

    // Default configuration doc
    const ensureConfig = async () => {
      const g = await getDocs(collection(db, "appConfig"));
      if (g.empty) {
        try {
          await setDoc(doc(db, "appConfig", "default"), {
            clubName: "KAVACH CRICKET CLUB",
            logoUrl: "",
            themeColor: "#dc143c",
          });
        } catch (e) {}
      }
    };
    ensureConfig();

    // Payments and otherFees are subscribed lazily via ensurePayments /
    // ensureMatchPayments / ensureOtherFees. Tabs that need them call the
    // ensure fn on mount. Previously we ran collectionGroup subscriptions
    // for every logged-in user, which loaded 2000+ payment docs into every
    // browser regardless of what the user actually opened.

    // appConfig — one-shot on mount. Refreshed via refreshAppConfig() from
    // updateAppConfig() so admins see their changes immediately without a
    // permanent live subscription costing every user reads.
    (async () => {
      try {
        const snap = await getDoc(doc(db, "appConfig", "default"));
        if (snap.exists()) {
          const config = snap.data() as AppConfig;
          if (config.loadingAnimationTheme && typeof window !== "undefined") {
            localStorage.setItem("kavach_loading_theme", config.loadingAnimationTheme);
          }
          setAppConfig({ ...config, id: snap.id });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, "appConfig");
      }
    })();
    const unsubConfig = () => {};

    // appUsers: default subscription is ONLY the current user's own doc so
    // role-checking works. The full collection is loaded on demand via
    // ensureAllAppUsers() when an admin tab needs it. This keeps 100+ PII
    // docs out of every player's browser.
    const unsubAppUsers = onSnapshot(
      doc(db, "appUsers", user.uid),
      (selfSnap) => {
        if (!selfSnap.exists()) return;
        const selfDoc = { id: selfSnap.id, ...selfSnap.data() } as AppUser;
        const nameLower = (selfDoc.name || "").toLowerCase();
        const emailLower = (selfDoc.email || "").toLowerCase();
        if (nameLower.includes("demo") || emailLower.includes("demo")) return;
        setAppUsers((prev) => {
          const others = prev.filter((u) => u.id !== selfDoc.id);
          return [...others, selfDoc];
        });
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "appUsers/self"),
    );

    // grounds — one-shot; refreshed by mutation methods below.
    (async () => {
      try {
        const snap = await getDocs(collection(db, "grounds"));
        setGrounds(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Ground));
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, "grounds");
      }
    })();
    const unsubGrounds = () => {};

    // tournaments — now lazy, see ensureTournaments()

    const unsubPlayers = onSnapshot(
      collection(db, "players"),
      (snapshot) => {
        setPlayers(
          snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }) as Player)
            .filter((p) => {
              const nameLower = (p.name || "").toLowerCase();
              const emailLower = (p.email || "").toLowerCase();
              return !nameLower.includes("demo") && !emailLower.includes("demo");
            }),
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "players"),
    );

    // playerStats and posts — now lazy, see ensurePlayerStats() / ensurePosts()
    const unsubStats = () => {};
    const unsubPosts = () => {};

    const unsubMatches = onSnapshot(
      collection(db, "matches"),
      (snapshot) => {
        const ms = snapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as Match,
        );
        setMatches(ms);
        setIsLoaded(true);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, "matches");
        setIsLoaded(true);
      },
    );

    // subscriptionPlans — now lazy, see ensureSubscriptionPlans()

    // subscriptionHistory: no default subscription. Loaded via
    // ensureSubscriptionHistory() only for admin tabs (RazorReportView,
    // StudioAdminTab) that actually need audit data.
    const unsubSubscriptionHistory = () => {};

    // Paginated notifications: subscribe to the most recent 50 in real time.
    // Older notifications are loaded on demand via loadMoreNotifications().
    const notificationsQuery = query(
      collection(db, "notifications"),
      orderBy("createdAt", "desc"),
      limit(NOTIFICATIONS_PAGE_SIZE),
    );
    const unsubNotifications = onSnapshot(
      notificationsQuery,
      (snapshot) => {
        const recent = snapshot.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as Notification,
        );
        const recentIds = new Set(recent.map((n) => n.id));
        setNotifications((prev) => {
          // Keep any older notifications loaded via pagination, drop overlaps
          const older = prev.filter((n) => !recentIds.has(n.id));
          const merged = [...recent, ...older].sort(
            (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0),
          );
          return merged;
        });
        // Cursor for loading older docs sits at the last of the recent page
        notificationsCursorRef.current =
          snapshot.docs[snapshot.docs.length - 1] || null;
        if (snapshot.docs.length < NOTIFICATIONS_PAGE_SIZE) {
          setNotificationsHasMore(false);
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "notifications"),
    );

    // otherFees now lazy — see ensureOtherFees.

    // feeTemplates — now lazy, see ensureFeeTemplates()

    // feePlans — now lazy, see ensureFeePlans()

    // outOfPlays — now lazy, see ensureOutOfPlays()

    // merchandises — now lazy, see ensureMerchandises()

    // merchOrders, polls, pollResponses — now lazy, see ensure*() below
    const unsubMerchOrders = () => {};
    const unsubPolls = () => {};
    const unsubPollResponses = () => {};

    return () => {
      unsubGrounds();
      unsubMatches();
      unsubPlayers();
      unsubStats();
      unsubPosts();
      unsubAppUsers();
      unsubConfig();
      unsubSubscriptionHistory();
      unsubNotifications();
      unsubMerchOrders();
      unsubPolls();
      unsubPollResponses();
      // Tear down lazy subscriptions (payments, otherFees, outOfPlays, etc.)
      lazySubsRef.current.forEach((unsub) => unsub());
      lazySubsRef.current.clear();
      paymentsPerMatchRef.current.clear();
      allPaymentsSnapshotRef.current = [];
      loadedOneShotsRef.current.clear();
    };
  }, [user]);

  // ---- Lazy subscription helpers ----

  const ensurePayments = useCallback(() => {
    if (!user || lazySubsRef.current.has("allPayments")) return;
    const unsub = onSnapshot(
      collectionGroup(db, "payments"),
      (snapshot) => {
        allPaymentsSnapshotRef.current = snapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as MatchPayment,
        );
        recomputePayments();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "payments"),
    );
    lazySubsRef.current.set("allPayments", unsub);
  }, [user, recomputePayments]);

  const ensureMatchPayments = useCallback(
    (matchId: string) => {
      if (!user || !matchId) return;
      const key = `match-payments:${matchId}`;
      if (lazySubsRef.current.has(key)) return;
      const unsub = onSnapshot(
        collection(db, "matches", matchId, "payments"),
        (snapshot) => {
          paymentsPerMatchRef.current.set(
            matchId,
            snapshot.docs.map(
              (doc) => ({ id: doc.id, ...doc.data() }) as MatchPayment,
            ),
          );
          recomputePayments();
        },
        (err) =>
          handleFirestoreError(
            err,
            OperationType.LIST,
            `matches/${matchId}/payments`,
          ),
      );
      lazySubsRef.current.set(key, unsub);
    },
    [user, recomputePayments],
  );

  const ensurePosts = useCallback(() => {
    if (!user || lazySubsRef.current.has("posts")) return;
    const unsub = onSnapshot(
      collection(db, "posts"),
      (snapshot) => {
        setPosts(
          snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }) as Post)
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)),
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "posts"),
    );
    lazySubsRef.current.set("posts", unsub);
  }, [user]);

  const ensurePlayerStats = useCallback(() => {
    if (!user || lazySubsRef.current.has("playerStats")) return;
    const unsub = onSnapshot(
      collection(db, "playerStats"),
      (snapshot) => {
        setPlayerStats(
          snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as PlayerStat),
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "playerStats"),
    );
    lazySubsRef.current.set("playerStats", unsub);
  }, [user]);

  const ensureMerchOrders = useCallback(() => {
    if (!user || lazySubsRef.current.has("merchOrders")) return;
    const unsub = onSnapshot(
      collection(db, "merchOrders"),
      (snapshot) => {
        setMerchOrders(
          snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as MerchOrder),
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "merchOrders"),
    );
    lazySubsRef.current.set("merchOrders", unsub);
  }, [user]);

  const ensurePolls = useCallback(() => {
    if (!user || lazySubsRef.current.has("polls")) return;
    const unsub = onSnapshot(
      collection(db, "polls"),
      (snapshot) => {
        setPolls(
          snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Poll),
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "polls"),
    );
    lazySubsRef.current.set("polls", unsub);
  }, [user]);

  const ensurePollResponses = useCallback(() => {
    if (!user || lazySubsRef.current.has("pollResponses")) return;
    const unsub = onSnapshot(
      collection(db, "pollResponses"),
      (snapshot) => {
        setPollResponses(
          snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as PollResponse),
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "pollResponses"),
    );
    lazySubsRef.current.set("pollResponses", unsub);
  }, [user]);

  const ensureBadges = useCallback(() => {
    if (!user || lazySubsRef.current.has("badges")) return;
    const unsub = onSnapshot(
      collection(db, "badges"),
      (snapshot) => {
        setBadges(
          snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Badge),
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "badges"),
    );
    lazySubsRef.current.set("badges", unsub);
  }, [user]);

  const getActor = (): { actorId: string; actorName: string; actorType: AuditActorType } => {
    const uid = user?.uid || "unknown";
    const au = appUsers.find(u => u.id === uid);
    const pl = players.find(p => p.id === uid);
    return {
      actorId: uid,
      actorName: au?.name || pl?.name || user?.displayName || "Unknown",
      actorType: au?.role === "admin" ? "admin" : "player",
    };
  };

  const addBadge = async (badge: Omit<Badge, "id">) => {
    const id = crypto.randomUUID();
    const docRef = doc(db, "badges", id);
    try {
      await setDoc(docRef, cleanPayload({ ...badge }));
      logAudit({ ...getActor(), action: "created", entity: "badge", entityId: id, entityLabel: badge.badgeType, changes: [], summary: `Awarded "${badge.badgeType}" badge to ${badge.playerName}` });
      return id;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `badges/${id}`);
    }
  };

  const updateBadge = async (badgeId: string, updates: Partial<Badge>) => {
    try {
      const oldBadge = badges.find(b => b.id === badgeId);
      await updateDoc(doc(db, "badges", badgeId), cleanPayload({
        ...updates,
      }));
      logAudit({ ...getActor(), action: "updated", entity: "badge", entityId: badgeId, entityLabel: oldBadge?.badgeType || badgeId, changes: diffChanges(oldBadge, updates), summary: `Updated badge "${oldBadge?.badgeType || badgeId}"` });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `badges/${badgeId}`);
    }
  };

  const deleteBadge = async (badgeId: string) => {
    const oldBadge = badges.find(b => b.id === badgeId);
    try {
      await deleteDoc(doc(db, "badges", badgeId));
      logAudit({ ...getActor(), action: "deleted", entity: "badge", entityId: badgeId, entityLabel: oldBadge?.badgeType || badgeId, changes: [], summary: `Removed "${oldBadge?.badgeType || ""}" badge from ${oldBadge?.playerName || "player"}` });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `badges/${badgeId}`);
    }
  };

  const ensureBadgeTypeDefs = useCallback(() => {
    if (!user || lazySubsRef.current.has("badgeTypeDefs")) return;
    const unsub = onSnapshot(
      collection(db, "badgeTypes"),
      (snapshot) => {
        setBadgeTypeDefs(
          snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as BadgeTypeDef),
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "badgeTypes"),
    );
    lazySubsRef.current.set("badgeTypeDefs", unsub);
  }, [user]);

  const addBadgeTypeDef = async (def: Omit<BadgeTypeDef, "createdAt" | "updatedAt">) => {
    const docRef = doc(db, "badgeTypes", def.id);
    try {
      await setDoc(docRef, cleanPayload({ ...def, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
      logAudit({ ...getActor(), action: "created", entity: "badge_type", entityId: def.id, entityLabel: def.label, changes: [], summary: `Created badge type "${def.label}"` });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `badgeTypes/${def.id}`);
    }
  };

  const updateBadgeTypeDef = async (defId: string, updates: Partial<BadgeTypeDef>) => {
    try {
      const oldDef = badgeTypeDefs.find(d => d.id === defId);
      await updateDoc(doc(db, "badgeTypes", defId), cleanPayload({ ...updates, updatedAt: serverTimestamp() }));
      logAudit({ ...getActor(), action: "updated", entity: "badge_type", entityId: defId, entityLabel: oldDef?.label || defId, changes: diffChanges(oldDef, updates), summary: `Updated badge type "${oldDef?.label || defId}"` });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `badgeTypes/${defId}`);
    }
  };

  const deleteBadgeTypeDef = async (defId: string) => {
    const oldDef = badgeTypeDefs.find(d => d.id === defId);
    try {
      await deleteDoc(doc(db, "badgeTypes", defId));
      logAudit({ ...getActor(), action: "deleted", entity: "badge_type", entityId: defId, entityLabel: oldDef?.label || defId, changes: [], summary: `Deleted badge type "${oldDef?.label || defId}"` });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `badgeTypes/${defId}`);
    }
  };

  const recordCatch = async (entry: Omit<CatchLogEntry, "id" | "recordedAt">) => {
    try {
      const playerRef = doc(db, "players", entry.playerId);
      const field = entry.type === "dropped" ? "droppedCatches" : "stunningCatches";
      await updateDoc(playerRef, {
        [field]: increment(entry.count),
        updatedAt: serverTimestamp(),
      });
      await addDoc(collection(db, "catchLog"), cleanPayload({
        ...entry,
        recordedAt: serverTimestamp(),
      }));
      logAudit({ ...getActor(), action: "created", entity: "catch", entityId: entry.playerId, entityLabel: entry.playerName, changes: [{ field: "type", newValue: entry.type }, { field: "count", newValue: String(entry.count) }], summary: `Recorded ${entry.count} ${entry.type} catch${entry.count !== 1 ? "es" : ""} for ${entry.playerName}` });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `players/${entry.playerId}`);
    }
  };

  const loadMoreNotifications = useCallback(async () => {
    if (
      !user ||
      !notificationsCursorRef.current ||
      notificationsLoadingMore ||
      !notificationsHasMore
    )
      return;
    setNotificationsLoadingMore(true);
    try {
      const q = query(
        collection(db, "notifications"),
        orderBy("createdAt", "desc"),
        startAfter(notificationsCursorRef.current),
        limit(NOTIFICATIONS_PAGE_SIZE),
      );
      const snap = await getDocs(q);
      const older = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as Notification,
      );
      setNotifications((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        const additions = older.filter((n) => !seen.has(n.id));
        return [...prev, ...additions];
      });
      notificationsCursorRef.current =
        snap.docs[snap.docs.length - 1] || notificationsCursorRef.current;
      if (snap.docs.length < NOTIFICATIONS_PAGE_SIZE) {
        setNotificationsHasMore(false);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, "notifications");
    } finally {
      setNotificationsLoadingMore(false);
    }
  }, [user, notificationsLoadingMore, notificationsHasMore]);

  // ---- Refresh helpers for one-shot static collections ----
  const refreshAppConfig = useCallback(async () => {
    try {
      const snap = await getDoc(doc(db, "appConfig", "default"));
      if (snap.exists()) {
        setAppConfig({ ...(snap.data() as AppConfig), id: snap.id });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, "appConfig");
    }
  }, []);

  const refreshGrounds = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, "grounds"));
      setGrounds(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Ground));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, "grounds");
    }
  }, []);

  const refreshTournaments = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, "tournaments"));
      setTournaments(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Tournament),
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, "tournaments");
    }
  }, []);

  const refreshSubscriptionPlans = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, "subscriptionPlans"));
      setSubscriptionPlans(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SubscriptionPlan),
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, "subscriptionPlans");
    }
  }, []);

  const refreshFeeTemplates = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, "feeTemplates"));
      setFeeTemplates(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FeeTemplate),
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, "feeTemplates");
    }
  }, []);

  const refreshFeePlans = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, "feePlans"));
      setFeePlans(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FeePlan),
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, "feePlans");
    }
  }, []);

  const refreshMerchandises = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, "merchandises"));
      setMerchandises(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Merchandise),
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, "merchandises");
    }
  }, []);

  const ensureOtherFees = useCallback(() => {
    if (!user || lazySubsRef.current.has("allOtherFees")) return;
    const unsub = onSnapshot(
      collectionGroup(db, "otherFees"),
      (snapshot) => {
        setOtherFees(
          snapshot.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() }) as OtherFee,
          ),
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "otherFees"),
    );
    lazySubsRef.current.set("allOtherFees", unsub);
  }, [user]);

  const ensureAllAppUsers = useCallback(() => {
    if (!user || lazySubsRef.current.has("allAppUsers")) return;
    const unsub = onSnapshot(
      collection(db, "appUsers"),
      (snap) => {
        setAppUsers(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as AppUser)
            .filter((u) => {
              const nameLower = (u.name || "").toLowerCase();
              const emailLower = (u.email || "").toLowerCase();
              return !nameLower.includes("demo") && !emailLower.includes("demo");
            }),
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "appUsers"),
    );
    lazySubsRef.current.set("allAppUsers", unsub);
  }, [user]);

  const ensureSubscriptionHistory = useCallback(() => {
    if (!user || lazySubsRef.current.has("allSubscriptionHistory")) return;
    const unsub = onSnapshot(
      collection(db, "subscriptionHistory"),
      (snap) => {
        setSubscriptionHistory(
          snap.docs.map(
            (d) => ({ id: d.id, ...d.data() }) as SubscriptionHistory,
          ),
        );
      },
      (err) =>
        handleFirestoreError(err, OperationType.LIST, "subscriptionHistory"),
    );
    lazySubsRef.current.set("allSubscriptionHistory", unsub);
  }, [user]);

  const ensureTournaments = useCallback(async () => {
    if (!user || loadedOneShotsRef.current.has("tournaments")) return;
    loadedOneShotsRef.current.add("tournaments");
    try {
      const snap = await getDocs(collection(db, "tournaments"));
      setTournaments(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Tournament),
      );
    } catch (err) {
      loadedOneShotsRef.current.delete("tournaments");
      handleFirestoreError(err, OperationType.LIST, "tournaments");
    }
  }, [user]);

  const ensureSubscriptionPlans = useCallback(async () => {
    if (!user || loadedOneShotsRef.current.has("subscriptionPlans")) return;
    loadedOneShotsRef.current.add("subscriptionPlans");
    try {
      const snap = await getDocs(collection(db, "subscriptionPlans"));
      setSubscriptionPlans(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SubscriptionPlan),
      );
    } catch (err) {
      loadedOneShotsRef.current.delete("subscriptionPlans");
      handleFirestoreError(err, OperationType.LIST, "subscriptionPlans");
    }
  }, [user]);

  const ensureFeeTemplates = useCallback(async () => {
    if (!user || loadedOneShotsRef.current.has("feeTemplates")) return;
    loadedOneShotsRef.current.add("feeTemplates");
    try {
      const snap = await getDocs(collection(db, "feeTemplates"));
      setFeeTemplates(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FeeTemplate),
      );
    } catch (err) {
      loadedOneShotsRef.current.delete("feeTemplates");
      handleFirestoreError(err, OperationType.LIST, "feeTemplates");
    }
  }, [user]);

  const ensureFeePlans = useCallback(async () => {
    if (!user || loadedOneShotsRef.current.has("feePlans")) return;
    loadedOneShotsRef.current.add("feePlans");
    try {
      const snap = await getDocs(collection(db, "feePlans"));
      setFeePlans(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FeePlan),
      );
    } catch (err) {
      loadedOneShotsRef.current.delete("feePlans");
      handleFirestoreError(err, OperationType.LIST, "feePlans");
    }
  }, [user]);

  const ensureMerchandises = useCallback(async () => {
    if (!user || loadedOneShotsRef.current.has("merchandises")) return;
    loadedOneShotsRef.current.add("merchandises");
    try {
      const snap = await getDocs(collection(db, "merchandises"));
      setMerchandises(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Merchandise),
      );
    } catch (err) {
      loadedOneShotsRef.current.delete("merchandises");
      handleFirestoreError(err, OperationType.LIST, "merchandises");
    }
  }, [user]);

  const ensureOutOfPlays = useCallback(() => {
    if (!user || lazySubsRef.current.has("outOfPlays")) return;
    const unsub = onSnapshot(
      collection(db, "outOfPlays"),
      (snapshot) => {
        setOutOfPlays(
          snapshot.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() }) as OutOfPlay,
          ),
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "outOfPlays"),
    );
    lazySubsRef.current.set("outOfPlays", unsub);
  }, [user]);

  const updateAppConfig = async (config: Partial<AppConfig>) => {
    try {
      // Defense-in-depth: strip any secret field from writes. These belong in
      // server-side env vars only. The Firestore rules also block them, but
      // dropping them here means we don't burn a rejected write.
      const SECRET_FIELDS = new Set([
        "razorpayKeySecret",
        "smtpPassword",
        "resendApiKey",
        "whatsappAccessToken",
      ]);
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(cleanPayload(config))) {
        if (!SECRET_FIELDS.has(k)) filtered[k] = v;
      }
      const oldConfig = appConfig ? { ...appConfig } : undefined;
      await updateDoc(doc(db, "appConfig", "default"), filtered);
      logAudit({ ...getActor(), action: "updated", entity: "settings", entityId: "default", entityLabel: "App Settings", changes: diffChanges(oldConfig, filtered as Record<string, any>), summary: `Updated app settings` });
      await refreshAppConfig();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, "appConfig/default");
      // Re-throw so callers (the Settings save handler) can surface a real
      // error to the admin. Without this a permission-denied write dies
      // silently and the "Settings saved successfully" alert fires anyway.
      throw err;
    }
  };

  const updateAppUserRole = async (userId: string, role: string) => {
    try {
      const oldUser = appUsers.find(u => u.id === userId);
      await updateDoc(doc(db, "appUsers", userId), { role });
      logAudit({ ...getActor(), action: "updated", entity: "user_role", entityId: userId, entityLabel: oldUser?.name || userId, changes: [{ field: "role", oldValue: oldUser?.role, newValue: role }], summary: `Changed role of ${oldUser?.name || userId} to "${role}"` });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `appUsers/${userId}`);
    }
  };

  const updateAppUserProfile = async (
    userId: string,
    profile: Partial<AppUser>,
  ) => {
    try {
      await setDoc(doc(db, "appUsers", userId), cleanPayload(profile), { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `appUsers/${userId}`);
    }
  };

  const addGround = async (
    ground: Omit<Ground, "id" | "createdAt" | "updatedAt">,
  ) => {
    const id = crypto.randomUUID();
    const docRef = doc(db, "grounds", id);
    try {
      await setDoc(docRef, cleanPayload({
        ...ground,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
      logAudit({ ...getActor(), action: "created", entity: "ground", entityId: id, entityLabel: ground.name, changes: [], summary: `Added ground "${ground.name}"` });
      await refreshGrounds();
      return id;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `grounds/${id}`);
    }
  };

  const updateGround = async (groundId: string, ground: Partial<Ground>) => {
    const oldGround = grounds.find(g => g.id === groundId);
    const docRef = doc(db, "grounds", groundId);
    try {
      await updateDoc(
        docRef,
        cleanPayload({ ...ground, updatedAt: serverTimestamp() }),
      );
      logAudit({ ...getActor(), action: "updated", entity: "ground", entityId: groundId, entityLabel: oldGround?.name || groundId, changes: diffChanges(oldGround, ground), summary: `Updated ground "${oldGround?.name || groundId}"` });
      await refreshGrounds();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `grounds/${groundId}`);
    }
  };

  const deleteGround = async (groundId: string) => {
    const oldGround = grounds.find(g => g.id === groundId);
    try {
      await deleteDoc(doc(db, "grounds", groundId));
      logAudit({ ...getActor(), action: "deleted", entity: "ground", entityId: groundId, entityLabel: oldGround?.name || groundId, changes: [], summary: `Deleted ground "${oldGround?.name || groundId}"` });
      await refreshGrounds();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `grounds/${groundId}`);
    }
  };

  const addTournament = async (
    tournament: Omit<Tournament, "id" | "createdAt" | "updatedAt">,
  ) => {
    const id = crypto.randomUUID();
    const docRef = doc(db, "tournaments", id);
    try {
      await setDoc(
        docRef,
        cleanPayload({
          ...tournament,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
      );
      logAudit({ ...getActor(), action: "created", entity: "tournament", entityId: id, entityLabel: tournament.name, changes: [], summary: `Created tournament "${tournament.name}"` });
      await refreshTournaments();
      return id;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `tournaments/${id}`);
      throw err; // re-throw so the caller can surface a real error to the admin
    }
  };

  const updateTournament = async (
    tournamentId: string,
    tournament: Partial<Tournament>,
  ) => {
    const oldTournament = tournaments.find(t => t.id === tournamentId);
    const docRef = doc(db, "tournaments", tournamentId);
    try {
      await updateDoc(
        docRef,
        cleanPayload({ ...tournament, updatedAt: serverTimestamp() }),
      );
      logAudit({ ...getActor(), action: "updated", entity: "tournament", entityId: tournamentId, entityLabel: oldTournament?.name || tournamentId, changes: diffChanges(oldTournament, tournament), summary: `Updated tournament "${oldTournament?.name || tournamentId}"` });
      await refreshTournaments();
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `tournaments/${tournamentId}`,
      );
      throw err;
    }
  };

  // Guards against orphaning upcoming matches. Callers should first
  // check `matches.some(m => m.tournamentId === id && !isPastMatch(m))`
  // and prompt the admin; this is a raw delete, not a policy layer.
  const deleteTournament = async (tournamentId: string) => {
    const oldTournament = tournaments.find(t => t.id === tournamentId);
    try {
      await deleteDoc(doc(db, "tournaments", tournamentId));
      logAudit({ ...getActor(), action: "deleted", entity: "tournament", entityId: tournamentId, entityLabel: oldTournament?.name || tournamentId, changes: [], summary: `Deleted tournament "${oldTournament?.name || tournamentId}"` });
      await refreshTournaments();
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.DELETE,
        `tournaments/${tournamentId}`,
      );
      throw err;
    }
  };

  // Fire-and-forget push to the public Google Calendar. Never blocks or
  // fails a match mutation — a calendar hiccup must not stop an admin
  // scheduling a match. The admin Settings card has a "Resync all"
  // button to reconcile if a push is missed.
  const syncMatchToCalendar = (
    action: "upsert" | "delete",
    matchId: string,
    googleEventId?: string,
  ) => {
    (async () => {
      try {
        const currentUser = auth.currentUser;
        if (!currentUser) return;
        const idToken = await currentUser.getIdToken();
        await fetch("/api/calendar/sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ action, matchId, googleEventId }),
        });
      } catch (err) {
        console.warn("Calendar sync skipped", err);
      }
    })();
  };

  const addMatch = async (
    match: Omit<Match, "id" | "createdAt" | "updatedAt">,
  ) => {
    const id = crypto.randomUUID();
    const docRef = doc(db, "matches", id);
    try {
      await setDoc(docRef, cleanPayload({
        ...match,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
      // Notify all verified/active players in-app. Fire-and-forget so a
      // notification-write failure doesn't fail the whole match creation.
      const notifyRecipients = players.filter(
        (p) => !p.disabled && p.inviteStatus === "Verified",
      );
      for (const p of notifyRecipients) {
        createNotification(
          p.id,
          "New Match Scheduled",
          `A new ${match.format} match against ${match.opponent} on ${match.date} has been added.`,
          "in_app",
        );
      }

      // Batched payment doc creation. Previously we did 99 sequential
      // setDocs — one HTTP round-trip per player. writeBatch commits up to
      // 500 ops in a single round-trip.
      // Skip trashed / rejected / still-pending signups so admins don't
      // see rows for people who can never pay.
      const chargeablePlayers = players.filter(
        (p) =>
          !p.disabled &&
          p.inviteStatus !== "Rejected" &&
          p.inviteStatus !== "Pending",
      );
      const BATCH_LIMIT = 400;
      for (let i = 0; i < chargeablePlayers.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        for (const p of chargeablePlayers.slice(i, i + BATCH_LIMIT)) {
          const payId = crypto.randomUUID();
          batch.set(doc(db, "matches", id, "payments", payId), {
            id: payId,
            matchId: id,
            playerId: p.id,
            status: "Not Playing",
            availability: "Pending",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }
      logAudit({ ...getActor(), action: "created", entity: "match", entityId: id, entityLabel: `vs ${match.opponent}`, changes: [], summary: `Created ${match.matchType} match vs ${match.opponent} on ${match.date}` });
      syncMatchToCalendar("upsert", id);
      return id;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `matches/${id}`);
    }
  };

  const updateMatch = async (match: Match) => {
    const oldMatch = matches.find(m => m.id === match.id);
    const docRef = doc(db, "matches", match.id);
    const { id, createdAt, updatedAt, ...data } = match;
    try {
      await updateDoc(
        docRef,
        cleanPayload({ ...data, updatedAt: serverTimestamp() }),
      );
      logAudit({ ...getActor(), action: "updated", entity: "match", entityId: match.id, entityLabel: `vs ${match.opponent}`, changes: diffChanges(oldMatch, data), summary: `Updated match vs ${match.opponent} on ${match.date}` });
      // Notify all players individually
      for (const p of players) {
        if (!p.disabled && p.inviteStatus === "Verified") {
          createNotification(
            p.id,
            "Match Updated",
            `The match against ${match.opponent} on ${match.date} has been updated.`,
            "in_app",
          );
        }
      }
      // Push the edit to the public calendar (the route deletes the event
      // itself if the match was archived).
      syncMatchToCalendar("upsert", match.id);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `matches/${match.id}`);
    }
  };

  const bulkUpdateMatches = async (updates: { match: Match; changes: Partial<Match> }[]) => {
    if (updates.length === 0) return;
    const BATCH_LIMIT = 400;
    for (let i = 0; i < updates.length; i += BATCH_LIMIT) {
      const chunk = updates.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(db);
      for (const { match, changes } of chunk) {
        const { id, createdAt, updatedAt, ...existing } = match;
        batch.update(doc(db, "matches", id), cleanPayload({ ...changes, updatedAt: serverTimestamp() }));
      }
      await batch.commit();
    }
    for (const { match, changes } of updates) {
      const oldMatch = matches.find(m => m.id === match.id);
      logAudit({ ...getActor(), action: "updated", entity: "match", entityId: match.id, entityLabel: `vs ${match.opponent}`, changes: diffChanges(oldMatch, changes), summary: `Updated match vs ${match.opponent} on ${match.date}` });
      syncMatchToCalendar("upsert", match.id);
    }
  };

  const deleteMatch = async (matchId: string) => {
    const oldMatch = matches.find((m) => m.id === matchId);
    const docRef = doc(db, "matches", matchId);
    const existingEventId = oldMatch?.googleEventId;
    try {
      await deleteDoc(docRef);
      logAudit({ ...getActor(), action: "deleted", entity: "match", entityId: matchId, entityLabel: `vs ${oldMatch?.opponent || ""}`, changes: [], summary: `Deleted match vs ${oldMatch?.opponent || "unknown"} on ${oldMatch?.date || ""}` });
      if (existingEventId) {
        syncMatchToCalendar("delete", matchId, existingEventId);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `matches/${matchId}`);
      throw err;
    }
  };

  const addPlayer = async (
    player: Partial<Player> & Pick<Player, "name" | "mobile">,
  ) => {
    const id = crypto.randomUUID();
    const docRef = doc(db, "players", id);
    try {
      await setDoc(docRef, cleanPayload({
        ...player,
        inviteStatus: player.inviteStatus || "Unverified",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
      logAudit({ ...getActor(), action: "created", entity: "player", entityId: id, entityLabel: player.name, changes: [], summary: `Added player "${player.name}"` });
      return id;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `players/${id}`);
      throw err;
    }
  };

  const updatePlayer = async (playerId: string, updates: Partial<Player>) => {
    try {
      const existingPlayer = players.find((p) => p.id === playerId);
      if (existingPlayer) {
        if (
          (updates.inviteStatus === "Accepted" ||
            updates.inviteStatus === "Verified") &&
          existingPlayer.inviteStatus !== updates.inviteStatus
        ) {
          createNotification(
            playerId,
            "Membership Approved",
            "Your club membership has been approved!",
            "email",
          );
        }
        if (
          updates.isStudioMember === true &&
          existingPlayer.isStudioMember !== true
        ) {
          createNotification(
            playerId,
            "Studio Membership Active",
            "Welcome to the Studio! You now have access to premium features.",
            "both",
          );
        }
      }

      const cleanedUpdates = cleanPayload({
        ...updates,
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "players", playerId), cleanedUpdates);
      logAudit({ ...getActor(), action: "updated", entity: "player", entityId: playerId, entityLabel: existingPlayer?.name || playerId, changes: diffChanges(existingPlayer, updates), summary: `Updated player "${existingPlayer?.name || playerId}"` });

      // Auto-sync updates to appUsers if matching user is found
      const playerObj = players.find((p) => p.id === playerId);
      const appUserToUpdate =
        appUsers.find((u) => u.id === playerId) ||
        appUsers.find(
          (u) => u.mobile && playerObj && u.mobile === playerObj.mobile,
        );

      if (appUserToUpdate) {
        const appUserUpdates: Partial<AppUser> = {};
        const fieldsToSync: (keyof Player & keyof AppUser)[] = [
          "name",
          "mobile",
          "dob",
          "locality",
          "bloodGroup",
          "emergencyContact",
          "battingStyle",
          "bowlingStyle",
          "isWicketKeeper",
          "chestSize",
          "jerseyNumber",
          "isStudioMember",
          "studioStartDate",
          "studioEndDate",
          "studioPlan",
          "lastPaidDate",
          "lastPaidAmount",
          "studioExpiryDate",
          "kavachJoining",
        ];

        fieldsToSync.forEach((field) => {
          if (updates[field] !== undefined) {
            (appUserUpdates as any)[field] = updates[field];
          }
        });

        const cleanedAppUserUpdates = cleanPayload(appUserUpdates);
        if (Object.keys(cleanedAppUserUpdates).length > 0) {
          await updateDoc(
            doc(db, "appUsers", appUserToUpdate.id),
            cleanedAppUserUpdates,
          );
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `players/${playerId}`);
    }
  };

  const deletePlayer = async (playerId: string) => {
    const p = players.find(x => x.id === playerId);
    try {
      await deleteDoc(doc(db, "players", playerId));
      logAudit({ ...getActor(), action: "deleted", entity: "player", entityId: playerId, entityLabel: p?.name || playerId, changes: [], summary: `Deleted player "${p?.name || playerId}"` });

      // Also attempt to delete from appUsers if they exist
      if (p && p.authUid) {
        try {
          await deleteDoc(doc(db, "appUsers", p.authUid));
        } catch (err) {
          // Ignore if appUsers deletion fails (they might not have an appUsers doc, or permissions might not allow it)
          console.warn("Could not delete appUsers document for player", err);
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `players/${playerId}`);
    }
  };

  /**
   * Merge a duplicate "loser" player profile into a "keeper" profile.
   * - Reparents every matches/{id}/payments doc owned by loser → keeper
   *   (kept as separate rows; duplicates are not deduped, per admin call)
   * - Moves loser's players/{loserId}/otherFees subcollection under keeper
   * - Reparents merchOrders where playerId === loserId → keeper
   * - Fills in only the empty fields on keeper from loser (does not
   *   overwrite anything the keeper already has)
   * - Trashes loser with disabled=true, disabledAt=now, mergedInto=keeperId
   * Requires ensurePayments()/ensureOtherFees() to have been triggered so
   * the in-memory store lists are populated; the caller (admin viewing
   * Squad > Directory) already gets both via PAYMENT_TABS / OTHER_FEE_TABS.
   */
  const mergePlayer = async (loserId: string, keeperId: string) => {
    if (loserId === keeperId) return;
    // Delegate to the server-side admin-SDK endpoint. It bypasses
    // Firestore security rules (which forbid changing payments.playerId
    // for non-privileged writes), and it does the full atomic reparent
    // in one place so we don't depend on lazy client subscriptions
    // being warm or on rules being re-deployed.
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error("Not signed in.");
    const idToken = await currentUser.getIdToken();
    const loserPlayer = players.find(p => p.id === loserId);
    const keeperPlayer = players.find(p => p.id === keeperId);
    const res = await fetch("/api/admin/merge-players", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ loserId, keeperId }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const err: any = new Error(
        errBody?.error || `Merge failed with HTTP ${res.status}`,
      );
      if (errBody?.code) err.code = errBody.code;
      throw err;
    }
    logAudit({ ...getActor(), action: "updated", entity: "player", entityId: keeperId, entityLabel: keeperPlayer?.name || keeperId, changes: [{ field: "mergedFrom", newValue: loserPlayer?.name || loserId }], summary: `Merged player "${loserPlayer?.name || loserId}" into "${keeperPlayer?.name || keeperId}"` });
    // The server merge doesn't push snapshot updates for the docs it
    // rewrites — the client's onSnapshot listeners will catch up when
    // Firestore emits the change events (usually within a second).
  };

  const notifyPlayerPayment = (playerId: string, matchId: string) => {
    const p = players.find((p) => p.id === playerId);
    const m = matches.find((m) => m.id === matchId);
    if (p && p.mobile && m) {
      const link = `${window.location.origin}/pay/${p.id}`;
      const text = encodeURIComponent(
        `Hi ${p.name}, gentle reminder to clear your match fee of ₹${m.fee} for the match against ${m.opponent} on ${m.date}.\n\nPlease clear them at your earliest convenience using this link: ${link}`
      );
      window.open(`https://wa.me/${p.mobile.replace("+", "")}?text=${text}`, "_blank");
    } else if (p) {
      alert(`No mobile number found for ${p.name}`);
    }
  };

  const updatePaymentStatus = async (
    paymentId: string,
    status: MatchPayment["status"],
    matchId: string,
    availability?: MatchPayment["availability"],
    paymentMethod?: "manual" | "razorpay",
    manualBy?: string,
  ) => {
    setPayments((prev) =>
      prev.map((p) => (p.id === paymentId ? { ...p, status, ...(availability ? { availability } : {}), ...(paymentMethod ? { paymentMethod } : {}), ...(manualBy ? { manualBy } : {}) } : p)),
    );
    const docRef = doc(db, "matches", matchId, "payments", paymentId);
    try {
      const updateData: any = { status, updatedAt: serverTimestamp() };
      if (availability) updateData.availability = availability;
      if (paymentMethod) updateData.paymentMethod = paymentMethod;
      if (manualBy) updateData.manualBy = manualBy;
      await updateDoc(docRef, updateData);

      const payment = payments.find((p) => p.id === paymentId);
      const player = players.find((p) => p.id === payment?.playerId);
      const match = matches.find((m) => m.id === matchId);

      const auditAction = status === "Paid" ? "paid" as const : "status_change" as const;
      logAudit({ ...getActor(), action: auditAction, entity: "payment", entityId: paymentId, entityLabel: `${player?.name || "Player"} - ${match?.opponent || matchId}`, changes: [{ field: "status", oldValue: payment?.status, newValue: status }, ...(availability ? [{ field: "availability", oldValue: payment?.availability, newValue: availability }] : [])], summary: `${player?.name || "Player"} ${status === "Paid" ? "paid" : `status → ${status}`} for match vs ${match?.opponent || ""}` });
      if (status === "Paid" && match && player) {
        createNotification(
          player.id,
          "Payment Successful",
          `Your payment for the match against ${match.opponent} was successful.`,
          "in_app"
        );
        createNotification(
          "admin",
          "Payment Received",
          `${player.name} has paid for the match against ${match.opponent}.`,
          "in_app"
        );
      } else if (status === "Failed" && match && player) {
        createNotification(
          "admin",
          "Payment Failed",
          `${player.name}'s payment for the match against ${match.opponent} failed.`,
          "in_app"
        );
      }
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `matches/${matchId}/payments/${paymentId}`,
      );
    }
  };

  const updateMatchAvailability = async (
    paymentId: string,
    availability: MatchPayment["availability"],
    matchId: string,
  ) => {
    setPayments((prev) =>
      prev.map((p) => (p.id === paymentId ? { ...p, availability } : p)),
    );
    const docRef = doc(db, "matches", matchId, "payments", paymentId);
    try {
      const p = payments.find((p) => p.id === paymentId);
      const playerObj = players.find((pl) => pl.id === p?.playerId);
      await updateDoc(docRef, { availability, updatedAt: serverTimestamp() });
      logAudit({ ...getActor(), action: "updated", entity: "payment", entityId: paymentId, entityLabel: `${playerObj?.name || "Player"} availability`, changes: [{ field: "availability", oldValue: p?.availability, newValue: availability }], summary: `${playerObj?.name || "Player"} changed availability to ${availability}` });
      createNotification(
        "admin",
        "Player Availability Changed",
        `${playerObj?.name || "A player"} changed their availability to ${availability}.`,
        "in_app",
      );
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `matches/${matchId}/payments/${paymentId}`,
      );
    }
  };

  const addPaymentWithAvailability = async (
    matchId: string,
    playerId: string,
    availability: MatchPayment["availability"],
  ) => {
    const id = crypto.randomUUID();
    const initialStatus =
      availability === "Confirmed" ? "Unpaid" : "Not Playing";
    setPayments((prev) => [
      ...prev,
      {
        id,
        matchId,
        playerId,
        status: initialStatus,
        availability,
      } as MatchPayment,
    ]);
    const docRef = doc(db, "matches", matchId, "payments", id);
    try {
      await setDoc(docRef, {
        id,
        matchId,
        playerId,
        status: initialStatus,
        availability,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const pName = players.find(pl => pl.id === playerId)?.name || playerId;
      const mLabel = matches.find(m => m.id === matchId)?.opponent || matchId;
      logAudit({ ...getActor(), action: "created", entity: "payment", entityId: id, entityLabel: `${pName} - ${mLabel}`, changes: [{ field: "availability", newValue: availability }], summary: `${pName} set availability to ${availability} for match vs ${mLabel}` });
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `matches/${matchId}/payments/${id}`,
      );
    }
  };

  const addOtherFee = async (
    playerId: string,
    title: string,
    amount: number,
    comment?: string,
    templateId?: string,
  ) => {
    const id = crypto.randomUUID();
    const docRef = doc(db, "players", playerId, "otherFees", id);
    try {
      await setDoc(docRef, {
        id,
        playerId,
        title,
        amount,
        comment: comment || "",
        templateId: templateId || "",
        status: "Unpaid",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const p = players.find((p) => p.id === playerId);
      logAudit({ ...getActor(), action: "created", entity: "fee", entityId: id, entityLabel: title, changes: [{ field: "amount", newValue: `₹${amount}` }], summary: `Added fee "${title}" (₹${amount}) for ${p?.name || playerId}` });
      createNotification(
        playerId,
        "Fee Added",
        `A new fee "${title}" of ₹${amount} was added.`,
        "email",
      );
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `players/${playerId}/otherFees/${id}`,
      );
    }
  };

  const updateOtherFeeStatus = async (
    playerId: string,
    feeId: string,
    status: OtherFee["status"],
    paymentMethod?: "manual" | "razorpay",
  ) => {
    const docRef = doc(db, "players", playerId, "otherFees", feeId);
    try {
      const updateData: any = { status, updatedAt: serverTimestamp() };
      if (paymentMethod) updateData.paymentMethod = paymentMethod;
      await updateDoc(docRef, updateData);

      const player = players.find((p) => p.id === playerId);
      const fee = otherFees.find((f) => f.id === feeId);
      const auditAction = status === "Paid" ? "paid" as const : "status_change" as const;
      logAudit({ ...getActor(), action: auditAction, entity: "fee", entityId: feeId, entityLabel: fee?.title || feeId, changes: [{ field: "status", oldValue: fee?.status, newValue: status }], summary: `${player?.name || "Player"} ${status === "Paid" ? "paid" : `status → ${status}`} fee "${fee?.title || ""}"` });

      if (status === "Paid" && player && fee) {
        createNotification(
          player.id,
          "Payment Successful",
          `Your payment for the fee "${fee.title}" was successful.`,
          "in_app"
        );
        // Notify Admin
        createNotification(
          "admin",
          "Fee Payment Received",
          `${player.name} has paid the fee "${fee.title}".`,
          "in_app"
        );
      } else if (status === "Failed" && player && fee) {
        // Notify Admin
        createNotification(
          "admin",
          "Fee Payment Failed",
          `${player.name}'s payment for the fee "${fee.title}" failed.`,
          "in_app"
        );
      }
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `players/${playerId}/otherFees/${feeId}`,
      );
    }
  };

  const deleteOtherFee = async (playerId: string, feeId: string, cancelledBy?: string) => {
    const oldFee = otherFees.find(f => f.id === feeId);
    const playerName = players.find(p => p.id === playerId)?.name || playerId;
    const docRef = doc(db, "players", playerId, "otherFees", feeId);
    try {
      if (cancelledBy) {
        await updateDoc(docRef, { status: "Cancelled", cancelledBy, cancelledAt: serverTimestamp(), updatedAt: serverTimestamp() });
        setOtherFees((prev) => prev.map((f) => f.id === feeId ? { ...f, status: "Cancelled" as const, cancelledBy } : f));
        logAudit({ ...getActor(), action: "status_change", entity: "fee", entityId: feeId, entityLabel: oldFee?.title || feeId, changes: [{ field: "status", oldValue: oldFee?.status, newValue: "Cancelled" }], summary: `Cancelled fee "${oldFee?.title || ""}" for ${playerName}` });
      } else {
        await deleteDoc(docRef);
        logAudit({ ...getActor(), action: "deleted", entity: "fee", entityId: feeId, entityLabel: oldFee?.title || feeId, changes: [], summary: `Deleted fee "${oldFee?.title || ""}" for ${playerName}` });
      }
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.DELETE,
        `players/${playerId}/otherFees/${feeId}`,
      );
    }
  };

  const addFeeTemplate = async (name: string, amount: number) => {
    const id = crypto.randomUUID();
    const docRef = doc(db, "feeTemplates", id);
    try {
      await setDoc(docRef, {
        id,
        name,
        amount,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      logAudit({ ...getActor(), action: "created", entity: "fee", entityId: id, entityLabel: name, changes: [{ field: "amount", newValue: `₹${amount}` }], summary: `Created fee template "${name}" (₹${amount})` });
      await refreshFeeTemplates();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `feeTemplates/${id}`);
    }
  };

  const deleteFeeTemplate = async (templateId: string) => {
    const oldTpl = feeTemplates.find(t => t.id === templateId);
    const docRef = doc(db, "feeTemplates", templateId);
    try {
      await deleteDoc(docRef);
      logAudit({ ...getActor(), action: "deleted", entity: "fee", entityId: templateId, entityLabel: oldTpl?.name || templateId, changes: [], summary: `Deleted fee template "${oldTpl?.name || templateId}"` });
      await refreshFeeTemplates();
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.DELETE,
        `feeTemplates/${templateId}`,
      );
    }
  };

  // ---- Fee Plans CRUD ----

  const addFeePlan = async (plan: Omit<FeePlan, "id" | "createdAt" | "updatedAt">) => {
    const id = crypto.randomUUID();
    const docRef = doc(db, "feePlans", id);
    try {
      await setDoc(docRef, cleanPayload({
        ...plan,
        id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
      logAudit({ ...getActor(), action: "created", entity: "fee_plan", entityId: id, entityLabel: plan.name, changes: [], summary: `Created fee plan "${plan.name}"` });
      await refreshFeePlans();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `feePlans/${id}`);
      throw err;
    }
  };

  const updateFeePlan = async (planId: string, updates: Partial<FeePlan>) => {
    const oldPlan = feePlans.find(p => p.id === planId);
    const docRef = doc(db, "feePlans", planId);
    try {
      await updateDoc(docRef, cleanPayload({ ...updates, updatedAt: serverTimestamp() }));
      logAudit({ ...getActor(), action: "updated", entity: "fee_plan", entityId: planId, entityLabel: oldPlan?.name || planId, changes: diffChanges(oldPlan, updates), summary: `Updated fee plan "${oldPlan?.name || planId}"` });
      await refreshFeePlans();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `feePlans/${planId}`);
      throw err;
    }
  };

  const deleteFeePlan = async (planId: string) => {
    const oldPlan = feePlans.find(p => p.id === planId);
    const docRef = doc(db, "feePlans", planId);
    try {
      await deleteDoc(docRef);
      logAudit({ ...getActor(), action: "deleted", entity: "fee_plan", entityId: planId, entityLabel: oldPlan?.name || planId, changes: [], summary: `Deleted fee plan "${oldPlan?.name || planId}"` });
      await refreshFeePlans();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `feePlans/${planId}`);
      throw err;
    }
  };

  const applyFeePlanToPayment = async (
    matchId: string,
    paymentId: string,
    feeOverride: number,
    planTag: string,
  ) => {
    const docRef = doc(db, "matches", matchId, "payments", paymentId);
    try {
      const updates: any = {
        feeOverride,
        planTag,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(docRef, updates);
      const pmt = payments.find(p => p.id === paymentId);
      const playerName = players.find(p => p.id === pmt?.playerId)?.name || "Player";
      logAudit({ ...getActor(), action: "updated", entity: "payment", entityId: paymentId, entityLabel: `${playerName} fee plan`, changes: [{ field: "feeOverride", newValue: `₹${feeOverride}` }, { field: "planTag", newValue: planTag }], summary: `Applied fee plan "${planTag}" (₹${feeOverride}) to ${playerName}` });
      setPayments((prev) =>
        prev.map((p) =>
          p.id === paymentId && p.matchId === matchId
            ? { ...p, ...updates, updatedAt: Timestamp.now() }
            : p,
        ),
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `payments/${paymentId}`);
    }
  };

  const clearFeeOverride = async (matchId: string, paymentId: string) => {
    const payment = payments.find(
      (p) => p.id === paymentId && p.matchId === matchId,
    );
    if (!payment) return;
    const docRef = doc(db, "matches", matchId, "payments", paymentId);
    const clearFields = {
      feeOverride: deleteField(),
      planTag: deleteField(),
      sponsoredBy: deleteField(),
      sponsoring: deleteField(),
      updatedAt: serverTimestamp(),
    };

    if (payment.sponsoredBy) {
      const sponsorPayment = payments.find(
        (p) => p.matchId === matchId && p.playerId === payment.sponsoredBy,
      );
      if (sponsorPayment) {
        const sponsorRef = doc(db, "matches", matchId, "payments", sponsorPayment.id);
        const batch = writeBatch(db);
        batch.update(docRef, { ...clearFields, status: "Unpaid" });
        batch.update(sponsorRef, {
          feeOverride: deleteField(),
          sponsoring: deleteField(),
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
        setPayments((prev) =>
          prev.map((p) => {
            if (p.id === paymentId && p.matchId === matchId) {
              const { feeOverride, planTag, sponsoredBy, sponsoring, ...rest } = p;
              return { ...rest, status: "Unpaid" as const, updatedAt: Timestamp.now() };
            }
            if (p.id === sponsorPayment.id && p.matchId === matchId) {
              const { feeOverride, sponsoring, ...rest } = p;
              return { ...rest, updatedAt: Timestamp.now() };
            }
            return p;
          }),
        );
        return;
      }
    }

    try {
      await updateDoc(docRef, clearFields);
      setPayments((prev) =>
        prev.map((p) => {
          if (p.id === paymentId && p.matchId === matchId) {
            const { feeOverride, planTag, sponsoredBy, sponsoring, ...rest } = p;
            return { ...rest, updatedAt: Timestamp.now() };
          }
          return p;
        }),
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `payments/${paymentId}`);
    }
  };

  const assignProxyPayment = async (
    matchId: string,
    sourcePaymentId: string,
    sourcePlayerName: string,
    targetPlayerId: string,
    targetPlayerName: string,
    sourceFee: number,
    matchFee: number,
  ) => {
    const sourceRef = doc(db, "matches", matchId, "payments", sourcePaymentId);
    const targetPayment = payments.find(
      (p) => p.matchId === matchId && p.playerId === targetPlayerId,
    );
    if (!targetPayment) return;
    const targetRef = doc(db, "matches", matchId, "payments", targetPayment.id);
    const newTargetFee = (targetPayment.feeOverride ?? matchFee) + sourceFee;
    const batch = writeBatch(db);
    batch.update(sourceRef, {
      feeOverride: 0,
      planTag: `Sponsored by ${targetPlayerName}`,
      sponsoredBy: targetPlayerId,
      status: "Paid",
      updatedAt: serverTimestamp(),
    });
    batch.update(targetRef, {
      feeOverride: newTargetFee,
      sponsoring: `Paying for ${sourcePlayerName}`,
      updatedAt: serverTimestamp(),
    });
    try {
      await batch.commit();
      logAudit({ ...getActor(), action: "updated", entity: "payment", entityId: sourcePaymentId, entityLabel: `${sourcePlayerName} sponsored`, changes: [{ field: "sponsoredBy", newValue: targetPlayerName }, { field: "feeOverride", newValue: "₹0" }], summary: `${targetPlayerName} is now sponsoring ${sourcePlayerName}'s match fee` });
      setPayments((prev) =>
        prev.map((p) => {
          if (p.id === sourcePaymentId && p.matchId === matchId) {
            return { ...p, feeOverride: 0, planTag: `Sponsored by ${targetPlayerName}`, sponsoredBy: targetPlayerId, status: "Paid" as const };
          }
          if (p.id === targetPayment.id && p.matchId === matchId) {
            return { ...p, feeOverride: newTargetFee, sponsoring: `Paying for ${sourcePlayerName}` };
          }
          return p;
        }),
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `payments/proxy`);
    }
  };

  const addPaymentStatus = async (
    matchId: string,
    playerId: string,
    status: MatchPayment["status"] = "Unpaid",
    availability: MatchPayment["availability"] = "Confirmed",
    guestName?: string
  ) => {
    const id = crypto.randomUUID();
    setPayments((prev) => [
      ...prev,
      {
        id,
        matchId,
        playerId,
        guestName,
        status,
        availability,
      } as MatchPayment,
    ]);
    const docRef = doc(db, "matches", matchId, "payments", id);
    try {
      const data: any = {
        id,
        matchId,
        playerId,
        status,
        availability,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (guestName) data.guestName = guestName;
      await setDoc(docRef, data);
      const pName = players.find(pl => pl.id === playerId)?.name || playerId;
      const mOpponent = matches.find(m => m.id === matchId)?.opponent || matchId;
      logAudit({ ...getActor(), action: "created", entity: "payment", entityId: id, entityLabel: `${pName} - ${mOpponent}`, changes: [{ field: "status", newValue: status }, { field: "availability", newValue: availability }, ...(guestName ? [{ field: "guestName", newValue: guestName }] : [])], summary: `Added ${guestName ? `guest "${guestName}"` : pName} to match vs ${mOpponent}` });
      if (status === "Unpaid") {
        createNotification(
          playerId,
          "Match Fee Due",
          "You have been added to a match squad and your match fee is due.",
          "both",
        );
      }
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `matches/${matchId}/payments/${id}`,
      );
      throw err;
    }
  };

  const updatePlayerStat = async (
    playerId: string,
    year: number,
    runs: number,
    wickets: number,
  ) => {
    const existingStat = playerStats.find(
      (s) => s.playerId === playerId && s.year === year,
    );
    if (existingStat) {
      const docRef = doc(db, "playerStats", existingStat.id);
      try {
        await updateDoc(docRef, {
          runs,
          wickets,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.UPDATE,
          `playerStats/${existingStat.id}`,
        );
      }
    } else {
      const id = crypto.randomUUID();
      const docRef = doc(db, "playerStats", id);
      try {
        await setDoc(docRef, {
          playerId,
          year,
          runs,
          wickets,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `playerStats/${id}`);
      }
    }
  };

  const addPost = async (
    post: Omit<Post, "id" | "createdAt" | "updatedAt" | "comments">,
  ) => {
    const id = crypto.randomUUID();
    const docRef = doc(db, "posts", id);
    try {
      await setDoc(docRef, cleanPayload({
        ...post,
        comments: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
      logAudit({ ...getActor(), action: "created", entity: "post", entityId: id, entityLabel: (post.text || "").slice(0, 40), changes: [], summary: `Created post: "${(post.text || "").slice(0, 60)}"` });
      return id;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `posts/${id}`);
    }
  };

  const updatePost = async (postId: string, text: string) => {
    try {
      const oldPost = posts.find(p => p.id === postId);
      await updateDoc(doc(db, "posts", postId), {
        text,
        updatedAt: serverTimestamp(),
      });
      logAudit({ ...getActor(), action: "updated", entity: "post", entityId: postId, entityLabel: (text || "").slice(0, 40), changes: [{ field: "text", oldValue: (oldPost?.text || "").slice(0, 60), newValue: text.slice(0, 60) }], summary: `Updated post` });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `posts/${postId}`);
    }
  };

  const deletePost = async (postId: string) => {
    const oldPost = posts.find(p => p.id === postId);
    try {
      await deleteDoc(doc(db, "posts", postId));
      logAudit({ ...getActor(), action: "deleted", entity: "post", entityId: postId, entityLabel: (oldPost?.text || "").slice(0, 40), changes: [], summary: `Deleted post` });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `posts/${postId}`);
    }
  };

  const addComment = async (
    postId: string,
    userId: string,
    userName: string,
    text: string,
  ) => {
    const existingPost = posts.find((p) => p.id === postId);
    if (!existingPost) return;

    const newComment: PostComment = {
      id: crypto.randomUUID(),
      userId,
      userName,
      text,
      createdAt: new Date().toISOString(), // Or use server timestamp appropriately, but simple string is easier for embedded array
    };

    const updatedComments = [...(existingPost.comments || []), newComment];

    try {
      await updateDoc(doc(db, "posts", postId), {
        comments: updatedComments,
      });
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `posts/${postId}/addComment`,
      );
    }
  };

  const addSubscriptionPlan = async (
    plan: Omit<SubscriptionPlan, "id" | "createdAt" | "updatedAt">,
  ) => {
    const id = crypto.randomUUID();
    const docRef = doc(db, "subscriptionPlans", id);
    try {
      await setDoc(docRef, cleanPayload({
        ...plan,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
      logAudit({ ...getActor(), action: "created", entity: "subscription", entityId: id, entityLabel: plan.name, changes: [], summary: `Created subscription plan "${plan.name}"` });
      await refreshSubscriptionPlans();
      return id;
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `subscriptionPlans/${id}`,
      );
    }
  };

  const updateSubscriptionPlan = async (plan: SubscriptionPlan) => {
    const oldPlan = subscriptionPlans.find(s => s.id === plan.id);
    const docRef = doc(db, "subscriptionPlans", plan.id);
    const { id, createdAt, updatedAt, ...data } = plan;
    try {
      await updateDoc(
        docRef,
        cleanPayload({ ...data, updatedAt: serverTimestamp() }),
      );
      logAudit({ ...getActor(), action: "updated", entity: "subscription", entityId: plan.id, entityLabel: plan.name, changes: diffChanges(oldPlan, data), summary: `Updated subscription plan "${plan.name}"` });
      await refreshSubscriptionPlans();
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `subscriptionPlans/${plan.id}`,
      );
    }
  };

  const deleteSubscriptionPlan = async (planId: string) => {
    const oldPlan = subscriptionPlans.find(s => s.id === planId);
    try {
      await deleteDoc(doc(db, "subscriptionPlans", planId));
      logAudit({ ...getActor(), action: "deleted", entity: "subscription", entityId: planId, entityLabel: oldPlan?.name || planId, changes: [], summary: `Deleted subscription plan "${oldPlan?.name || planId}"` });
      await refreshSubscriptionPlans();
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.DELETE,
        `subscriptionPlans/${planId}`,
      );
    }
  };

  const addSubscriptionHistory = async (
    history: Omit<SubscriptionHistory, "id" | "createdAt">,
  ) => {
    const id = crypto.randomUUID();
    const docRef = doc(db, "subscriptionHistory", id);
    try {
      const dataToSave = cleanPayload({ ...history, createdAt: serverTimestamp() });
      await setDoc(docRef, dataToSave);
      const playerName = players.find(p => p.id === history.playerId)?.name || history.playerId;
      logAudit({ ...getActor(), action: "updated", entity: "subscription", entityId: id, entityLabel: `${playerName} subscription`, changes: [{ field: "oldExpiryDate", oldValue: history.oldExpiryDate, newValue: undefined }, { field: "newExpiryDate", newValue: history.newExpiryDate }, { field: "paidAmount", newValue: `₹${history.paidAmount}` }], summary: `${history.adminName} renewed subscription for ${playerName} (₹${history.paidAmount})` });
      return id;
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `subscriptionHistory/${id}`,
      );
    }
  };

  const addOutOfPlay = async (data: Omit<OutOfPlay, "id" | "createdAt" | "updatedAt">) => {
    const id = crypto.randomUUID();
    try {
      await setDoc(doc(db, "outOfPlays", id), cleanPayload({ ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
      const playerName = players.find(p => p.id === data.playerId)?.name || data.playerId;
      logAudit({ ...getActor(), action: "created", entity: "out_of_play", entityId: id, entityLabel: playerName, changes: [{ field: "startDate", newValue: data.startDate }, { field: "endDate", newValue: data.endDate }], summary: `Marked ${playerName} as PNA from ${data.startDate} to ${data.endDate}` });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `outOfPlays/${id}`);
    }
  };

  const updateOutOfPlay = async (data: OutOfPlay) => {
    const oldOop = outOfPlays.find(o => o.id === data.id);
    const { id, createdAt, updatedAt, ...rest } = data;
    try {
      await updateDoc(doc(db, "outOfPlays", id), cleanPayload({ ...rest, updatedAt: serverTimestamp() }));
      const playerName = players.find(p => p.id === data.playerId)?.name || data.playerId;
      logAudit({ ...getActor(), action: "updated", entity: "out_of_play", entityId: id, entityLabel: playerName, changes: diffChanges(oldOop, rest), summary: `Updated PNA for ${playerName}` });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `outOfPlays/${id}`);
    }
  };

  const deleteOutOfPlay = async (id: string) => {
    const oldOop = outOfPlays.find(o => o.id === id);
    const playerName = oldOop ? (players.find(p => p.id === oldOop.playerId)?.name || oldOop.playerId) : id;
    try {
      await deleteDoc(doc(db, "outOfPlays", id));
      logAudit({ ...getActor(), action: "deleted", entity: "out_of_play", entityId: id, entityLabel: playerName, changes: [], summary: `Removed PNA for ${playerName}` });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `outOfPlays/${id}`);
    }
  };

  const addMerchandise = async (
    merch: Omit<Merchandise, "id" | "createdAt" | "updatedAt">,
  ) => {
    const id = crypto.randomUUID();
    const docRef = doc(db, "merchandises", id);
    try {
      await setDoc(docRef, cleanPayload({
        ...merch,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
      logAudit({ ...getActor(), action: "created", entity: "merchandise", entityId: id, entityLabel: merch.name, changes: [], summary: `Added merchandise "${merch.name}" (₹${merch.basePrice})` });
      await refreshMerchandises();
      return id;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `merchandises/${id}`);
    }
  };

  const updateMerchandise = async (id: string, merch: Partial<Merchandise>) => {
    const oldMerch = merchandises.find(m => m.id === id);
    const docRef = doc(db, "merchandises", id);
    try {
      await updateDoc(
        docRef,
        cleanPayload({ ...merch, updatedAt: serverTimestamp() }),
      );
      logAudit({ ...getActor(), action: "updated", entity: "merchandise", entityId: id, entityLabel: oldMerch?.name || id, changes: diffChanges(oldMerch, merch), summary: `Updated merchandise "${oldMerch?.name || id}"` });
      await refreshMerchandises();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `merchandises/${id}`);
    }
  };

  const deleteMerchandise = async (id: string) => {
    const oldMerch = merchandises.find(m => m.id === id);
    try {
      await deleteDoc(doc(db, "merchandises", id));
      logAudit({ ...getActor(), action: "deleted", entity: "merchandise", entityId: id, entityLabel: oldMerch?.name || id, changes: [], summary: `Deleted merchandise "${oldMerch?.name || id}"` });
      await refreshMerchandises();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `merchandises/${id}`);
    }
  };

  const addMerchOrder = async (
    order: Omit<MerchOrder, "id" | "createdAt" | "updatedAt">,
  ) => {
    const id = crypto.randomUUID();
    const docRef = doc(db, "merchOrders", id);
    try {
      await setDoc(docRef, cleanPayload({
        ...order,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
      logAudit({ ...getActor(), action: "created", entity: "merch_order", entityId: id, entityLabel: `${order.playerName} - ${order.merchName}`, changes: [], summary: `${order.playerName} ordered "${order.merchName}" (₹${order.price})` });
      return id;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `merchOrders/${id}`);
    }
  };

  const updateMerchOrder = async (id: string, order: Partial<MerchOrder>) => {
    const oldOrder = merchOrders.find(o => o.id === id);
    const docRef = doc(db, "merchOrders", id);
    try {
      await updateDoc(
        docRef,
        cleanPayload({ ...order, updatedAt: serverTimestamp() }),
      );
      logAudit({ ...getActor(), action: "updated", entity: "merch_order", entityId: id, entityLabel: `${oldOrder?.playerName || ""} - ${oldOrder?.merchName || id}`, changes: diffChanges(oldOrder, order), summary: `Updated order for "${oldOrder?.merchName || id}" by ${oldOrder?.playerName || ""}` });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `merchOrders/${id}`);
    }
  };

  const deleteMerchOrder = async (id: string) => {
    const oldOrder = merchOrders.find(o => o.id === id);
    try {
      await deleteDoc(doc(db, "merchOrders", id));
      logAudit({ ...getActor(), action: "deleted", entity: "merch_order", entityId: id, entityLabel: `${oldOrder?.playerName || ""} - ${oldOrder?.merchName || id}`, changes: [], summary: `Deleted order for "${oldOrder?.merchName || id}" by ${oldOrder?.playerName || ""}` });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `merchOrders/${id}`);
    }
  };

  const filteredPayments = useMemo(() => {
    return payments.filter((pay) => players.some((pl) => pl.id === pay.playerId));
  }, [payments, players]);

  const filteredOtherFees = useMemo(() => {
    return otherFees.filter((fee) => players.some((pl) => pl.id === fee.playerId));
  }, [otherFees, players]);

  return {
    grounds,
    addGround,
    updateGround,
    deleteGround,
    tournaments,
    addTournament,
    updateTournament,
    deleteTournament,
    matches,
    addMatch,
    updateMatch,
    bulkUpdateMatches,
    deleteMatch,
    players,
    addPlayer,
    updatePlayer,
    deletePlayer,
    mergePlayer,
    posts,
    addPost,
    updatePost,
    deletePost,
    addComment,
    refreshAppConfig,
    refreshGrounds,
    refreshSubscriptionPlans,
    refreshFeeTemplates,
    refreshMerchandises,
    payments: filteredPayments,
    ensurePayments,
    ensureMatchPayments,
    updatePaymentStatus,
    addPaymentStatus,
    notifyPlayerPayment,
    updateMatchAvailability,
    addPaymentWithAvailability,
    playerStats,
    updatePlayerStat,
    appConfig,
    updateAppConfig,
    appUsers,
    updateAppUserRole,
    updateAppUserProfile,
    subscriptionPlans,
    addSubscriptionPlan,
    updateSubscriptionPlan,
    deleteSubscriptionPlan,
    subscriptionHistory,
    addSubscriptionHistory,
    notifications,
    loadMoreNotifications,
    notificationsHasMore,
    notificationsLoadingMore,
    otherFees: filteredOtherFees,
    ensureOtherFees,
    ensurePosts,
    ensurePlayerStats,
    ensureMerchOrders,
    ensurePolls,
    ensurePollResponses,
    ensureAllAppUsers,
    ensureSubscriptionHistory,
    ensureTournaments,
    ensureSubscriptionPlans,
    ensureFeeTemplates,
    ensureFeePlans,
    ensureMerchandises,
    ensureOutOfPlays,
    addOtherFee,
    updateOtherFeeStatus,
    deleteOtherFee,
    feeTemplates,
    addFeeTemplate,
    deleteFeeTemplate,
    feePlans,
    addFeePlan,
    updateFeePlan,
    deleteFeePlan,
    applyFeePlanToPayment,
    clearFeeOverride,
    assignProxyPayment,
    outOfPlays,
    addOutOfPlay,
    updateOutOfPlay,
    deleteOutOfPlay,
    merchandises,
    addMerchandise,
    updateMerchandise,
    deleteMerchandise,
    merchOrders,
    addMerchOrder,
    updateMerchOrder,
    deleteMerchOrder,
    polls,
    pollResponses,
    badges,
    ensureBadges,
    addBadge,
    updateBadge,
    deleteBadge,
    badgeTypeDefs,
    ensureBadgeTypeDefs,
    addBadgeTypeDef,
    updateBadgeTypeDef,
    deleteBadgeTypeDef,
    recordCatch,
    isLoaded,
  };
}
