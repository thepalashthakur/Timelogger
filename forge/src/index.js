import { createHash } from 'node:crypto';
import api, { fetch, route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { makeResolver } from '@forge/resolver';

const tokenPattern = /^tl_[A-Za-z0-9_-]{43}$/;
const actions = new Set(['start', 'pause', 'resume', 'stop']);
const jiraKeyPattern = /^[A-Z][A-Z0-9_]{0,99}-[0-9]+$/;

async function jiraHierarchy(issueKey) {
  const nodes = [];
  const visited = new Set();
  let key = issueKey;
  while (key && nodes.length < 10 && !visited.has(key)) {
    if (!jiraKeyPattern.test(key)) throw new Error('Invalid Jira issue key');
    visited.add(key);
    const response = await api.asUser().requestJira(route`/rest/api/3/issue/${key}?fields=summary,issuetype,parent,project`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Could not read Jira issue ${key} (${response.status})`);
    const issue = await response.json();
    nodes.push({
      key: issue.key,
      project_key: issue.fields?.project?.key,
      summary: issue.fields?.summary,
      issue_type: issue.fields?.issuetype?.name,
    });
    key = issue.fields?.parent?.key ?? null;
  }
  if (key) throw new Error('Jira issue hierarchy is too deep or cyclic');
  return nodes.reverse();
}

function userKey(context) {
  const accountId = context?.accountId;
  if (typeof accountId !== 'string' || !accountId) {
    throw new Error('Jira account is unavailable');
  }
  return `token:${createHash('sha256').update(accountId).digest('hex')}`;
}

function apiOrigin() {
  const raw = process.env.TIMELOGGER_API_ORIGIN;
  if (!raw) throw new Error('Timelogger API origin is not configured');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Timelogger API origin must be an HTTPS origin');
  }
  return url.origin;
}

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${apiOrigin()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('Timelogger token is invalid or expired. Connect a new token.');
    throw new Error(typeof result.error === 'string' ? result.error : `Timelogger request failed (${response.status})`);
  }
  return result;
}

async function storedToken(context) {
  const token = await kvs.getSecret(userKey(context));
  if (!token) throw new Error('Connect your Timelogger token first');
  return token;
}

export const handler = makeResolver({
  connection: async ({ context }) => ({ connected: Boolean(await kvs.getSecret(userKey(context))) }),

  connect: async ({ context, payload }) => {
    const token = typeof payload?.token === 'string' ? payload.token.trim() : '';
    if (!tokenPattern.test(token)) throw new Error('Enter a valid Timelogger API token');
    await request('/api/timer', token);
    await kvs.setSecret(userKey(context), token);
    return { connected: true };
  },

  disconnect: async ({ context }) => {
    await kvs.deleteSecret(userKey(context));
    return { connected: false };
  },

  timer: async ({ context }) => request('/api/timer', await storedToken(context)),

  entries: async ({ context }) => request('/api/entries', await storedToken(context)),

  catalog: async ({ context }) => request('/api/catalog', await storedToken(context)),

  timerAction: async ({ context, payload }) => {
    const action = payload?.action;
    if (!actions.has(action)) throw new Error('Invalid timer action');
    const body = { action };
    if (action === 'start') {
      for (const field of ['project', 'task', 'description']) {
        if (typeof payload?.[field] !== 'string' || payload[field].length > 500) {
          throw new Error(`Invalid ${field}`);
        }
        body[field] = payload[field].trim();
      }
      if (!Array.isArray(payload?.tag_ids) || payload.tag_ids.length > 30 || payload.tag_ids.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) {
        throw new Error('Invalid tags');
      }
      body.tag_ids = payload.tag_ids;
    }
    const token = await storedToken(context);
    if (action === 'start' && jiraKeyPattern.test(body.task)) {
      const nodes = await jiraHierarchy(body.task);
      if (nodes.at(-1)?.project_key !== body.project) throw new Error('Jira issue project does not match');
      await request('/api/catalog/jira', token, 'POST', { nodes });
    }
    return request('/api/timer', token, 'POST', body);
  },
});
