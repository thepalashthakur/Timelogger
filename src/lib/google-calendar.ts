import 'server-only';
import { adminClient } from './admin';
import type { CalendarPayload } from './calendar-protocol';
import { googleEventBody, googleEventId } from './google-calendar-protocol';
import { refreshGoogleAccessToken } from './google-oauth';
import type { TimeEntry } from './supabase';

export type GoogleCalendar = { id: string; summary: string; primary?: boolean; accessRole: string };
type Connection = { refresh_token_encrypted: string; calendar_id: string; calendar_name: string };
type SyncRow = { user_id: string; entry_id: string; calendar_id: string; event_id: string | null; html_link: string | null; desired_action: 'upsert' | 'delete'; payload: CalendarPayload | null; status: 'pending' | 'synced' | 'failed'; attempts: number; updated_at: string };

export async function googleConnection(userId: string) {
  const { data, error } = await adminClient().from('timelogger_google_connections').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Connection | null;
}

export async function googleSyncRow(userId: string, entryId: string) {
  const { data, error } = await adminClient().from('timelogger_google_sync').select('*').eq('user_id', userId).eq('entry_id', entryId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as SyncRow | null;
}

async function googleRequest(token: string, path: string, init?: RequestInit) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const detail = body.error && typeof body.error === 'object' ? (body.error as { message?: string }).message : undefined;
    throw Object.assign(new Error(detail || `Google Calendar returned HTTP ${response.status}`), { status: response.status });
  }
  return body;
}

export async function ownedGoogleCalendars(token: string) {
  const result: GoogleCalendar[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ minAccessRole: 'owner', maxResults: '250' });
    if (pageToken) query.set('pageToken', pageToken);
    const page = await googleRequest(token, `users/me/calendarList?${query}`);
    result.push(...((page.items ?? []) as GoogleCalendar[]).filter((item) => item.accessRole === 'owner'));
    pageToken = typeof page.nextPageToken === 'string' ? page.nextPageToken : undefined;
  } while (pageToken && result.length < 1000);
  return result;
}

export async function connectedCalendars(userId: string) {
  const connection = await googleConnection(userId);
  if (!connection) throw new Error('Connect Google Calendar first');
  return ownedGoogleCalendars(await refreshGoogleAccessToken(connection.refresh_token_encrypted));
}

export async function queueGoogleUpsert(userId: string, entry: TimeEntry) {
  if (entry.status !== 'stopped' || !entry.end_at) return null;
  const existing = await googleSyncRow(userId, entry.id);
  const connection = await googleConnection(userId);
  if (!connection && !existing) return null;
  const { error } = await adminClient().from('timelogger_google_sync').upsert({
    user_id: userId, entry_id: entry.id, calendar_id: existing?.calendar_id ?? connection!.calendar_id,
    event_id: existing?.event_id ?? null, html_link: existing?.html_link ?? null,
    desired_action: 'upsert', status: 'pending', last_error: null, updated_at: new Date().toISOString(),
    payload: { entry_id: entry.id, project: entry.project, task: entry.task, description: entry.description, start_at: entry.start_at, end_at: entry.end_at } satisfies CalendarPayload,
  }, { onConflict: 'user_id,entry_id' });
  if (error) throw new Error(error.message);
  return deliverGoogleSync(userId, entry.id);
}

export async function queueGoogleDelete(userId: string, entryId: string) {
  const existing = await googleSyncRow(userId, entryId);
  if (!existing) return null;
  const { error } = await adminClient().from('timelogger_google_sync').upsert({
    user_id: userId, entry_id: entryId, calendar_id: existing.calendar_id,
    event_id: existing.event_id, html_link: existing.html_link,
    desired_action: 'delete', payload: null, status: 'pending', last_error: null, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,entry_id' });
  if (error) throw new Error(error.message);
  return deliverGoogleSync(userId, entryId);
}

export async function deliverGoogleSync(userId: string, entryId: string) {
  const [connection, row] = await Promise.all([googleConnection(userId), googleSyncRow(userId, entryId)]);
  if (!row || row.status === 'synced') return { status: 'skipped' as const };
  if (!connection) {
    const message = 'Reconnect Google Calendar to retry this change';
    await adminClient().from('timelogger_google_sync').update({ status: 'failed', last_error: message })
      .eq('user_id', userId).eq('entry_id', entryId).eq('updated_at', row.updated_at);
    return { status: 'failed' as const, error: message };
  }
  try {
    const token = await refreshGoogleAccessToken(connection.refresh_token_encrypted);
    const base = `calendars/${encodeURIComponent(row.calendar_id)}/events`;
    const id = row.event_id || googleEventId(entryId);
    let result: Record<string, unknown> | null = null;
    if (row.desired_action === 'delete') {
      try { await googleRequest(token, `${base}/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
      catch (caught) { if ((caught as { status?: number }).status !== 404) throw caught; }
    } else {
      if (!row.payload) throw new Error('Calendar sync payload is missing');
      const body = googleEventBody(row.payload);
      try {
        result = await googleRequest(token, `${base}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      } catch (caught) {
        if ((caught as { status?: number }).status !== 404) throw caught;
        try { result = await googleRequest(token, base, { method: 'POST', body: JSON.stringify(body) }); }
        catch (createError) {
          if ((createError as { status?: number }).status !== 409) throw createError;
          result = await googleRequest(token, `${base}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
        }
      }
    }
    const query = adminClient().from('timelogger_google_sync');
    if (row.desired_action === 'delete') {
      const { error } = await query.delete().eq('user_id', userId).eq('entry_id', entryId).eq('desired_action', 'delete').eq('updated_at', row.updated_at);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await query.update({ event_id: result?.id ?? id, html_link: result?.htmlLink ?? null,
        status: 'synced', last_error: null, attempts: row.attempts + 1 })
        .eq('user_id', userId).eq('entry_id', entryId).eq('desired_action', 'upsert').eq('updated_at', row.updated_at);
      if (error) throw new Error(error.message);
    }
    return { status: 'synced' as const };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Google Calendar sync failed';
    await adminClient().from('timelogger_google_sync').update({ status: 'failed', attempts: row.attempts + 1, last_error: message.slice(0, 500) })
      .eq('user_id', userId).eq('entry_id', entryId).eq('desired_action', row.desired_action).eq('updated_at', row.updated_at);
    return { status: 'failed' as const, error: message };
  }
}
