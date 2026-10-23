import { describe, expect, it } from 'vitest';
import { fourKWatchUrl, type FourKItem } from './fourk';
const item: FourKItem = { id: 'verified-film', title: '影片', url: 'https://media.example/film.m3u8', kind: 'vod', width: 3840, height: 2074, verifiedAt: '2026-10-23', provider: '来源' };
describe('verified 4K entries', () => {
  it('uses native-compatible history identity and direct playback instead of treating media as a CMS endpoint', () => {
    const url = new URL(fourKWatchUrl(item), 'https://example.com');
    expect(url.pathname).toBe('/watch');
    expect(url.searchParams.get('direct')).toBe('1');
    expect(url.searchParams.get('source')).toBe('4k_verified-film');
    expect(url.searchParams.get('height')).toBe('2074');
  });
  it('uses the dedicated live player without creating movie progress for a broadcast', () => {
    const url = new URL(fourKWatchUrl({ ...item, kind: 'live' }), 'https://example.com');
    expect(url.pathname).toBe('/live');
    expect(url.searchParams.get('url')).toBe(item.url);
  });
});
