import { NextRequest, NextResponse } from 'next/server';
import { authenticatedUser, unauthorized } from '@/lib/api';
import { connectedCalendars } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await authenticatedUser(req);
  if (!auth) return unauthorized();
  try { return NextResponse.json({ calendars: await connectedCalendars(auth.userId) }); }
  catch (caught) { return NextResponse.json({ error: String(caught) }, { status: 500 }); }
}
