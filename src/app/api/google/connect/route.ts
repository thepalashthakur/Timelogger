import { NextRequest, NextResponse } from 'next/server';
import { authenticatedUser, unauthorized } from '@/lib/api';
import { beginGoogleOAuth, googleOAuthCookie } from '@/lib/google-oauth';

export async function POST(req: NextRequest) {
  const auth = await authenticatedUser(req);
  if (!auth) return unauthorized();
  try {
    const { url, cookie } = beginGoogleOAuth(auth.userId);
    const response = NextResponse.json({ url });
    response.cookies.set(googleOAuthCookie, cookie, { httpOnly: true, secure: req.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/api/google', maxAge: 600 });
    return response;
  } catch (caught) { return NextResponse.json({ error: caught instanceof Error ? caught.message : 'Could not start Google sign-in' }, { status: 500 }); }
}
