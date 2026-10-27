import { NextResponse, type NextRequest } from 'next/server';
import { cookieOptions, parseSession, refreshSession, seal, sessionCookie, ssoConfig } from '@/lib/sso';

export async function proxy(request: NextRequest) {
  const current = parseSession(request.cookies.get(sessionCookie)?.value, true);
  if (!current || current.expiresAt > Date.now() + 120000) return NextResponse.next();
  try {
    const updated = await refreshSession(current);
    const value = seal(updated, ssoConfig()!.key);
    request.cookies.set(sessionCookie, value);
    const response = NextResponse.next({ request });
    response.cookies.set(sessionCookie, value, cookieOptions(60 * 60 * 24 * 7));
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch {
    // A stale access token cannot authorize an API request. Retry on a later request.
    return NextResponse.next();
  }
}

export const config = { matcher: ['/api/:path*'] };
