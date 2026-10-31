import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, expect, test, vi } from 'vitest';
import { seal, sessionCookie, ssoConfig, type SsoSession } from '@/lib/sso';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), hasAccess: vi.fn(), useAuthRequest: vi.fn(), sameOriginMutation: vi.fn() }));

vi.mock('@/lib/supabase', () => ({ tokenClient: () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('@/lib/app-access', () => ({ hasSessionAppAccess: mocks.hasAccess }));
vi.mock('@/lib/useauth', () => ({
  authCookies: vi.fn(), clearAuthCookies: vi.fn(), sameOriginMutation: mocks.sameOriginMutation, setAuthCookies: vi.fn(), useAuthRequest: mocks.useAuthRequest,
}));

import { GET, POST } from './route';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

test('session endpoint denies an expired SSO cookie without falling back to credentials', async () => {
  vi.stubEnv('SSO_CLIENT_ID', 'preview-client');
  vi.stubEnv('SSO_CLIENT_SECRET', 'preview-secret');
  vi.stubEnv('SSO_REDIRECT_URI', 'https://tracker.example.com/auth/sso/callback');
  vi.stubEnv('APP_URL', 'https://tracker.example.com');
  vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('SSO_SESSION_KEY', randomBytes(32).toString('hex'));
  const expired: SsoSession = { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: Date.now() - 1, subject: 'user-id' };
  const request = new NextRequest('https://tracker.example.com/api/auth/session', {
    headers: { cookie: `${sessionCookie}=${seal(expired, ssoConfig()!.key)}` },
  });
  const response = await GET(request, { params: Promise.resolve({ action: 'session' }) });
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ user: null });
  expect(mocks.getUser).not.toHaveBeenCalled();
  expect(mocks.hasAccess).not.toHaveBeenCalled();
});

test('signup sends the preview app ID to UseAuth', async () => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'feat/sso-pilot');
  mocks.sameOriginMutation.mockReturnValue(true);
  mocks.useAuthRequest.mockResolvedValue({ status: 201, data: { session: null, confirmation_required: true, message: 'Check email' } });
  const request = new NextRequest('https://tracker.example.com/api/auth/sign-up', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://tracker.example.com' },
    body: JSON.stringify({ email: 'person@example.com', password: 'long-password' }),
  });
  const response = await POST(request, { params: Promise.resolve({ action: 'sign-up' }) });
  expect(response.status).toBe(201);
  expect(mocks.useAuthRequest).toHaveBeenCalledWith('sign-up', { email: 'person@example.com', password: 'long-password', app_id: 'timelogger_sso_preview' });
});
