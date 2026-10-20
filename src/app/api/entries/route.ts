import { NextRequest, NextResponse } from 'next/server';
import { authenticated, badRequest, details, unauthorized } from '@/lib/api';
import { attachTagsToNewEntry, resolveSelection, validateTagIds } from '@/lib/catalog';
import { uuidPattern } from '@/lib/catalog';
import { adminClient } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  const params = req.nextUrl.searchParams;
  const page = Number(params.get('page') ?? 1);
  const pageSize = Number(params.get('page_size') ?? 100);
  const search = (params.get('q') ?? '').trim();
  const project = (params.get('project') ?? '').trim();
  const task = (params.get('task') ?? '').trim();
  const tagId = params.get('tag_id') ?? '';
  const status = params.get('status') ?? '';
  const from = params.get('from');
  const to = params.get('to');
  if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100
    || search.length > 100 || project.length > 100 || task.length > 100 || (tagId && !uuidPattern.test(tagId)) || (status && !['running', 'paused', 'stopped'].includes(status))
    || (from && !Number.isFinite(Date.parse(from))) || (to && !Number.isFinite(Date.parse(to)))
    || (from && to && Date.parse(from) >= Date.parse(to))) return badRequest('Invalid entry filters');

  let query = (tagId ? adminClient() : auth.client).from('timelogger_time_entries')
    .select(tagId ? '*,timelogger_entry_tags!inner(tag_id)' : '*', { count: 'exact' }).eq('user_id', auth.userId);
  if (search) {
    // PostgREST requires quotes around values with commas, periods, or parentheses.
    const value = search.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    query = query.or(['project', 'task', 'description'].map((field) => `${field}.ilike."%${value}%"`).join(','));
  }
  if (project) query = query.ilike('project', `%${project}%`);
  if (task) query = query.ilike('task', `%${task}%`);
  if (tagId) query = query.eq('timelogger_entry_tags.tag_id', tagId);
  if (status) query = query.eq('status', status);
  if (from) query = query.gte('start_at', new Date(from).toISOString());
  if (to) query = query.lt('start_at', new Date(to).toISOString());
  const offset = (page - 1) * pageSize;
  const { data, error, count } = await query.order('start_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + pageSize - 1);
  const entries = tagId ? (data as unknown as Record<string, unknown>[] | null)?.map(({ timelogger_entry_tags: _tags, ...entry }) => entry) : data;
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ entries, count: count ?? 0, page, page_size: pageSize });
}

export async function POST(req: NextRequest) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return badRequest('Invalid JSON'); }
  let fields = details(body);
  const start = typeof body.start_at === 'string' ? new Date(body.start_at) : null;
  const end = typeof body.end_at === 'string' ? new Date(body.end_at) : null;
  if (!fields || !start || !end || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return badRequest('Provide valid details and an end after the start');
  }
  let tagIds: string[] | null = null;
  try {
    if (body.project_id !== undefined || body.task_id !== undefined) {
      const selection = await resolveSelection(auth.userId, body.project_id, body.task_id);
      fields = { ...fields, project: selection.project?.key ?? '', task: selection.task?.key ?? '' };
    }
    if (body.tag_ids !== undefined) tagIds = await validateTagIds(auth.userId, body.tag_ids);
  } catch (caught) { return badRequest(caught instanceof Error ? caught.message : 'Invalid categories'); }
  const { data, error } = await auth.client.from('timelogger_time_entries').insert({
    ...fields, user_id: auth.userId, status: 'stopped',
    start_at: start.toISOString(), end_at: end.toISOString(),
    elapsed_seconds: Math.floor((end.getTime() - start.getTime()) / 1000),
  }).select('*').single();
  if (error) return badRequest(error.message);
  try { if (tagIds?.length) await attachTagsToNewEntry(auth.userId, data.id, tagIds); }
  catch (caught) { return NextResponse.json({ error: caught instanceof Error ? caught.message : 'Could not assign tags' }, { status: 500 }); }
  return NextResponse.json({ entry: data }, { status: 201 });
}
