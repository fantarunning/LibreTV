/** Convert plain SRT/WebVTT input to a browser-native WebVTT track. */
export function normalizeSubtitle(text: string): string {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (normalized.startsWith('WEBVTT')) return normalized;
  if (!/\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(normalized)) throw new Error('请选择 SRT 或 WebVTT 字幕文件');
  return `WEBVTT\n\n${normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`;
}
