import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function load(relativePath, requireStub = () => { throw new Error('Unexpected import'); }) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const context = { exports: {}, require: requireStub, Date, Intl, Map, Set, Math, Number, Object };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
}

const hierarchy = load('../src/lib/entry-insights.ts');
const { summarizeAnalytics } = load('../src/lib/analytics.ts', () => hierarchy);
const projects = [{ id: 'project', key: 'P', name: 'Product' }];
const tasks = [
  { id: 'epic', project_id: 'project', key: 'P-1', name: 'Epic', parent_task_id: null },
  { id: 'task', project_id: 'project', key: 'P-2', name: 'Task', parent_task_id: 'epic' },
  { id: 'subtask', project_id: 'project', key: 'P-3', name: 'Subtask', parent_task_id: 'task' },
];
const entries = [
  { id: 'one', project: 'P', task: 'P-2', description: 'Work', status: 'stopped', start_at: '2026-10-24T23:30:00Z', end_at: '2026-10-25T00:30:00Z', elapsed_seconds: 3600, last_resumed_at: null },
  { id: 'two', project: 'P', task: 'P-3', description: 'Review', status: 'stopped', start_at: '2026-10-24T11:00:00Z', end_at: '2026-10-24T11:30:00Z', elapsed_seconds: 1800, last_resumed_at: null },
  { id: 'three', project: 'P', task: 'P-1', description: 'Planning', status: 'running', start_at: '2026-10-24T10:00:00Z', end_at: null, elapsed_seconds: 600, last_resumed_at: '2026-10-24T11:50:00Z' },
];
const base = { entries, projects, tasks, tags: [{ id: 'a', name: 'Focus' }, { id: 'b', name: 'Meeting' }], tagIdsByEntry: { one: ['a', 'b'], two: ['a'] }, timeZone: 'Asia/Kolkata', now: Date.parse('2026-10-24T12:00:00Z') };

test('root-task grouping rolls descendants up without double counting entries', () => {
  const result = summarizeAnalytics({ ...base, groupBy: 'root_task' });
  assert.equal(result.entry_count, 3);
  assert.equal(result.total_seconds, 6600);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].seconds, 6600);
  assert.match(result.groups[0].label, /Epic/);
});

test('task subtree filter includes children, and exact filter excludes them', () => {
  const subtree = summarizeAnalytics({ ...base, groupBy: 'task', taskId: 'task', includeChildren: true });
  const exact = summarizeAnalytics({ ...base, groupBy: 'task', taskId: 'task', includeChildren: false });
  assert.equal(subtree.entry_count, 2);
  assert.equal(subtree.total_seconds, 5400);
  assert.equal(exact.entry_count, 1);
  assert.equal(exact.total_seconds, 3600);
});

test('tag groups can overlap while the total counts each entry once', () => {
  const result = summarizeAnalytics({ ...base, groupBy: 'tag', status: 'stopped' });
  assert.equal(result.total_seconds, 5400);
  assert.equal(result.groups.reduce((sum, group) => sum + group.seconds, 0), 9000);
  assert.equal(result.overlapping_groups, true);
});

test('day grouping uses the requested timezone for an entry near midnight UTC', () => {
  const result = summarizeAnalytics({ ...base, groupBy: 'day', status: 'stopped' });
  assert.ok(result.trend.some((day) => day.day === '2026-10-25' && day.seconds === 3600));
});
