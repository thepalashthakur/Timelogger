import type { TimeEntry } from './supabase';

export type TimelineSegment = {
  entry: TimeEntry;
  startMinute: number;
  endMinute: number;
  lane: number;
  laneCount: number;
};

export function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function startOfWeek(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

function minuteOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

export function layoutDay(entries: TimeEntry[], day: Date, now: number): TimelineSegment[] {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = addDays(dayStart, 1);
  const startMs = dayStart.getTime();
  const endMs = dayEnd.getTime();
  const segments = entries.flatMap((entry) => {
    const start = Date.parse(entry.start_at);
    // The current schema does not store when a timer was paused, so show a
    // short marker at its start instead of inventing a pause/end time.
    const end = entry.status === 'paused' ? start + 10 * 60000 : entry.end_at ? Date.parse(entry.end_at) : now;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= endMs || end <= startMs || end <= start) return [];
    return [{
      entry,
      startMinute: start <= startMs ? 0 : minuteOfDay(new Date(start)),
      endMinute: end >= endMs ? 1440 : minuteOfDay(new Date(end)),
      lane: 0,
      laneCount: 1,
    }];
  }).sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);

  const laneEnds: number[] = [];
  for (const segment of segments) {
    let lane = laneEnds.findIndex((end) => end <= segment.startMinute);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = segment.endMinute;
    segment.lane = lane;
  }
  return segments.map((segment) => ({ ...segment, laneCount: laneEnds.length }));
}
