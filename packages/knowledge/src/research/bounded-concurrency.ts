export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));

  return results;
}

export async function flatMapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R[]>,
): Promise<R[]> {
  const nested = await mapWithConcurrency(items, concurrency, mapper);
  return nested.flat();
}

export function getResearchParallelism(): number {
  const raw = Number(process.env.RESEARCH_PARALLELISM ?? 4);

  if (!Number.isFinite(raw)) return 4;

  return Math.max(1, Math.min(Math.floor(raw), 8));
}

export function estimateParallelWaves(itemCount: number, concurrency: number): number {
  if (itemCount <= 0) return 0;
  return Math.ceil(itemCount / Math.max(1, concurrency));
}
