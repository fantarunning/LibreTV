import type { DoubanItem } from './types';

export function uniqueRecommendations(pages: { items: DoubanItem[] }[]): DoubanItem[] {
  const unique = new Map<string, DoubanItem>();
  for (const page of pages) for (const item of page.items) if (!unique.has(item.id)) unique.set(item.id, item);
  return [...unique.values()];
}

/** Stop on exhaustion or an upstream repeating a previous page. Never manufacture an infinite loop. */
export function nextRecommendationOffset(pages: { items: DoubanItem[] }[], offset: number, pageSize: number): number | undefined {
  const latest = pages.at(-1)?.items ?? [];
  if (latest.length < pageSize) return undefined;
  const seen = new Set(pages.slice(0, -1).flatMap((page) => page.items.map((item) => item.id)));
  if (latest.every((item) => seen.has(item.id))) return undefined;
  return offset + latest.length;
}
