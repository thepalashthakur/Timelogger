import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin';
import { authenticatedUser, unauthorized } from '@/lib/api';
import { deliverGoogleSync } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await authenticatedUser(req);
  if (!auth) return unauthorized();
  const { data, error } = await adminClient().from('timelogger_google_sync')
    .select('entry_id,desired_action,status,last_error,updated_at').eq('user_id', auth.userId)
    .in('status', ['failed', 'pending']).order('updated_at', { ascending: false }).limit(50);
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ pending: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await authenticatedUser(req);
  if (!auth) return unauthorized();
  const { data, error } = await adminClient().from('timelogger_google_sync').select('entry_id')
    .eq('user_id', auth.userId).in('status', ['failed', 'pending']).order('updated_at', { ascending: true }).limit(5);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const results = await Promise.all((data ?? []).map((row) => deliverGoogleSync(auth.userId, row.entry_id)));
  return NextResponse.json({ attempted: results.length, synced: results.filter((result) => result.status === 'synced').length });
}
