import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { hasSessionAppAccess } from '@/lib/app-access';
import { tokenClient } from '@/lib/supabase';
import { cookieOptions, exchangeToken, sameSecret, seal, sessionCookie, ssoConfig, transactionCookie, unseal, validateAccess, validateId, type SsoSession, type SsoTransaction } from '@/lib/sso';

export async function GET(request: Request) {
  const config = ssoConfig();
  if (!config) return new Response('SSO is unavailable', { status: 503 });
  const fail = () => {
    const response = NextResponse.redirect(new URL('/?sso=failed', config.redirect), { headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
    response.cookies.set(transactionCookie, '', cookieOptions(0));
    return response;
  };
  const url = new URL(request.url);
  const tx = unseal<SsoTransaction>((await cookies()).get(transactionCookie)?.value, config.key);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!tx || !state || !code || Date.now() - tx.createdAt > 600000 || tx.createdAt > Date.now() + 30000 || !sameSecret(tx.state, state)) return fail();
  try {
    const tokens = await exchangeToken('authorization_code', code, tx.verifier);
    if (!tokens.refresh_token || !tokens.id_token) return fail();
    const subject = await validateAccess(tokens.access_token);
    await validateId(tokens.id_token, tx.nonce, subject);
    const { data, error } = await tokenClient(tokens.access_token).auth.getUser(tokens.access_token);
    if (error || data.user?.id !== subject || !await hasSessionAppAccess(tokens.access_token)) return fail();
    const session: SsoSession = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000, subject };
    const response = NextResponse.redirect(new URL('/', config.redirect), { headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
    response.cookies.set(transactionCookie, '', cookieOptions(0));
    response.cookies.set(sessionCookie, seal(session, config.key), cookieOptions(60 * 60 * 24 * 7));
    return response;
  } catch { return fail(); }
}
