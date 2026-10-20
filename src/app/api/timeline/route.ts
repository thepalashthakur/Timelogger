import { NextRequest, NextResponse } from 'next/server';
import { authenticated, badRequest, unauthorized } from '@/lib/api';

export const dynamic = 'force-dynamic';

const maxEntries = 500;

export async function GET(req: NextRequest) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();

  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  const fromMs = from ? Date.parse(from) : NaN;
  const toMs = to ? Date.parse(to) : NaN;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs || toMs - fromMs > 32 * 86400000) {
    return badRequest('Provide a valid timeline range of up to 32 days');
  }

  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  const { data, error, count } = await auth.client.from('timelogger_time_entries')
    .select('*', { count: 'exact' })
    .eq('user_id', auth.userId)
    .lt('start_at', toIso)
    .or(`end_at.gte.${fromIso},end_at.is.null`)
    .order('start_at', { ascending: true })
    .range(0, maxEntries - 1);

  return error
    ? NextResponse.json({ error: error.message }, { status: 500 })
    : NextResponse.json({ entries: data, count: count ?? 0, truncated: (count ?? 0) > maxEntries });
}
