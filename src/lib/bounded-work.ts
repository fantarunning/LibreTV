/** A fixed worker pool; abort prevents queued work from starting. */
export async function forEachBounded<T>(
  items: readonly T[], concurrency: number,
  work: (item: T, index: number) => Promise<void>, signal?: AbortSignal,
): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, async () => {
    while (!signal?.aborted) {
      const index = next++;
      if (index >= items.length) return;
      await work(items[index], index);
    }
  }));
}
