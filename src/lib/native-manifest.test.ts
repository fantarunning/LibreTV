import { describe, expect, it } from 'vitest';
import { nativeManifest } from './native-manifest';
describe('native HLS manifest transport', () => {
  it('relays variant/audio manifests while keeping video, keys and initialization direct', () => {
    const content = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/list.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvideo/playlist\n';
    const output = nativeManifest(content, 'https://media.example/master.m3u8', true);
    expect(output).toContain('/api/playback/manifest?filterAds=1&url=https%3A%2F%2Fmedia.example%2Faudio%2Flist.m3u8');
    expect(output).toContain('/api/playback/manifest?filterAds=1&url=https%3A%2F%2Fmedia.example%2Fvideo%2Fplaylist');
    const media = nativeManifest('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\nseg.ts', 'https://media.example/show/main.m3u8', true);
    expect(media).toContain('URI="https://media.example/show/key.bin"');
    expect(media).toContain('URI="https://media.example/show/init.mp4"');
    expect(media).toContain('\nhttps://media.example/show/seg.ts');
    expect(media).not.toContain('/api/proxy');
  });
  it('keeps the optional filter explicit and rejects local-file references', () => {
    expect(nativeManifest('#EXTM3U\n#EXTINF:6,\na.ts', 'https://example.com/x.m3u8', false)).toContain('https://example.com/a.ts');
    expect(() => nativeManifest('#EXTM3U\nfile:///etc/passwd', 'https://example.com/x.m3u8', true)).toThrow('媒体协议');
  });
});
