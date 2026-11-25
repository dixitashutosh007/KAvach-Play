export interface BulkOperationResult<T> {
  succeeded: T[];
  failed: Array<{ item: T; error: unknown }>;
}

/**
 * Executes an async mutation across multiple items and counts only confirmed
 * resolved writes as successes. Rejected promises or thrown errors are always
 * recorded in `failed` so callers never misreport failed writes as successes.
 */
export async function runBulkOperations<T>(
  items: readonly T[],
  fn: (item: T) => Promise<void>,
): Promise<BulkOperationResult<T>> {
  const succeeded: T[] = [];
  const failed: Array<{ item: T; error: unknown }> = [];

  for (const item of items) {
    try {
      await fn(item);
      succeeded.push(item);
    } catch (error) {
      failed.push({ item, error });
    }
  }

  return { succeeded, failed };
}
