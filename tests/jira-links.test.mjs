import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/jira-links.ts', import.meta.url), 'utf8');
const context = { exports: {}, URL };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const { jiraIssueUrl } = context.exports;

test('Jira issue links use the imported site and issue key', () => {
  assert.equal(jiraIssueUrl('https://projects-1.atlassian.net', 'COURSES-42'),
    'https://projects-1.atlassian.net/browse/COURSES-42');
});

test('Jira issue links reject unsafe site URLs and keys', () => {
  for (const site of ['http://projects-1.atlassian.net', 'https://evil.example',
    'https://projects-1.atlassian.net.evil.example', 'https://projects-1.atlassian.net/other',
    'https://user@projects-1.atlassian.net']) {
    assert.equal(jiraIssueUrl(site, 'COURSES-42'), null);
  }
  assert.equal(jiraIssueUrl('https://projects-1.atlassian.net', '../COURSES-42'), null);
});
