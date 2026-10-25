import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin';
import { assertSharedSupabase, authCookies, clearAuthCookies, sameOriginMutation, setAuthCookies, useAuthRequest, type AuthSession, type AuthUser } from '@/lib/useauth';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ action: string }> };
const noStore = { 'Cache-Control': 'private, no-store' };

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

function failure(result: { status: number; data: { error?: { code?: string; message?: string } } }) {
  return reply({ error: result.data.error?.message ?? 'Authentication service unavailable', code: result.data.error?.code }, result.status);
}

async function localUserExists(user: AuthUser) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)) return false;
  const { data, error } = await adminClient().auth.admin.getUserById(user.id);
  return !error && typeof user.email === 'string' && !!data.user?.email && data.user.email.toLowerCase() === user.email.toLowerCase();
}

function sessionData(value: unknown): value is AuthSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<AuthSession>;
  return typeof session.access_token === 'string' && typeof session.refresh_token === 'string' &&
    typeof session.expires_at === 'number' && session.token_type === 'bearer';
}

export async function GET(request: NextRequest, { params }: Context) {
  if ((await params).action !== 'session') return reply({ error: 'Not found' }, 404);
  const tokens = authCookies(request);
  if (!tokens.access_token && !tokens.refresh_token) return reply({ user: null }, 401);
  try {
    await assertSharedSupabase();
    let result = tokens.access_token ? await useAuthRequest('me', undefined, tokens.access_token) : null;
    let nextSession: AuthSession | null = null;
    if ((!result || result.status === 401) && tokens.refresh_token) {
      const refreshed = await useAuthRequest('refresh', { refresh_token: tokens.refresh_token });
      if (refreshed.status !== 200 || !sessionData(refreshed.data.session)) {
        const response = reply({ user: null }, 401); clearAuthCookies(response); return response;
      }
      nextSession = refreshed.data.session;
      result = { status: 200, data: { user: refreshed.data.user } };
    }
    if (!result || result.status !== 200 || !result.data.user) return failure(result ?? { status: 401, data: {} });
    if (!await localUserExists(result.data.user)) return reply({ error: 'This UseAuth account does not match a Timelogger user' }, 503);
    const response = reply({ user: result.data.user });
    if (nextSession) setAuthCookies(response, nextSession);
    return response;
  } catch (caught) {
    return reply({ error: caught instanceof Error ? caught.message : 'Authentication service unavailable' }, 503);
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  if (!sameOriginMutation(request)) return reply({ error: 'Forbidden' }, 403);
  const { action } = await params;
  if (!['sign-up', 'sign-in', 'sign-out', 'request-reset', 'change-password', 'reauthenticate', 'update-profile'].includes(action)) return reply({ error: 'Not found' }, 404);
  let input: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 16384) return reply({ error: 'Request is too large' }, 413);
    input = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid JSON');
  } catch { return reply({ error: 'Invalid JSON' }, 400); }
  try {
    if (action === 'sign-out') {
      const tokens = authCookies(request);
      if (tokens.access_token && tokens.refresh_token) await useAuthRequest('sign-out', tokens).catch(() => null);
      const response = reply({ signed_out: true }); clearAuthCookies(response); return response;
    }
    await assertSharedSupabase();
    if (action === 'sign-in' || action === 'sign-up' || action === 'request-reset') {
      const result = await useAuthRequest(action, input);
      if (result.status < 200 || result.status >= 300) return failure(result);
      if (sessionData(result.data.session)) {
        if (!result.data.user || !await localUserExists(result.data.user)) return reply({ error: 'This UseAuth account does not match a Timelogger user' }, 503);
        const response = reply({ user: result.data.user, confirmation_required: false }, result.status);
        setAuthCookies(response, result.data.session);
        return response;
      }
      return reply({ user: null, confirmation_required: result.data.confirmation_required, message: result.data.message }, result.status);
    }
    const tokens = authCookies(request);
    if (!tokens.access_token || !tokens.refresh_token) return reply({ error: 'Please sign in again' }, 401);
    const result = await useAuthRequest(action, { ...input, ...tokens });
    if (result.status < 200 || result.status >= 300) return failure(result);
    if (result.data.session && !sessionData(result.data.session)) return reply({ error: 'Invalid authentication response' }, 502);
    const response = reply({ user: result.data.user, message: result.data.message });
    if (result.data.session) setAuthCookies(response, result.data.session);
    return response;
  } catch (caught) {
    return reply({ error: caught instanceof Error ? caught.message : 'Authentication service unavailable' }, 503);
  }
}
