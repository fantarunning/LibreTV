import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE, WEB_SESSION_DAYS, TV_SESSION_DAYS, checkPassword, checkRateLimit, clearRateLimit, credentialEpoch, isSessionToken, isTrustedWrite, newSessionToken, tokenFromCookieHeader, tokenFromRequest, tokenHash } from './auth';

beforeEach(() => { vi.stubEnv('PASSWORD', 'test-password'); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('opaque account credentials', () => {
  it('uses random 256-bit credentials and fixed web/TV lifetimes', () => {
    const first = newSessionToken();
    expect(first).not.toBe(newSessionToken());
    expect(isSessionToken(first)).toBe(true);
    expect(tokenHash(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(WEB_SESSION_DAYS).toBe(30);
    expect(TV_SESSION_DAYS).toBe(365);
  });
  it('rejects every legacy timestamp/HMAC cookie and malformed cookie escape', () => {
    expect(tokenFromCookieHeader(`${SESSION_COOKIE}=1780000000000.signature`)).toBeNull();
    expect(tokenFromCookieHeader(`${SESSION_COOKIE}=%ZZ`)).toBeNull();
    expect(tokenFromCookieHeader(null)).toBeNull();
  });
  it('extracts a valid native Bearer before cookies and never falls back from invalid Bearer', () => {
    const token = newSessionToken();
    expect(tokenFromCookieHeader(`other=1; ${SESSION_COOKIE}=${token}; x=2`)).toBe(token);
    expect(tokenFromRequest(new Request('https://local.test', { headers: { Authorization: `Bearer ${token}` } }))).toBe(token);
    expect(tokenFromRequest(new Request('https://local.test', { headers: { Authorization: 'Bearer old', cookie: `${SESSION_COOKIE}=${token}` } }))).toBeNull();
  });
  it('invalidates the credential epoch when PASSWORD changes even with a fixed secret', () => {
    vi.stubEnv('PROXY_SECRET', 'fixed-secret');
    const before = credentialEpoch();
    vi.stubEnv('PASSWORD', 'new-password');
    expect(credentialEpoch()).not.toBe(before);
  });
});

describe('CSRF protection', () => {
  const token = newSessionToken();
  const request = (headers: Record<string, string>) => new Request('https://local.test/api/sync', { method: 'POST', headers });
  it('accepts same-origin cookie writes and rejects foreign or missing origin', () => {
    expect(isTrustedWrite(request({ cookie: `${SESSION_COOKIE}=${token}`, Origin: 'https://local.test' }))).toBe(true);
    expect(isTrustedWrite(request({ cookie: `${SESSION_COOKIE}=${token}`, Origin: 'https://evil.test' }))).toBe(false);
    expect(isTrustedWrite(request({ cookie: `${SESSION_COOKIE}=${token}` }))).toBe(false);
    expect(isTrustedWrite(request({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
  });
  it('accepts native Bearer writes without ambient cookie authentication', () => {
    expect(isTrustedWrite(request({ Authorization: `Bearer ${token}` }))).toBe(true);
    expect(isTrustedWrite(request({ Authorization: 'Bearer invalid' }))).toBe(false);
  });
  it('compares against the configured public origin behind a proxy', () => {
    vi.stubEnv('APP_ORIGIN', 'https://public.test');
    expect(isTrustedWrite(request({ Origin: 'https://public.test' }))).toBe(true);
    expect(isTrustedWrite(request({ Origin: 'https://local.test' }))).toBe(false);
  });
});

describe('password and login rate limit', () => {
  it('accepts only the configured password', () => {
    expect(checkPassword('test-password')).toBe(true);
    expect(checkPassword('wrong')).toBe(false);
    vi.stubEnv('PASSWORD', '');
    expect(checkPassword('')).toBe(false);
  });
  it('separates IP keys, clears success, and expires limits', () => {
    vi.useFakeTimers();
    clearRateLimit('test-limit');
    for (let i = 0; i < 10; i++) expect(checkRateLimit('test-limit')).toBe(true);
    expect(checkRateLimit('test-limit')).toBe(false);
    expect(checkRateLimit('test-other')).toBe(true);
    vi.advanceTimersByTime(600001);
    expect(checkRateLimit('test-limit')).toBe(true);
    clearRateLimit('test-limit');
    expect(checkRateLimit('test-limit')).toBe(true);
  });
});
