import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/entry-insights.ts', import.meta.url), 'utf8');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const { findEntryTask, taskLineage } = context.exports;

const projects = [{ id: 'one', key: 'COURSES' }, { id: 'two', key: 'OTHER' }];
const tasks = [
  { id: 'epic', project_id: 'one', key: 'COURSES-1', name: 'Epic', parent_task_id: null },
  { id: 'task', project_id: 'one', key: 'COURSES-2', name: 'Task', parent_task_id: 'epic' },
  { id: 'subtask', project_id: 'one', key: 'COURSES-3', name: 'Subtask', parent_task_id: 'task' },
  { id: 'same-key', project_id: 'two', key: 'COURSES-3', name: 'Other project', parent_task_id: null },
];

test('an entry resolves to its task within the selected project and keeps all ancestors', () => {
  const task = findEntryTask('COURSES', 'COURSES-3', projects, tasks);
  assert.equal(task.id, 'subtask');
  assert.deepEqual(Array.from(taskLineage(task, tasks), (item) => item.id), ['epic', 'task', 'subtask']);
});

test('legacy entries without catalog records remain displayable', () => {
  assert.equal(findEntryTask('COURSES', 'COURSES-99', projects, tasks), null);
});

test('a broken or cyclic parent link stops at the last valid task', () => {
  const cyclic = tasks.map((task) => task.id === 'epic' ? { ...task, parent_task_id: 'subtask' } : task);
  assert.deepEqual(Array.from(taskLineage(cyclic[2], cyclic), (item) => item.id), ['epic', 'task', 'subtask']);
});
