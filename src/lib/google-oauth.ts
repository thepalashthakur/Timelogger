import 'server-only';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const scopes = [
  'https://www.googleapis.com/auth/calendar.events.owned',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];

export const googleOAuthCookie = 'timelogger_google_oauth';

function configuration() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const rawKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!clientId || !clientSecret || !redirectUri || !rawKey) throw new Error('Google Calendar OAuth is not configured');
  const key = Buffer.from(rawKey, 'base64');
  if (key.length !== 32) throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64');
  const redirect = new URL(redirectUri);
  if ((redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && redirect.hostname === 'localhost'))
    || redirect.pathname !== '/api/google/callback' || redirect.search || redirect.hash) {
    throw new Error('GOOGLE_REDIRECT_URI must point to /api/google/callback');
  }
  return { clientId, clientSecret, redirectUri: redirect.toString(), key };
}

const base64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

export function beginGoogleOAuth(userId: string) {
  const { clientId, redirectUri, key } = configuration();
  const nonce = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(32));
  const stateBody = base64url(JSON.stringify({ userId, nonce, expires: Date.now() + 10 * 60_000 }));
  const signature = createHmac('sha256', key).update(`google-oauth:${stateBody}`).digest('base64url');
  const state = `${stateBody}.${signature}`;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
  url.searchParams.set('code_challenge_method', 'S256');
  return { url: url.toString(), cookie: base64url(JSON.stringify({ nonce, verifier })) };
}

export function verifyGoogleOAuth(state: string | null, cookie: string | undefined) {
  if (!state || !cookie) return null;
  const { key } = configuration();
  const [body, signature, extra] = state.split('.');
  if (!body || !signature || extra) return null;
  const expected = createHmac('sha256', key).update(`google-oauth:${body}`).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); }
  catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as { userId?: string; nonce?: string; expires?: number };
    const stored = JSON.parse(Buffer.from(cookie, 'base64url').toString()) as { nonce?: string; verifier?: string };
    if (!payload.userId || !payload.nonce || !stored.verifier || payload.nonce !== stored.nonce
      || !Number.isFinite(payload.expires) || payload.expires! < Date.now()) return null;
    return { userId: payload.userId, verifier: stored.verifier };
  } catch { return null; }
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };

async function tokenRequest(body: URLSearchParams) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    signal: AbortSignal.timeout(10000), cache: 'no-store',
  });
  const result = await response.json() as TokenResponse;
  if (!response.ok || !result.access_token) throw new Error(result.error_description || result.error || 'Google token request failed');
  return result;
}

export async function exchangeGoogleCode(code: string, verifier: string) {
  const { clientId, clientSecret, redirectUri } = configuration();
  return tokenRequest(new URLSearchParams({
    code, code_verifier: verifier, client_id: clientId, client_secret: clientSecret,
    redirect_uri: redirectUri, grant_type: 'authorization_code',
  }));
}

export function encryptGoogleToken(token: string) {
  const { key } = configuration();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptGoogleToken(encrypted: string) {
  const { key } = configuration();
  const [version, iv, tag, ciphertext] = encrypted.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Stored Google token is invalid');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

export async function refreshGoogleAccessToken(encrypted: string) {
  const { clientId, clientSecret } = configuration();
  const token = await tokenRequest(new URLSearchParams({
    refresh_token: decryptGoogleToken(encrypted), client_id: clientId, client_secret: clientSecret,
    grant_type: 'refresh_token',
  }));
  return token.access_token!;
}

export async function revokeGoogleToken(encrypted: string) {
  const token = decryptGoogleToken(encrypted);
  await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10000), cache: 'no-store',
  });
}

export function googleAppUrl() {
  const { redirectUri } = configuration();
  const url = new URL('/', redirectUri);
  url.hash = 'settings';
  return url;
}
