"use client";

/**
 * Player Club data (D-20) — bounded, on-demand reads for the Club tab.
 *
 * The Club tab must not start whole-collection listeners. Each hook below runs a
 * small one-shot query (a 30-day window, a page, or a count), shares the result
 * through a short-lived in-memory cache so tab switches and re-renders do not
 * repeat the same read, and refetches when the cache is stale or the user pulls
 * to refresh (store.refreshNonce).
 *
 * Queries use single-field filters/order only, so no new composite index is
 * needed. Reads are subject to the existing Firestore rules (posts, polls and
 * pollResponses are readable by signed-in members).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  collection,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  Timestamp,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { announcementPosts } from "@/components/home/postKinds";
import { orderPulsePolls, recentWindowStart, toMillis, withinRecentWindow } from "@/lib/club-feed";
import type { Poll, PollResponse, Post } from "@/lib/types";

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; nonce: number; value: unknown; pending?: Promise<unknown> }>();

export function invalidateClubPostsCache() {
  cache.delete("club:recentPosts");
}

/** Test harness store (e2e synthetic sessions); never present in production builds. */
function testStore(): any | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  return (window as any).__KAVACH_TEST_STORE__ || null;
}

async function cached<T>(key: string, nonce: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && hit.nonce === nonce) {
    if (hit.pending) return hit.pending as Promise<T>;
    if (now - hit.at < CACHE_TTL_MS) return hit.value as T;
  }
  const pending = load().then(
    (value) => {
      cache.set(key, { at: Date.now(), nonce, value });
      return value;
    },
    (err) => {
      cache.delete(key);
      throw err;
    },
  );
  cache.set(key, { at: now, nonce, value: undefined, pending });
  return pending;
}

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function useCachedQuery<T>(key: string | null, nonce: number, load: () => Promise<T>): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: !!key, error: null });
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!key) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    cached(key, nonce, () => loadRef.current())
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((e) => alive && setState({ data: null, loading: false, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [key, nonce]);
  return state;
}

/** Posts created in the last 30 days (newest first, capped). */
async function loadRecentPosts(): Promise<Post[]> {
  const ts = testStore();
  if (ts) return withinRecentWindow((ts.posts || []) as Post[]);
  const snap = await getDocs(
    query(
      collection(db, "posts"),
      where("createdAt", ">=", Timestamp.fromDate(recentWindowStart())),
      orderBy("createdAt", "desc"),
      limit(50),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Post);
}

/** Announcements from the last 30 days for the Club preview. */
export function useRecentAnnouncements(nonce: number): AsyncState<Post[]> {
  const state = useCachedQuery("club:recentPosts", nonce, loadRecentPosts);
  return { ...state, data: state.data ? announcementPosts(state.data) : null };
}

/**
 * All announcements, newest first, loaded page by page (View More). Pages scan
 * posts with a cursor and keep the announcements, so older history is only read
 * when the member asks for it.
 */
export function useAnnouncementPages(pageSize = 20) {
  const [items, setItems] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const cursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const busyRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (busyRef.current || done) return;
    busyRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const ts = testStore();
      if (ts) {
        const all = announcementPosts(((ts.posts || []) as Post[]).slice().sort((a, b) => (toMillis(b.createdAt) ?? 0) - (toMillis(a.createdAt) ?? 0)));
        setItems(all);
        setDone(true);
        return;
      }
      const found: Post[] = [];
      // Read up to three post pages per click to find announcements among feed posts.
      for (let i = 0; i < 3 && found.length < pageSize; i++) {
        const q = cursorRef.current
          ? query(collection(db, "posts"), orderBy("createdAt", "desc"), startAfter(cursorRef.current), limit(pageSize))
          : query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(pageSize));
        const snap = await getDocs(q);
        if (snap.empty) {
          setDone(true);
          break;
        }
        cursorRef.current = snap.docs[snap.docs.length - 1];
        found.push(...announcementPosts(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Post)));
        if (snap.size < pageSize) {
          setDone(true);
          break;
        }
      }
      setItems((prev) => {
        const ids = new Set(prev.map((p) => p.id));
        return [...prev, ...found.filter((p) => !ids.has(p.id))];
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }, [done, pageSize]);

  useEffect(() => {
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { items, loading, error, done, loadMore };
}

export interface PulsePreviewItem {
  poll: Poll;
  votes: number | null;
  answered: boolean;
}

/**
 * Pulse preview: active polls plus polls created in the last 30 days, the
 * member's own participation (their responses only) and vote counts for the
 * previewed polls (server-side count queries, no response documents read).
 */
export function usePulsePreview(uid: string | undefined, nonce: number, previewCount: number): AsyncState<{ items: PulsePreviewItem[]; activeCount: number }> {
  const load = useCallback(async () => {
    const ts = testStore();
    let polls: Poll[];
    let mine: PollResponse[];
    if (ts) {
      polls = (ts.polls || []) as Poll[];
      mine = ((ts.pollResponses || []) as PollResponse[]).filter((r) => r.playerId === uid);
    } else {
      const [activeSnap, recentSnap, mineSnap] = await Promise.all([
        getDocs(query(collection(db, "polls"), where("isActive", "==", true))),
        getDocs(query(collection(db, "polls"), where("createdAt", ">=", Timestamp.fromDate(recentWindowStart())))),
        uid ? getDocs(query(collection(db, "pollResponses"), where("playerId", "==", uid))) : Promise.resolve(null),
      ]);
      polls = [...activeSnap.docs, ...recentSnap.docs].map((d) => ({ id: d.id, ...d.data() }) as Poll);
      mine = mineSnap ? mineSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as PollResponse) : [];
    }
    const ordered = orderPulsePolls(polls);
    const answered = new Set(mine.filter((r) => !r.isArchived).map((r) => r.pollId));
    const preview = ordered.slice(0, previewCount);
    const votes = await Promise.all(
      preview.map(async (p) => {
        if (ts) return ((ts.pollResponses || []) as PollResponse[]).filter((r) => r.pollId === p.id && !r.isArchived).length;
        try {
          const c = await getCountFromServer(query(collection(db, "pollResponses"), where("pollId", "==", p.id)));
          return c.data().count;
        } catch {
          return null;
        }
      }),
    );
    return {
      items: preview.map((poll, i) => ({ poll, votes: votes[i], answered: answered.has(poll.id) })),
      activeCount: ordered.filter((p) => p.isActive).length,
    };
  }, [uid, previewCount]);
  return useCachedQuery(uid ? `club:pulse:${uid}:${previewCount}` : null, nonce, load);
}

/** Badges earned by one player (bounded query used by the public profile). */
export function usePlayerBadges(playerId: string | null, nonce: number) {
  const load = useCallback(async () => {
    const ts = testStore();
    if (ts) return ((ts.badges || []) as any[]).filter((b) => b.playerId === playerId);
    const snap = await getDocs(query(collection(db, "badges"), where("playerId", "==", playerId)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }, [playerId]);
  return useCachedQuery(playerId ? `club:badges:${playerId}` : null, nonce, load);
}

/** Test-only: clear the in-memory cache between unit tests. */
export function __resetClubDataCache() {
  cache.clear();
}
