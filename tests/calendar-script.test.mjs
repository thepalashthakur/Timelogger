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

function bridge() {
  const events = new Map();
  const properties = new Map();
  let nextId = 1;
  const calendar = {
    getEventById: (id) => events.get(id) ?? null,
    getEvents: () => [...events.values()],
    createEvent(title, start, end, options) {
      const id = `event-${nextId++}`;
      const tags = new Map();
      const event = {
        id, title, start, end, description: options.description,
        getId: () => id,
        getTag: (key) => tags.get(key) ?? null,
        setTag: (key, value) => tags.set(key, value),
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
    CalendarApp: { getDefaultCalendar: () => calendar },
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

test('Apps Script creates once, updates the same event, and deletes it', () => {
  const app = bridge();
  const entryId = 'b3594b5f-a335-4da2-9e73-6ca9c86e7f11';
  const entry = {
    project: 'COURSES', task: 'COURSES-7', description: 'Review task',
    start_at: '2026-10-24T09:00:00Z', end_at: '2026-10-24T10:00:00Z',
  };
  const first = app.post({ action: 'upsert', entry_id: entryId, entry });
  assert.equal(first.ok, true);
  assert.equal(app.events.size, 1);
  assert.equal(app.events.get(first.event_id).title, 'COURSES — COURSES-7');

  const retry = app.post({ action: 'upsert', entry_id: entryId, entry });
  assert.equal(retry.event_id, first.event_id);
  assert.equal(app.events.size, 1);

  const changed = app.post({ action: 'upsert', entry_id: entryId, event_id: first.event_id,
    entry: { ...entry, description: 'Updated', end_at: '2026-10-24T11:00:00Z' } });
  assert.equal(changed.event_id, first.event_id);
  assert.equal(app.events.get(first.event_id).end.toISOString(), '2026-10-24T11:00:00.000Z');
  assert.match(app.events.get(first.event_id).description, /Updated/);

  assert.equal(app.post({ action: 'delete', entry_id: entryId, event_id: first.event_id }).ok, true);
  assert.equal(app.events.size, 0);
  assert.equal(app.post({ action: 'delete', entry_id: entryId, event_id: first.event_id }).ok, true);
});
