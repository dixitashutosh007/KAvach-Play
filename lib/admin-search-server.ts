import { FieldPath } from "firebase-admin/firestore";

const PRODUCTION_PAGE_SIZE = 500;
let testingPageSizeOverride: number | null = null;

/**
 * Test-only override for cursor page size (disabled in production).
 */
export function setSearchPageSizeForTesting(size: number | null) {
  if (process.env.NODE_ENV === "production") return;
  testingPageSizeOverride = size;
}

export function getEffectiveSearchPageSize(): number {
  if (process.env.NODE_ENV !== "production" && testingPageSizeOverride && testingPageSizeOverride > 0) {
    return testingPageSizeOverride;
  }
  return PRODUCTION_PAGE_SIZE;
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
