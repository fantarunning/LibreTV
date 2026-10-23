export interface FourKItem {
  id: string;
  title: string;
  url: string;
  cover?: string;
  kind: 'live' | 'vod';
  width: number;
  height: number;
  codec?: string;
  verifiedAt: string;
  provider?: string;
}

export function fourKWatchUrl(item: FourKItem): string {
  if (item.kind === 'live') return `/live?${new URLSearchParams({ url: item.url, name: item.title, group: '4K专区' })}`;
  return `/watch?${new URLSearchParams({ source: `4k_${item.id}`, id: item.id, url: item.url, sourceUrl: item.url, sourceName: item.provider || '4K专区', title: item.title, direct: '1', width: String(item.width), height: String(item.height), codec: item.codec || '' })}`;
}
