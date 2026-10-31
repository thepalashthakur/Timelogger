import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { challenge, cookieOptions, seal, ssoConfig, transactionCookie, type SsoTransaction } from '@/lib/sso';

export async function GET() {
  const config = ssoConfig();
  if (!config) return new Response('SSO is unavailable', { status: 503 });
  const transaction: SsoTransaction = {
    state: randomBytes(32).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
    verifier: randomBytes(32).toString('base64url'),
    createdAt: Date.now(),
  };
  const url = new URL(`${config.issuer}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.id);
  url.searchParams.set('redirect_uri', config.redirect);
  url.searchParams.set('code_challenge', challenge(transaction.verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', transaction.state);
  url.searchParams.set('nonce', transaction.nonce);
  url.searchParams.set('scope', 'openid email profile');
  const response = NextResponse.redirect(url, { headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
  response.cookies.set(transactionCookie, seal(transaction, config.key), cookieOptions(600));
  return response;
}
