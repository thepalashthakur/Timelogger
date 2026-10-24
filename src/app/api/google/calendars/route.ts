import { NextRequest, NextResponse } from 'next/server';
import { authenticatedUser, badRequest, unauthorized } from '@/lib/api';
import { connectedCalendars, createGoogleCalendar } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await authenticatedUser(req);
  if (!auth) return unauthorized();
  try { return NextResponse.json({ calendars: await connectedCalendars(auth.userId) }); }
  catch (caught) { return NextResponse.json({ error: String(caught) }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  const auth = await authenticatedUser(req);
  if (!auth) return unauthorized();
  let body: unknown;
  try { body = await req.json(); } catch { return badRequest('Invalid JSON'); }
  const name = body && typeof body === 'object' && !Array.isArray(body) && 'name' in body
    && typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 255) return badRequest('Calendar name must be 1–255 characters');
  try {
    const calendar = await createGoogleCalendar(auth.userId, name);
    return NextResponse.json({ calendar, connection: { calendar_id: calendar.id, calendar_name: calendar.summary } }, { status: 201 });
  } catch (caught) {
    const status = (caught as { status?: number }).status;
    const message = status === 403 ? 'Google denied calendar creation. Reconnect in Settings to grant the new permission, then try again.'
      : caught instanceof Error ? caught.message : 'Could not create Google Calendar';
    return NextResponse.json({ error: message }, { status: status === 403 ? 403 : 500 });
  }
}
