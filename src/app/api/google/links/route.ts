import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin';
import { authenticatedUser, badRequest, unauthorized } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await authenticatedUser(req);
  if (!auth) return unauthorized();
  const ids = (req.nextUrl.searchParams.get('ids') ?? '').split(',').filter(Boolean);
  if (!ids.length || ids.length > 100 || ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) return badRequest('Provide up to 100 entry IDs');
  const { data, error } = await adminClient().from('timelogger_google_sync')
    .select('entry_id,calendar_id,event_id,html_link').eq('user_id', auth.userId).in('entry_id', ids).eq('status', 'synced');
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ links: data ?? [] });
}
