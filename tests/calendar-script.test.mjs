import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/calendar-script.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleContext = { exports: {} };
vm.runInNewContext(compiled, moduleContext);
const script = moduleContext.exports.calendarScript;
const protocolSource = readFileSync(new URL('../src/lib/calendar-protocol.ts', import.meta.url), 'utf8');
const protocolContext = { exports: {} };
vm.runInNewContext(ts.transpileModule(protocolSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, protocolContext);
const { calendarRequest } = protocolContext.exports;

function bridge() {
  const events = new Map();
  const properties = new Map([['CALENDAR_ID', 'user-calendar'], ['WEBHOOK_SECRET', 'long-secret-value-for-test']]);
  let nextId = 1;
  const calendar = {
    getEventById: (id) => events.get(id) ?? null,
    createEvent(title, start, end, options) {
      const id = `event-${nextId++}`;
      const event = {
        id, title, start, end, description: options.description,
        getId: () => id,
        setTitle(value) { this.title = value; },
        setTime(first, last) { this.start = first; this.end = last; },
        setDescription(value) { this.description = value; },
        deleteEvent: () => events.delete(id),
      };
      events.set(id, event);
      return event;
    },
  };
  const context = {
    CalendarApp: { getCalendarById: (id) => id === 'user-calendar' ? calendar : null },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: (content) => ({ content, setMimeType() { return this; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties.get(key) ?? null,
      setProperty: (key, value) => properties.set(key, value),
      deleteProperty: (key) => properties.delete(key),
    }) },
  };
  vm.runInNewContext(script, context);
  const post = (payload) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(payload) } }).content);
  return { events, properties, post };
}

const event = { title: 'COURSES — COURSES-7', start: '2026-10-24T09:00:00Z', end: '2026-10-24T10:00:00Z', description: 'Review task' };

test('the existing Clockify upsert request remains supported', () => {
  const app = bridge();
  const request = { secret: 'long-secret-value-for-test', source: 'clockify', action: 'upsert', idempotencyKey: 'clockify-123', event };
  const first = app.post(request);
  assert.equal(first.ok, true);
  assert.equal(app.post(request).eventId, first.eventId);
  assert.equal(app.events.size, 1);
});

test('Timelogger creates, updates, and deletes one Calendar event', () => {
  const app = bridge();
  const entryId = 'b3594b5f-a335-4da2-9e73-6ca9c86e7f11';
  const entry = {
    entry_id: entryId, project: 'COURSES', task: 'COURSES-7', description: 'Review task',
    start_at: event.start, end_at: event.end,
  };
  const request = calendarRequest('long-secret-value-for-test', 'upsert', entryId, null, entry);
  const first = app.post(request);
  assert.equal(first.ok, true);
  assert.equal(app.events.size, 1);
  assert.equal(app.post(request).eventId, first.eventId);

  const changed = app.post(calendarRequest('long-secret-value-for-test', 'upsert', entryId, first.eventId,
    { ...entry, description: 'Updated', end_at: '2026-10-24T11:00:00Z' }));
  assert.equal(changed.eventId, first.eventId);
  assert.equal(app.events.get(first.eventId).end.toISOString(), '2026-10-24T11:00:00.000Z');
  assert.match(app.events.get(first.eventId).description, /Updated/);

  const deletion = calendarRequest('long-secret-value-for-test', 'delete', entryId, first.eventId, null);
  assert.equal(app.post(deletion).ok, true);
  assert.equal(app.events.size, 0);
  assert.equal(app.post(deletion).ok, true);
});

test('an incorrect webhook secret cannot change the calendar', () => {
  const app = bridge();
  assert.equal(app.post({ secret: 'wrong', source: 'timelogger', action: 'upsert', idempotencyKey: 'timelogger:test', event }).error, 'Unauthorized');
  assert.equal(app.events.size, 0);
});
