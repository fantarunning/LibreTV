import { describe, expect, it } from 'vitest';
import { validateTvCommand } from './tv-commands';

const command = {
  deviceId: '12345678-1234-1234-1234-123456789abc', action: 'play',
  payload: { source: { key: '4k-film', name: '4K', url: 'https://media.example/film.m3u8' }, vodId: 'film', title: 'Film', episodeIndex: 0 },
};

describe('TV direct playback command', () => {
  it('retains direct media metadata so a paired TV can play without a CMS detail request', () => {
    const direct = { directUrl: 'https://media.example/film.m3u8', width: 3840, height: 2074, codec: 'h264', isLive: false };
    expect(validateTvCommand({ ...command, payload: { ...command.payload, ...direct } }).payload).toMatchObject(direct);
    expect(validateTvCommand(command).payload).not.toHaveProperty('directUrl');
  });
  it('rejects executable URLs, invalid dimensions and unbounded metadata', () => {
    for (const direct of [{ directUrl: 'javascript:alert(1)' }, { directUrl: 'https://media.example/v.m3u8', width: Infinity }, { directUrl: 'https://media.example/v.m3u8', height: -1 }, { directUrl: 'https://media.example/v.m3u8', codec: 'x'.repeat(101) }, { directUrl: 'https://media.example/v.m3u8', isLive: 'yes' }]) {
      expect(() => validateTvCommand({ ...command, payload: { ...command.payload, ...direct } })).toThrow();
    }
  });
});
