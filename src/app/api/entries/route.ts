import { NextRequest, NextResponse } from 'next/server';
import { authenticated, badRequest, details, unauthorized } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  const { data, error } = await auth.client.from('timelogger_time_entries').select('*').order('start_at', { ascending: false }).limit(100);
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ entries: data });
}

export async function POST(req: NextRequest) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return badRequest('Invalid JSON'); }
  const fields = details(body);
  const start = typeof body.start_at === 'string' ? new Date(body.start_at) : null;
  const end = typeof body.end_at === 'string' ? new Date(body.end_at) : null;
  if (!fields || !start || !end || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return badRequest('Provide valid details and an end after the start');
  }
  const { data, error } = await auth.client.from('timelogger_time_entries').insert({
    ...fields, user_id: auth.user.id, status: 'stopped',
    start_at: start.toISOString(), end_at: end.toISOString(),
    elapsed_seconds: Math.floor((end.getTime() - start.getTime()) / 1000),
  }).select('*').single();
  return error ? badRequest(error.message) : NextResponse.json({ entry: data }, { status: 201 });
}
