import { FieldPath } from "firebase-admin/firestore";
import type { AdminSearchDataset, AdminSearchRoleContext } from "./admin-search.ts";

const PRODUCTION_PAGE_SIZE = 500;
const CACHE_TTL_MS = 30_000;

let testingPageSizeOverride: number | null = null;

interface CacheEntry {
  dataset: AdminSearchDataset;
  expiresAt: number;
}

const datasetCache = new Map<string, CacheEntry>();
const inFlightLoads = new Map<string, Promise<AdminSearchDataset>>();

/**
 * Test-only override for cursor page size (disabled in production).
 */
export function setSearchPageSizeForTesting(size: number | null) {
  if (process.env.NODE_ENV === "production") return;
  testingPageSizeOverride = size;
}

export function clearAdminSearchCacheForTesting() {
  datasetCache.clear();
  inFlightLoads.clear();
}

export function getEffectiveSearchPageSize(): number {
  if (process.env.NODE_ENV !== "production" && testingPageSizeOverride && testingPageSizeOverride > 0) {
    return testingPageSizeOverride;
  }
  return PRODUCTION_PAGE_SIZE;
}

export function getRoleCacheKey(roles: AdminSearchRoleContext): string {
  if (roles.isSuperAdmin) return "super";
  if (roles.isClubAdmin && roles.isFinanceAdmin) return "club_finance";
  if (roles.isClubAdmin) return "club";
  if (roles.isFinanceAdmin) return "finance";
  return "none";
}

/**
 * Role-scoped short-TTL dataset cache with in-flight promise deduplication.
 * Ensures Club Admin, Finance Admin, and Super Admin never share cached projections.
 */
export async function getOrLoadRoleScopedDataset(
  roles: AdminSearchRoleContext,
  loader: () => Promise<AdminSearchDataset>,
  bypassCache = false,
): Promise<{ dataset: AdminSearchDataset; cacheHit: boolean }> {
  const key = getRoleCacheKey(roles);
  const now = Date.now();

  if (!bypassCache) {
    const cached = datasetCache.get(key);
    if (cached && cached.expiresAt > now) {
      return { dataset: cached.dataset, cacheHit: true };
    }

    const pending = inFlightLoads.get(key);
    if (pending) {
      const dataset = await pending;
      return { dataset, cacheHit: true };
    }
  }

  const loadPromise = loader()
    .then((dataset) => {
      datasetCache.set(key, { dataset, expiresAt: Date.now() + CACHE_TTL_MS });
      inFlightLoads.delete(key);
      return dataset;
    })
    .catch((err) => {
      inFlightLoads.delete(key);
      throw err;
    });

  inFlightLoads.set(key, loadPromise);
  const dataset = await loadPromise;
  return { dataset, cacheHit: false };
}

/**
 * Cursor-paginated Firestore scan with `.select()` projection.
 * Reads all pages via `startAfter(lastDoc)` so records beyond a single batch
 * limit are never silently dropped, and guards against cursor stagnation or
 * duplicate document paths.
 */
export async function fetchAllProjected(
  baseQuery: FirebaseFirestore.Query,
  options?: {
    orderByDocId?: boolean;
    extra?: (doc: FirebaseFirestore.QueryDocumentSnapshot) => Record<string, unknown>;
    pageSize?: number;
  },
): Promise<Array<Record<string, unknown> & { id: string }>> {
  const pageSize = options?.pageSize ?? getEffectiveSearchPageSize();
  const extra = options?.extra;
  const orderedQuery =
    options?.orderByDocId && typeof baseQuery.orderBy === "function"
      ? baseQuery.orderBy(FieldPath.documentId())
      : baseQuery;

  const results: Array<Record<string, unknown> & { id: string }> = [];
  const seenPaths = new Set<string>();
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let lastDocPath: string | null = null;

  while (true) {
    let pageQuery = orderedQuery.limit(pageSize);
    if (lastDoc && typeof pageQuery.startAfter === "function") {
      pageQuery = pageQuery.startAfter(lastDoc);
    }
    const snap = await pageQuery.get();
    if (!snap || snap.empty || snap.docs.length === 0) break;

    const tailDoc = snap.docs[snap.docs.length - 1];
    const tailPath = tailDoc.ref?.path || tailDoc.id;
    if (lastDocPath && tailPath === lastDocPath) {
      throw new Error(`Cursor stagnation detected while scanning Firestore (${tailPath}).`);
    }

    for (const doc of snap.docs) {
      const docPath = doc.ref?.path || doc.id;
      if (seenPaths.has(docPath)) continue;
      seenPaths.add(docPath);
      results.push({
        id: doc.id,
        ...doc.data(),
        ...(extra ? extra(doc) : {}),
      });
    }

    if (snap.docs.length < pageSize) break;
    lastDoc = tailDoc;
    lastDocPath = tailPath;
  }

  return results;
}
