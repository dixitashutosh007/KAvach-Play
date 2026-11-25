export class LazyLoadCancelledError extends Error {
  domainKey: string;
  constructor(domainKey: string) {
    super(`Lazy load cancelled for ${domainKey}`);
    this.name = "LazyLoadCancelledError";
    this.domainKey = domainKey;
  }
}

export function isLazyLoadCancelledError(err: unknown): err is LazyLoadCancelledError {
  return err instanceof LazyLoadCancelledError || (err instanceof Error && err.name === "LazyLoadCancelledError");
}

export type LazyListenerControls = {
  onData: (apply: () => void) => void;
  onError: (err: unknown, onCleanup?: () => void) => void;
  isStale: () => boolean;
};

/**
 * Shared lifecycle manager for lazy Firestore listeners (`posts`, `polls`) and
 * one-shot loaders (`tournaments`). Guarantees:
 * - No duplicate active listeners or in-flight one-shot reads
 * - Pending first-snapshot promises settle immediately with LazyLoadCancelledError on detach
 * - Stale listener/one-shot callbacks cannot mutate state or delete newer entries
 * - Failed loads clean up their own entry so retry() restarts cleanly
 */
export function createLazyLoadRegistry() {
  const subs = new Map<string, () => void>();
  const promises = new Map<string, Promise<void>>();
  const cancels = new Map<string, () => void>();
  const tokens = new Map<string, symbol>();
  const oneShots = new Set<string>();

  const deleteIfTokenMatches = (key: string, token: symbol) => {
    if (tokens.get(key) !== token) return;
    subs.delete(key);
    promises.delete(key);
    cancels.delete(key);
    tokens.delete(key);
    oneShots.delete(key);
  };

  const ensureListener = (
    key: string,
    subscribe: (controls: LazyListenerControls) => () => void,
  ): Promise<void> => {
    const existing = promises.get(key);
    if (subs.has(key) && existing) return existing;

    const token = Symbol(key);
    tokens.set(key, token);
    let settled = false;
    let cancelled = false;
    let unsub: (() => void) | undefined;

    const promise = new Promise<void>((resolve, reject) => {
      cancels.set(key, () => {
        cancelled = true;
        if (!settled) {
          settled = true;
          reject(new LazyLoadCancelledError(key));
        }
      });

      const isStale = () => cancelled || tokens.get(key) !== token;

      unsub = subscribe({
        isStale,
        onData: (apply) => {
          if (isStale()) return;
          apply();
          if (!settled) {
            settled = true;
            resolve();
          }
        },
        onError: (err, onCleanup) => {
          if (isStale()) return;
          deleteIfTokenMatches(key, token);
          try {
            unsub?.();
          } catch {}
          onCleanup?.();
          if (!settled) {
            settled = true;
            reject(err);
          }
        },
      });

      // If subscribe synchronously triggered cancellation/error, don't overwrite newer state
      if (tokens.get(key) === token && !cancelled) {
        subs.set(key, unsub);
      } else {
        try {
          unsub?.();
        } catch {}
      }
    });

    if (tokens.get(key) === token) {
      promises.set(key, promise);
    }
    return promise;
  };

  const ensureOneShot = (
    key: string,
    load: (isStale: () => boolean) => Promise<void>,
  ): Promise<void> => {
    const existing = promises.get(key);
    if (oneShots.has(key) && existing) return existing;

    const token = Symbol(key);
    tokens.set(key, token);
    oneShots.add(key);
    let settled = false;
    let cancelled = false;
    const isStale = () => cancelled || tokens.get(key) !== token;

    const promise = new Promise<void>((resolve, reject) => {
      cancels.set(key, () => {
        cancelled = true;
        if (tokens.get(key) === token) {
          oneShots.delete(key);
        }
        if (!settled) {
          settled = true;
          reject(new LazyLoadCancelledError(key));
        }
      });

      load(isStale)
        .then(() => {
          if (isStale()) return;
          if (!settled) {
            settled = true;
            resolve();
          }
        })
        .catch((err) => {
          if (isStale()) return;
          deleteIfTokenMatches(key, token);
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
    });

    if (tokens.get(key) === token) {
      promises.set(key, promise);
    }
    return promise;
  };

  const detach = (key: string) => {
    const unsub = subs.get(key);
    const cancel = cancels.get(key);
    subs.delete(key);
    promises.delete(key);
    cancels.delete(key);
    tokens.delete(key);
    oneShots.delete(key);
    if (unsub) {
      try {
        unsub();
      } catch (err) {
        console.warn(`[useStore] Error detaching subscription for ${key}:`, err);
      }
    }
    cancel?.();
  };

  const detachAll = (excludeKeys: string[] = []) => {
    const excludeSet = new Set(excludeKeys);
    const keys = new Set([...subs.keys(), ...cancels.keys()]);
    for (const key of keys) {
      if (!excludeSet.has(key)) {
        detach(key);
      }
    }
  };

  const clearAll = () => {
    const keys = new Set([...subs.keys(), ...cancels.keys(), ...oneShots.values()]);
    for (const key of keys) {
      detach(key);
    }
    oneShots.clear();
  };

  return {
    ensureListener,
    ensureOneShot,
    detach,
    detachAll,
    clearAll,
    hasActiveListener: (key: string) => subs.has(key),
  };
}

export type SearchDatasetLoaders = {
  ensurePosts?: () => Promise<void> | void;
  ensurePolls?: () => Promise<void> | void;
  ensureTournaments?: () => Promise<void> | void;
};

export type SearchReadinessSnapshot = {
  status: "idle" | "loading" | "error" | "ready";
  readyQuery: string;
  error: string | null;
};

export function createSearchReadinessCoordinator(
  getLoaders: () => SearchDatasetLoaders,
  onChange: (snapshot: SearchReadinessSnapshot) => void,
) {
  let activeRequestId = 0;
  let disposed = false;
  let lastQuery = "";

  const runLoad = (query: string, cancelRestartsLeft: number): Promise<void> => {
    lastQuery = query;
    const id = ++activeRequestId;
    const trimmed = query.trim();

    if (!trimmed) {
      if (!disposed) {
        onChange({ status: "idle", readyQuery: "", error: null });
      }
      return Promise.resolve();
    }

    if (!disposed) {
      onChange({ status: "loading", readyQuery: "", error: null });
    }

    const loaders = getLoaders();
    return Promise.all([
      Promise.resolve().then(() => loaders.ensurePosts?.()),
      Promise.resolve().then(() => loaders.ensurePolls?.()),
      Promise.resolve().then(() => loaders.ensureTournaments?.()),
    ])
      .then(() => {
        if (disposed || id !== activeRequestId) return;
        onChange({ status: "ready", readyQuery: query, error: null });
      })
      .catch((err: unknown) => {
        if (disposed || id !== activeRequestId) return;
        if (isLazyLoadCancelledError(err)) {
          if (cancelRestartsLeft > 0) {
            return runLoad(query, cancelRestartsLeft - 1);
          }
          onChange({ status: "idle", readyQuery: "", error: null });
          return;
        }
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Failed to load searchable club data.";
        onChange({ status: "error", readyQuery: "", error: message });
      });
  };

  return {
    startQuery: (query: string) => runLoad(query, 1),
    retry: () => runLoad(lastQuery, 1),
    dispose: () => {
      disposed = true;
      activeRequestId += 1;
    },
  };
}
