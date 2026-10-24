import { NextRequest, NextResponse } from 'next/server';
import { authenticated, badRequest, details, unauthorized } from '@/lib/api';
import { attachTagsToNewEntry, ensureJiraCatalog, resolveSelection, validateTagIds } from '@/lib/catalog';
import { queueCalendarUpsert } from '@/lib/calendar-dispatch';
import type { TimeEntry } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  const { data, error } = await auth.client.from('timelogger_time_entries').select('*')
    .eq('user_id', auth.userId).in('status', ['running', 'paused']).maybeSingle();
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ entry: data });
}

export async function POST(req: NextRequest) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return badRequest('Invalid JSON'); }
  const action = body.action;
  if (!['start', 'pause', 'resume', 'stop'].includes(String(action))) return badRequest('Invalid timer action');
  if (action === 'start') {
    let fields = details(body);
    if (!fields) return badRequest('Invalid entry details');
    let tagIds: string[] | null = null;
    try {
      if (body.project_id !== undefined || body.task_id !== undefined) {
        const selection = await resolveSelection(auth.userId, body.project_id, body.task_id);
        fields = { ...fields, project: selection.project?.key ?? '', task: selection.task?.key ?? '' };
      }
      if (body.tag_ids !== undefined) tagIds = await validateTagIds(auth.userId, body.tag_ids);
    } catch (caught) { return badRequest(caught instanceof Error ? caught.message : 'Invalid categories'); }
    if (auth.kind === 'api_token') {
      try { await ensureJiraCatalog(auth.userId, fields.project, fields.task); }
      catch (caught) { console.error('Could not sync Jira project and task', caught); }
      const now = new Date().toISOString();
      const { data, error } = await auth.client.from('timelogger_time_entries').insert({
        ...fields, user_id: auth.userId, status: 'running', start_at: now, last_resumed_at: now,
      }).select('*').single();
      if (error) return badRequest(error.message);
      try { if (tagIds?.length) await attachTagsToNewEntry(auth.userId, data.id, tagIds); }
      catch (caught) { return NextResponse.json({ error: caught instanceof Error ? caught.message : 'Could not assign tags' }, { status: 500 }); }
      return NextResponse.json({ entry: data });
    }
    const { data, error } = await auth.client.rpc('timelogger_start_timer', {
      p_project: fields.project, p_task: fields.task, p_description: fields.description,
    });
    if (error) return badRequest(error.message);
    try { if (tagIds?.length) await attachTagsToNewEntry(auth.userId, data.id, tagIds); }
    catch (caught) { return NextResponse.json({ error: caught instanceof Error ? caught.message : 'Could not assign tags' }, { status: 500 }); }
    return NextResponse.json({ entry: data });
  }
  const { data, error } = auth.kind === 'api_token'
    ? await auth.client.rpc('timelogger_api_transition_timer', { p_user_id: auth.userId, p_action: action })
    : await auth.client.rpc('timelogger_transition_timer', { p_action: action });
  if (error) return badRequest(error.message);
  let calendarSync;
  if (action === 'stop') {
    try { calendarSync = await queueCalendarUpsert(auth.userId, data as TimeEntry); }
    catch (caught) { calendarSync = { status: 'failed', error: caught instanceof Error ? caught.message : 'Calendar sync failed' }; }
  }
  return NextResponse.json({ entry: data, calendar_sync: calendarSync });
}
