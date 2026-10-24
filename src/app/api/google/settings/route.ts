import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin';
import { authenticatedUser, badRequest, unauthorized } from '@/lib/api';
import { connectedCalendars, googleConnection } from '@/lib/google-calendar';
import { revokeGoogleToken } from '@/lib/google-oauth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await authenticatedUser(req);
  if (!auth) return unauthorized();
  try {
    const connection = await googleConnection(auth.userId);
    return NextResponse.json({ connection: connection ? { calendar_id: connection.calendar_id, calendar_name: connection.calendar_name } : null });
  } catch (caught) { return NextResponse.json({ error: String(caught) }, { status: 500 }); }
}

export async function PATCH(req: NextRequest) {
  const auth = await authenticatedUser(req);
  if (!auth) return unauthorized();
  let body: { calendar_id?: unknown };
  try { body = await req.json(); } catch { return badRequest('Invalid JSON'); }
  if (typeof body?.calendar_id !== 'string') return badRequest('Choose a Calendar');
  try {
    const selected = (await connectedCalendars(auth.userId)).find((calendar) => calendar.id === body.calendar_id);
    if (!selected) return badRequest('Choose a Calendar you own');
    const { error } = await adminClient().from('timelogger_google_connections').update({ calendar_id: selected.id,
      calendar_name: selected.summary, updated_at: new Date().toISOString() }).eq('user_id', auth.userId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ connection: { calendar_id: selected.id, calendar_name: selected.summary } });
  } catch (caught) { return NextResponse.json({ error: String(caught) }, { status: 500 }); }
}

export async function DELETE(req: NextRequest) {
  const auth = await authenticatedUser(req);
  if (!auth) return unauthorized();
  try {
    const connection = await googleConnection(auth.userId);
    const { error } = await adminClient().from('timelogger_google_connections').delete().eq('user_id', auth.userId);
    if (error) throw new Error(error.message);
    if (connection) await revokeGoogleToken(connection.refresh_token_encrypted).catch(() => {});
    return NextResponse.json({ disconnected: true });
  } catch (caught) { return NextResponse.json({ error: String(caught) }, { status: 500 }); }
}
