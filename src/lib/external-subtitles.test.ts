import { describe, expect, it } from 'vitest';
import { normalizeSubtitle } from './external-subtitles';
describe('external subtitles', () => {
  it('converts SRT timestamps and normalizes BOM/Windows newlines', () => {
    expect(normalizeSubtitle('\uFEFF1\r\n00:00:01,250 --> 00:00:03,000\r\n你好')).toBe('WEBVTT\n\n1\n00:00:01.250 --> 00:00:03.000\n你好');
  });
  it('retains valid WebVTT and rejects unsupported text', () => {
    expect(normalizeSubtitle('WEBVTT\n\n00:01.000 --> 00:02.000\nHi')).toContain('WEBVTT');
    expect(() => normalizeSubtitle('not a subtitle')).toThrow('SRT');
  });
});
