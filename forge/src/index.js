import { createHash } from 'node:crypto';
import { fetch } from '@forge/api';
import { kvs } from '@forge/kvs';
import { makeResolver } from '@forge/resolver';

const tokenPattern = /^tl_[A-Za-z0-9_-]{43}$/;
const actions = new Set(['start', 'pause', 'resume', 'stop']);

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
    return request('/api/timer', await storedToken(context), 'POST', body);
  },
});
