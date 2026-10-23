export type CalendarPayload = {
  entry_id: string;
  project: string;
  task: string;
  description: string;
  start_at: string;
  end_at: string;
};

export function calendarRequest(
  secret: string,
  action: 'upsert' | 'delete',
  entryId: string,
  eventId: string | null,
  entry: CalendarPayload | null,
) {
  const event = entry ? {
    title: [entry.project, entry.task || entry.description || 'Time entry'].filter(Boolean).join(' — '),
    start: entry.start_at,
    end: entry.end_at,
    description: [
      entry.description,
      entry.project ? `Project: ${entry.project}` : '',
      entry.task ? `Task: ${entry.task}` : '',
      `Timelogger entry: ${entry.entry_id}`,
    ].filter(Boolean).join('\n'),
  } : undefined;
  return {
    secret,
    source: 'timelogger',
    action,
    idempotencyKey: `timelogger:${entryId}`,
    eventId,
    ...(action === 'upsert' && event ? { event } : {}),
  };
}
