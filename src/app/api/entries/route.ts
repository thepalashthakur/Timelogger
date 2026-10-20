import { NextRequest, NextResponse } from 'next/server';
import { authenticated, badRequest, details, unauthorized } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  const params = req.nextUrl.searchParams;
  const page = Number(params.get('page') ?? 1);
  const pageSize = Number(params.get('page_size') ?? 100);
  const search = (params.get('q') ?? '').trim();
  const project = (params.get('project') ?? '').trim();
  const status = params.get('status') ?? '';
  const from = params.get('from');
  const to = params.get('to');
  if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100
    || search.length > 100 || project.length > 100 || (status && !['running', 'paused', 'stopped'].includes(status))
    || (from && !Number.isFinite(Date.parse(from))) || (to && !Number.isFinite(Date.parse(to)))
    || (from && to && Date.parse(from) >= Date.parse(to))) return badRequest('Invalid entry filters');

  let query = auth.client.from('timelogger_time_entries').select('*', { count: 'exact' }).eq('user_id', auth.userId);
  if (search) {
    // PostgREST requires quotes around values with commas, periods, or parentheses.
    const value = search.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    query = query.or(['project', 'task', 'description'].map((field) => `${field}.ilike."%${value}%"`).join(','));
  }
  if (project) query = query.ilike('project', `%${project}%`);
  if (status) query = query.eq('status', status);
  if (from) query = query.gte('start_at', new Date(from).toISOString());
  if (to) query = query.lt('start_at', new Date(to).toISOString());
  const offset = (page - 1) * pageSize;
  const { data, error, count } = await query.order('start_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + pageSize - 1);
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ entries: data, count: count ?? 0, page, page_size: pageSize });
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
    ...fields, user_id: auth.userId, status: 'stopped',
    start_at: start.toISOString(), end_at: end.toISOString(),
    elapsed_seconds: Math.floor((end.getTime() - start.getTime()) / 1000),
  }).select('*').single();
  return error ? badRequest(error.message) : NextResponse.json({ entry: data }, { status: 201 });
}
