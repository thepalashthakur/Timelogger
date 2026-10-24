import { createHash } from 'node:crypto';
import { calendarRequest, type CalendarPayload } from './calendar-protocol';

export function googleEventId(entryId: string) {
  return `tl${createHash('sha256').update(entryId).digest('hex')}`;
}

export function googleEventBody(payload: CalendarPayload) {
  const event = calendarRequest('', 'upsert', payload.entry_id, null, payload).event!;
  return { id: googleEventId(payload.entry_id), summary: event.title, description: event.description,
    start: { dateTime: event.start }, end: { dateTime: event.end },
    extendedProperties: { private: { timeloggerEntryId: payload.entry_id } } };
}
