import 'server-only';
import { adminClient } from './admin';
import type { TimeEntry } from './supabase';

type CalendarPayload = {
  entry_id: string;
  project: string;
  task: string;
  description: string;
  start_at: string;
  end_at: string;
};

type SyncRow = {
  user_id: string;
  entry_id: string;
  event_id: string | null;
  desired_action: 'upsert' | 'delete';
  payload: CalendarPayload | null;
  status: 'pending' | 'synced' | 'failed';
  attempts: number;
  updated_at: string;
};

async function scriptUrl(userId: string) {
  const { data, error } = await adminClient().from('timelogger_calendar_integrations')
    .select('script_url').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.script_url as string | undefined;
}

async function syncRow(userId: string, entryId: string) {
  const { data, error } = await adminClient().from('timelogger_calendar_sync')
    .select('*').eq('user_id', userId).eq('entry_id', entryId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as SyncRow | null;
}

export async function queueCalendarUpsert(userId: string, entry: TimeEntry) {
  if (entry.status !== 'stopped' || !entry.end_at) return null;
  if (!await scriptUrl(userId)) return null;
  const existing = await syncRow(userId, entry.id);
  const { error } = await adminClient().from('timelogger_calendar_sync').upsert({
    user_id: userId,
    entry_id: entry.id,
    event_id: existing?.event_id ?? null,
    desired_action: 'upsert',
    payload: {
      entry_id: entry.id,
      project: entry.project,
      task: entry.task,
      description: entry.description,
      start_at: entry.start_at,
      end_at: entry.end_at,
    } satisfies CalendarPayload,
    status: 'pending',
    last_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,entry_id' });
  if (error) throw new Error(error.message);
  return deliverCalendarSync(userId, entry.id);
}

export async function queueCalendarDelete(userId: string, entryId: string) {
  if (!await scriptUrl(userId)) return null;
  const existing = await syncRow(userId, entryId);
  const { error } = await adminClient().from('timelogger_calendar_sync').upsert({
    user_id: userId,
    entry_id: entryId,
    event_id: existing?.event_id ?? null,
    desired_action: 'delete',
    payload: null,
    status: 'pending',
    last_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,entry_id' });
  if (error) throw new Error(error.message);
  return deliverCalendarSync(userId, entryId);
}

export async function deliverCalendarSync(userId: string, entryId: string) {
  const [url, row] = await Promise.all([scriptUrl(userId), syncRow(userId, entryId)]);
  if (!url || !row || row.status === 'synced') return { status: 'skipped' as const };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: row.desired_action, entry_id: row.entry_id, event_id: row.event_id, entry: row.payload }),
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    const responseText = await response.text();
    let result: { ok?: boolean; event_id?: string; error?: string };
    try { result = JSON.parse(responseText); }
    catch { throw new Error('Calendar script did not return JSON. Check the Web app deployment and its access setting.'); }
    if (!response.ok || result.ok !== true) throw new Error(result.error || `Calendar script returned HTTP ${response.status}`);
    if (row.desired_action === 'upsert' && (!result.event_id || typeof result.event_id !== 'string')) {
      throw new Error('Calendar script did not return an event_id');
    }
    const client = adminClient();
    if (row.desired_action === 'delete') {
      const { error } = await client.from('timelogger_calendar_sync').delete()
        .eq('user_id', userId).eq('entry_id', entryId).eq('desired_action', 'delete').eq('updated_at', row.updated_at);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await client.from('timelogger_calendar_sync').update({
        event_id: result.event_id,
        status: 'synced',
        last_error: null,
        attempts: row.attempts + 1,
      }).eq('user_id', userId).eq('entry_id', entryId).eq('desired_action', 'upsert').eq('updated_at', row.updated_at);
      if (error) throw new Error(error.message);
    }
    return { status: 'synced' as const };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Calendar sync failed';
    const { error } = await adminClient().from('timelogger_calendar_sync').update({
      status: 'failed', attempts: row.attempts + 1, last_error: message.slice(0, 500),
    }).eq('user_id', userId).eq('entry_id', entryId).eq('desired_action', row.desired_action).eq('updated_at', row.updated_at);
    if (error) console.error('Could not record Calendar sync failure', error);
    return { status: 'failed' as const, error: message };
  }
}
