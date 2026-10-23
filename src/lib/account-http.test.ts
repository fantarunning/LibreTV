import { describe, expect, it } from 'vitest';
import { readLimitedJson } from './account-http';
describe('bounded account API bodies', () => {
  it('limits streamed bytes even without Content-Length', async () => {
    const request = new Request('https://local.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'a'.repeat(100) }) });
    await expect(readLimitedJson(request, 20)).rejects.toMatchObject({ status: 413 });
  });
  it('rejects nonobjects and bad JSON', async () => {
    for (const body of ['[]', 'null', 'invalid']) {
      const request = new Request('https://local.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      await expect(readLimitedJson(request)).rejects.toMatchObject({ status: 400 });
    }
  });
});
