import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin';
import { ownedGoogleCalendars } from '@/lib/google-calendar';
import { exchangeGoogleCode, encryptGoogleToken, googleAppUrl, googleOAuthCookie, verifyGoogleOAuth } from '@/lib/google-oauth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const target = googleAppUrl();
  let error: string | null = null;
  try {
    const verified = verifyGoogleOAuth(req.nextUrl.searchParams.get('state'), req.cookies.get(googleOAuthCookie)?.value);
    if (!verified) throw new Error('Google connection expired. Please try again.');
    if (req.nextUrl.searchParams.get('error')) throw new Error('Google Calendar access was not granted.');
    const code = req.nextUrl.searchParams.get('code');
    if (!code) throw new Error('Google did not return an authorization code.');
    const tokens = await exchangeGoogleCode(code, verified.verifier);
    if (!tokens.refresh_token || !tokens.access_token) throw new Error('Google did not issue offline access. Please reconnect.');
    const calendars = await ownedGoogleCalendars(tokens.access_token);
    const selected = calendars.find((calendar) => calendar.primary) ?? calendars[0];
    if (!selected) throw new Error('No writable Google Calendar was found.');
    const { error: saveError } = await adminClient().from('timelogger_google_connections').upsert({
      user_id: verified.userId, refresh_token_encrypted: encryptGoogleToken(tokens.refresh_token),
      calendar_id: selected.id, calendar_name: selected.summary,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (saveError) throw new Error(saveError.message);
  } catch (caught) { error = caught instanceof Error ? caught.message : 'Google connection failed'; }
  target.searchParams.set(error ? 'google_error' : 'google', error ?? 'connected');
  const response = NextResponse.redirect(target);
  response.cookies.delete(googleOAuthCookie);
  return response;
}
