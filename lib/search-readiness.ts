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

  const runLoad = (query: string): Promise<void> => {
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
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Failed to load searchable club data.";
        onChange({ status: "error", readyQuery: "", error: message });
      });
  };

  return {
    startQuery: (query: string) => runLoad(query),
    retry: () => runLoad(lastQuery),
    dispose: () => {
      disposed = true;
      activeRequestId += 1;
    },
  };
}
