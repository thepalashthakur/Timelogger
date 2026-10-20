import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin';
import { authenticated, badRequest, details, unauthorized } from '@/lib/api';
import type { TimeEntry } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };
const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const notFound = () => NextResponse.json({ error: 'Entry not found' }, { status: 404 });

export async function GET(req: NextRequest, { params }: Context) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  const { id } = await params;
  if (!validId(id)) return badRequest('Invalid entry ID');
  const { data, error } = await auth.client.from('timelogger_time_entries')
    .select('*').eq('id', id).eq('user_id', auth.userId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return data ? NextResponse.json({ entry: data as TimeEntry }) : notFound();
}

export async function PATCH(req: NextRequest, { params }: Context) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  const { id } = await params;
  if (!validId(id)) return badRequest('Invalid entry ID');
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return badRequest('Invalid JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return badRequest('Invalid entry');

  const client = adminClient();
  const { data: existing, error: readError } = await client.from('timelogger_time_entries')
    .select('*').eq('id', id).eq('user_id', auth.userId).maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!existing) return notFound();
  if (existing.status !== 'stopped') return NextResponse.json({ error: 'Stop the timer before editing this entry' }, { status: 409 });

  const fields = details({
    project: body.project ?? existing.project,
    task: body.task ?? existing.task,
    description: body.description ?? existing.description,
  });
  const start = typeof body.start_at === 'string' ? new Date(body.start_at) : new Date(existing.start_at);
  const end = typeof body.end_at === 'string' ? new Date(body.end_at) : new Date(existing.end_at);
  if (!fields || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return badRequest('Provide valid details and an end after the start');
  }
  if ((body.start_at !== undefined && typeof body.start_at !== 'string') || (body.end_at !== undefined && typeof body.end_at !== 'string')) {
    return badRequest('Start and end must be dates');
  }
  const timesChanged = start.getTime() !== Date.parse(existing.start_at) || end.getTime() !== Date.parse(existing.end_at);
  const updates = {
    ...fields,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    ...(timesChanged ? { elapsed_seconds: Math.floor((end.getTime() - start.getTime()) / 1000) } : {}),
  };
  const { data, error } = await client.from('timelogger_time_entries').update(updates)
    .eq('id', id).eq('user_id', auth.userId).eq('status', 'stopped')
    .eq('start_at', existing.start_at).eq('end_at', existing.end_at)
    .select('*').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return data
    ? NextResponse.json({ entry: data as TimeEntry })
    : NextResponse.json({ error: 'Entry changed. Refresh and try again' }, { status: 409 });
}

export async function DELETE(req: NextRequest, { params }: Context) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  const { id } = await params;
  if (!validId(id)) return badRequest('Invalid entry ID');
  const client = adminClient();
  const { data, error } = await client.from('timelogger_time_entries').delete()
    .eq('id', id).eq('user_id', auth.userId).eq('status', 'stopped').select('id').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (data) return NextResponse.json({ deleted: true });
  const { data: existing, error: readError } = await client.from('timelogger_time_entries')
    .select('status').eq('id', id).eq('user_id', auth.userId).maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  return existing
    ? NextResponse.json({ error: 'Stop the timer before deleting this entry' }, { status: 409 })
    : notFound();
}
