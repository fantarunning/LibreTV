import { describe, expect, it } from 'vitest';
import { nextRecommendationOffset, uniqueRecommendations } from './recommendation-pages';
const item = (id: string) => ({ id, title: id, cover: '' });

describe('recommendation pagination', () => {
  it('continues with the real upstream offset while deduplicating overlapping pages', () => {
    const pages = [{ items: [item('a'), item('b')] }, { items: [item('b'), item('c')] }];
    expect(uniqueRecommendations(pages).map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(nextRecommendationOffset(pages, 2, 2)).toBe(4);
  });
  it('ends for a short page, empty page, or an upstream repeating an entire page', () => {
    expect(nextRecommendationOffset([{ items: [item('a')] }], 0, 2)).toBeUndefined();
    expect(nextRecommendationOffset([{ items: [] }], 0, 2)).toBeUndefined();
    expect(nextRecommendationOffset([{ items: [item('a'), item('b')] }, { items: [item('b'), item('a')] }], 2, 2)).toBeUndefined();
  });
});
