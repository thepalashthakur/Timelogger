import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

export type AuthUser = {
  id: string;
  email: string;
  email_verified: boolean;
  created_at: string;
  username: string | null;
  display_name: string | null;
};
export type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: string;
};

export const accessCookie = 'timelogger_auth_access';
export const refreshCookie = 'timelogger_auth_refresh';

export function useAuthOrigin() {
  const raw = process.env.USEAUTH_URL;
  if (!raw) throw new Error('USEAUTH_URL is missing');
  const url = new URL(raw);
  if ((url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.origin.startsWith('http://localhost:'))) ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash || raw !== url.origin) {
    throw new Error('USEAUTH_URL must be an HTTPS origin');
  }
  return url.origin;
}

export async function useAuthRequest(action: string, body?: unknown, accessToken?: string) {
  const response = await fetch(`${useAuthOrigin()}/api/v1/auth/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

export async function assertSharedSupabase() {
  const expected = process.env.SUPABASE_URL?.replace(/\/$/, '');
  if (!expected) throw new Error('SUPABASE_URL is missing');
  const { status, data } = await useAuthRequest('project');
  if (status !== 200 || data.supabase_url?.replace?.(/\/$/, '') !== expected) {
    throw new Error('UseAuth must be connected to the same Supabase project as Timelogger');
  }
}

export function setAuthCookies(response: NextResponse, session: AuthSession) {
  const secure = process.env.NODE_ENV === 'production';
  const options = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };
  response.cookies.set(accessCookie, session.access_token, { ...options, maxAge: Math.max(1, session.expires_at - Math.floor(Date.now() / 1000)) });
  response.cookies.set(refreshCookie, session.refresh_token, { ...options, maxAge: 30 * 24 * 60 * 60 });
}

export function clearAuthCookies(response: NextResponse) {
  response.cookies.delete(accessCookie);
  response.cookies.delete(refreshCookie);
}

export function authCookies(request: NextRequest) {
  return { access_token: request.cookies.get(accessCookie)?.value, refresh_token: request.cookies.get(refreshCookie)?.value };
}

export function sameOriginMutation(request: NextRequest) {
  return request.headers.get('origin') === request.nextUrl.origin && request.headers.get('sec-fetch-site') !== 'cross-site';
}
