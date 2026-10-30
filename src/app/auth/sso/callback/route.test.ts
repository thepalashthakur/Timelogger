import { randomBytes } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, expect, test, vi } from 'vitest';
import { seal, sessionCookie, ssoConfig, transactionCookie, type SsoTransaction } from '@/lib/sso';

const mocks = vi.hoisted(() => ({
  transaction: null as string | null,
  getUser: vi.fn(),
  hasAccess: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => name === transactionCookie ? { value: mocks.transaction } : undefined }) }));
vi.mock('@/lib/supabase', () => ({ tokenClient: () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('@/lib/app-access', () => ({ hasSessionAppAccess: mocks.hasAccess }));

import { GET } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.transaction = null;
});

function transaction(createdAt = Date.now()) {
  vi.stubEnv('SSO_CLIENT_ID', 'preview-client');
  vi.stubEnv('SSO_CLIENT_SECRET', 'preview-secret');
  vi.stubEnv('SSO_REDIRECT_URI', 'https://tracker.example.com/auth/sso/callback');
  vi.stubEnv('APP_URL', 'https://tracker.example.com');
  vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('SSO_SESSION_KEY', randomBytes(32).toString('hex'));
  const tx: SsoTransaction = { state: 'expected-state', nonce: 'expected-nonce', verifier: 'verifier', createdAt };
  mocks.transaction = seal(tx, ssoConfig()!.key);
  return tx;
}

function callback(code = 'test-code') {
  return GET(new Request(`https://tracker.example.com/auth/sso/callback?code=${code}&state=expected-state`));
}

function expectFailed(response: Response) {
  expect(response.status).toBe(307);
  expect(response.headers.get('location')).toBe('https://tracker.example.com/?sso=failed');
  const cookies = response.headers.get('set-cookie') ?? '';
  expect(cookies).toContain(`${transactionCookie}=;`);
  expect(cookies).not.toContain(`${sessionCookie}=`);
}

test('callback rejects an invalid authorization code without creating a session', async () => {
  const tx = transaction();
  const fetchMock = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) => Response.json({ error: 'invalid_grant' }, { status: 400 }));
  vi.stubGlobal('fetch', fetchMock);
  expectFailed(await callback('invalid-code'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const request = fetchMock.mock.calls[0];
  expect(String(request[0])).toBe(`${ssoConfig()!.issuer}/oauth/token`);
  expect((request[1] as RequestInit).body).toBeInstanceOf(URLSearchParams);
  expect(((request[1] as RequestInit).body as URLSearchParams).get('code_verifier')).toBe(tx.verifier);
});

test('callback rejects a validly signed ID token with the wrong nonce', async () => {
  const tx = transaction();
  const config = ssoConfig()!;
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(publicKey), kid: 'callback-test', alg: 'ES256', use: 'sig' };
  const sign = (claims: Record<string, unknown>, audience: string) => new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: jwk.kid })
    .setIssuer(config.issuer)
    .setAudience(audience)
    .setSubject('user-id')
    .setExpirationTime('1h')
    .sign(privateKey);
  const access = await sign({ client_id: config.id }, 'authenticated');
  const id = await sign({ nonce: 'wrong-nonce' }, config.id);
  const fetchMock = vi.fn(async (input: URL | RequestInfo) => String(input).endsWith('/.well-known/jwks.json')
    ? Response.json({ keys: [jwk] })
    : Response.json({ access_token: access, refresh_token: 'refresh', id_token: id, expires_in: 3600 }));
  vi.stubGlobal('fetch', fetchMock);
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-id' } }, error: null });
  mocks.hasAccess.mockResolvedValue(true);
  expectFailed(await callback());
  expect(mocks.getUser).not.toHaveBeenCalled();
  expect(mocks.hasAccess).not.toHaveBeenCalled();
  expect(tx.nonce).not.toBe('wrong-nonce');
});

test('callback rejects an expired transaction before contacting the provider', async () => {
  transaction(Date.now() - 600001);
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  expectFailed(await callback());
  expect(fetchMock).not.toHaveBeenCalled();
});
