import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEnvSources } from './env-sources';
import { resolveSource } from './store';
afterEach(() => vi.unstubAllEnvs());
describe('source identity across catalogue updates', () => {
  it('retains source keys when the configured order changes', () => {
    const a = { name: 'A', url: 'https://a.example/api' }, b = { name: 'B', url: 'https://b.example/api' };
    vi.stubEnv('DEFAULT_SOURCES', JSON.stringify([a, b]));
    const before = getEnvSources();
    vi.stubEnv('DEFAULT_SOURCES', JSON.stringify([b, a]));
    const after = getEnvSources();
    expect(before[0].key).toBe(after[1].key);
    expect(before[1].key).toBe(after[0].key);
  });
  it('uses the recorded URL for legacy positional keys instead of silently selecting another source', () => {
    const envSources = [
      { key: 'env_0', name: 'New', url: 'https://new.example/api' },
      { key: 'env_stable', name: 'Original', url: 'https://old.example/api' },
    ];
    const source = resolveSource({ customAPIs: [], envSources }, 'env_0', { url: 'https://old.example/api' });
    expect(source?.url).toBe('https://old.example/api');
    expect(source?.key).toBe('env_0');
  });
});
