import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(relativePath, imports = {}, globals = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { exports: {}, require: (name) => imports[name] ?? require(name), ...globals };
  vm.runInNewContext(compiled, context);
  return context.exports;
}

const protocol = load('../src/lib/calendar-protocol.ts');
const { googleEventId, googleEventBody } = load('../src/lib/google-calendar-protocol.ts', { './calendar-protocol': protocol });

test('direct Google events use stable IDs and retain the Timelogger entry link', () => {
  const entry = {
    entry_id: 'b3594b5f-a335-4da2-9e73-6ca9c86e7f11', project: 'COURSES',
    task: 'COURSES-7', description: 'Review task',
    start_at: '2026-10-24T09:00:00Z', end_at: '2026-10-24T10:00:00Z',
  };
  const first = googleEventBody(entry);
  const changed = googleEventBody({ ...entry, description: 'Updated', end_at: '2026-10-24T11:00:00Z' });
  assert.match(googleEventId(entry.entry_id), /^tl[0-9a-f]{64}$/);
  assert.equal(first.id, changed.id);
  assert.equal(changed.summary, 'COURSES — COURSES-7');
  assert.equal(changed.end.dateTime, '2026-10-24T11:00:00Z');
  assert.equal(changed.extendedProperties.private.timeloggerEntryId, entry.entry_id);
  assert.match(changed.description, /Updated/);
});

test('creating a calendar sends the name to Google and selects its returned ID', async () => {
  const calls = [];
  const adminClient = () => ({ from(table) {
    assert.equal(table, 'timelogger_google_connections');
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { refresh_token_encrypted: 'encrypted', calendar_id: 'old' }, error: null }) }) }),
      update: (value) => { calls.push({ update: value }); return { eq: async () => ({ error: null }) }; },
    };
  } });
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body), authorization: init.headers.Authorization });
    return { ok: true, json: async () => ({ id: 'new-calendar@example.com', summary: 'Work log' }) };
  };
  const module = load('../src/lib/google-calendar.ts', {
    'server-only': {}, './admin': { adminClient }, './google-calendar-protocol': {},
    './google-oauth': { refreshGoogleAccessToken: async () => 'access-token' },
  }, { fetch, AbortSignal });
  const calendar = await module.createGoogleCalendar('user-id', 'Work log');
  assert.equal(calendar.id, 'new-calendar@example.com');
  assert.equal(calls[0].url, 'https://www.googleapis.com/calendar/v3/calendars');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.summary, 'Work log');
  assert.equal(calls[0].authorization, 'Bearer access-token');
  assert.equal(calls[1].update.calendar_id, calendar.id);
});
