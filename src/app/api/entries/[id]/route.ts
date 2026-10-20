import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin';
import { authenticated, badRequest, details, unauthorized } from '@/lib/api';
import type { TimeEntry } from '@/lib/supabase';
import { resolveSelection, setEntryTags, validateTagIds } from '@/lib/catalog';

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

  let fields = details({
    project: body.project ?? existing.project,
    task: body.task ?? existing.task,
    description: body.description ?? existing.description,
  });
  if (!fields) return badRequest('Invalid entry details');
  let tagIds: string[] | null = null;
  try {
    if (body.project_id !== undefined || body.task_id !== undefined) {
      const selection = await resolveSelection(auth.userId, body.project_id, body.task_id);
      fields = { ...fields, project: selection.project?.key ?? '', task: selection.task?.key ?? '' };
    }
    if (body.tag_ids !== undefined) tagIds = await validateTagIds(auth.userId, body.tag_ids);
  } catch (caught) { return badRequest(caught instanceof Error ? caught.message : 'Invalid categories'); }
  if ((body.start_at !== undefined && typeof body.start_at !== 'string') || (body.end_at !== undefined && typeof body.end_at !== 'string')) {
    return badRequest('Start and end must be dates');
  }
  if (existing.status !== 'stopped' && (body.start_at !== undefined || body.end_at !== undefined)) {
    return NextResponse.json({ error: 'Stop the timer before changing its times' }, { status: 409 });
  }
  const start = typeof body.start_at === 'string' ? new Date(body.start_at) : new Date(existing.start_at);
  const end = typeof body.end_at === 'string' ? new Date(body.end_at) : existing.end_at ? new Date(existing.end_at) : null;
  if (!Number.isFinite(start.getTime()) || (existing.status === 'stopped' && (!end || !Number.isFinite(end.getTime()) || end <= start))) {
    return badRequest('Provide an end after the start');
  }
  const timesChanged = existing.status === 'stopped' && end &&
    (start.getTime() !== Date.parse(existing.start_at) || end.getTime() !== Date.parse(existing.end_at));
  const updates = existing.status === 'stopped' && end ? {
    ...fields, start_at: start.toISOString(), end_at: end.toISOString(),
    ...(timesChanged ? { elapsed_seconds: Math.floor((end.getTime() - start.getTime()) / 1000) } : {}),
  } : fields;
  let query = client.from('timelogger_time_entries').update(updates)
    .eq('id', id).eq('user_id', auth.userId).eq('status', existing.status)
    .eq('start_at', existing.start_at);
  if (existing.end_at) query = query.eq('end_at', existing.end_at);
  else query = query.is('end_at', null);
  const { data, error } = await query
    .select('*').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (data && tagIds) await setEntryTags(auth.userId, id, tagIds);
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
    .eq('id', id).eq('user_id', auth.userId).select('id').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return data ? NextResponse.json({ deleted: true }) : notFound();
}
