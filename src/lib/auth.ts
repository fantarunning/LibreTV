import crypto from 'node:crypto';

export const SESSION_COOKIE = 'ltv_session';
export const WEB_SESSION_DAYS = 30;
export const TV_SESSION_DAYS = 365;
export const SESSION_DAY_MS = 24 * 60 * 60 * 1000;

export function getPassword(): string { return process.env.PASSWORD || ''; }
export function isPasswordConfigured(): boolean { return getPassword().length > 0; }

/** Passwords remain on the server; only random opaque credentials leave it. */
export function checkPassword(input: string): boolean {
  if (!getPassword()) return false;
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(input).digest(),
    crypto.createHash('sha256').update(getPassword()).digest(),
  );
}

export function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function newSessionToken(): string { return `lt2_${crypto.randomBytes(32).toString('hex')}`; }
export function isSessionToken(token: string | null | undefined): token is string {
  return typeof token === 'string' && /^lt2_[a-f0-9]{64}$/.test(token);
}

/** Changes to PASSWORD or the signing secret invalidate all previously issued devices. */
export function credentialEpoch(): string {
  return crypto.createHmac('sha256', process.env.PROXY_SECRET || 'libretv-account-epoch')
    .update(getPassword()).digest('hex');
}

export function tokenFromCookieHeader(header: string | null): string | null {
  for (const cookie of header?.split(';') || []) {
    const equal = cookie.indexOf('=');
    if (equal < 0 || cookie.slice(0, equal).trim() !== SESSION_COOKIE) continue;
    try {
      const value = decodeURIComponent(cookie.slice(equal + 1).trim());
      return isSessionToken(value) ? value : null;
    } catch { return null; }
  }
  return null;
}

export function tokenFromRequest(req: Request): string | null {
  const authorization = req.headers.get('authorization');
  if (authorization) {
    const match = /^Bearer (lt2_[a-f0-9]{64})$/.exec(authorization);
    return match?.[1] || null;
  }
  return tokenFromCookieHeader(req.headers.get('cookie'));
}

export function requestOrigin(req: Request): string {
  if (process.env.APP_ORIGIN) return new URL(process.env.APP_ORIGIN).origin;
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  return host && proto ? new URL(`${proto}://${host}`).origin : new URL(req.url).origin;
}

/** Native Bearer requests have no ambient credentials; cookie writes must be same-origin. */
export function isTrustedWrite(req: Request): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  const origin = req.headers.get('origin');
  if (origin) {
    try { return new URL(origin).origin === requestOrigin(req); } catch { return false; }
  }
  if (req.headers.has('authorization')) return /^Bearer lt2_[a-f0-9]{64}$/.test(req.headers.get('authorization') || '');
  const site = req.headers.get('sec-fetch-site');
  if (site === 'same-origin' || site === 'none') return true;
  // Native pairing creates an unprivileged, short-lived challenge without browser cookies.
  return !req.headers.has('cookie') && !site;
}

const attemptMap = new Map<string, { count: number; resetAt: number }>();
export function checkRateLimit(key: string, maximum = 10, windowMs = 10 * 60 * 1000): boolean {
  const now = Date.now();
  const entry = attemptMap.get(key);
  if (!entry || now > entry.resetAt) {
    // Bound memory even when clients use many IPs.
    if (attemptMap.size >= 10000) {
      for (const [oldKey, oldEntry] of attemptMap) if (now > oldEntry.resetAt) attemptMap.delete(oldKey);
      if (attemptMap.size >= 10000) return false;
    }
    attemptMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maximum) return false;
  entry.count += 1;
  return true;
}
export function clearRateLimit(key: string): void { attemptMap.delete(key); }
export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}
