import { makeAbsolute, stripAdGroups } from './m3u8';

function absoluteHttp(uri: string, base: string): string {
  const absolute = makeAbsolute(uri, base);
  if (!/^https?:\/\//i.test(absolute)) throw new Error('播放清单包含不支持的媒体协议');
  return absolute;
}

/** Relay manifests only. Native clients fetch media/key/map URLs directly without sending our token. */
export function nativeManifest(content: string, base: string, filterAds: boolean): string {
  const cleaned = filterAds ? stripAdGroups(content) : content;
  const relay = (uri: string) => `/api/playback/manifest?filterAds=${filterAds ? '1' : '0'}&url=${encodeURIComponent(absoluteHttp(uri, base))}`;
  let childPlaylist = false;
  return cleaned.split('\n').map((raw) => {
    const line = raw.trim();
    if (!line) return raw;
    if (line.startsWith('#')) {
      if (line.startsWith('#EXT-X-STREAM-INF:')) childPlaylist = true;
      const playlistAttribute = /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/.test(line);
      return raw.replace(/URI="([^"]+)"/g, (_match, uri: string) => `URI="${playlistAttribute ? relay(uri) : absoluteHttp(uri, base)}"`);
    }
    const isPlaylist = childPlaylist || /\.m3u8(?:$|[?#])/i.test(line);
    childPlaylist = false;
    return isPlaylist ? relay(line) : absoluteHttp(line, base);
  }).join('\n');
}
