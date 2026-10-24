import 'server-only';
import { adminClient } from './admin';
import { queueCalendarDelete as scriptDelete, queueCalendarUpsert as scriptUpsert } from './calendar';
import { googleConnection, googleSyncRow, queueGoogleDelete, queueGoogleUpsert } from './google-calendar';
import type { TimeEntry } from './supabase';

async function scriptLinked(userId: string, entryId: string) {
  const { data, error } = await adminClient().from('timelogger_calendar_sync')
    .select('entry_id').eq('user_id', userId).eq('entry_id', entryId).maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function queueCalendarUpsert(userId: string, entry: TimeEntry) {
  if (await googleSyncRow(userId, entry.id)) return queueGoogleUpsert(userId, entry);
  if (await scriptLinked(userId, entry.id)) return scriptUpsert(userId, entry);
  if (await googleConnection(userId)) return queueGoogleUpsert(userId, entry);
  return scriptUpsert(userId, entry);
}

export async function queueCalendarDelete(userId: string, entryId: string) {
  if (await googleSyncRow(userId, entryId)) return queueGoogleDelete(userId, entryId);
  if (await scriptLinked(userId, entryId)) return scriptDelete(userId, entryId);
  return null;
}
