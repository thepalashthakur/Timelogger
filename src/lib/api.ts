import { NextRequest, NextResponse } from 'next/server';
import { tokenClient } from './supabase';
import { adminClient, tokenHash } from './admin';
import { accessCookie, sameOriginMutation } from './useauth';
import { hasApiTokenAppAccess, hasSessionAppAccess } from './app-access';

function bearer(req: NextRequest) {
  return /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? null;
}

function sessionToken(req: NextRequest) {
  const explicit = bearer(req);
  if (explicit) return explicit;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sameOriginMutation(req)) return null;
  return req.cookies.get(accessCookie)?.value ?? null;
}

export async function authenticatedUser(req: NextRequest) {
  const token = sessionToken(req);
  if (!token || token.startsWith('tl_')) return null;
  const client = tokenClient(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user || !await hasSessionAppAccess(token)) return null;
  return { client, userId: data.user.id, kind: 'session' as const };
}

export async function authenticated(req: NextRequest) {
  const token = sessionToken(req);
  if (!token) return null;
  if (!token.startsWith('tl_')) return authenticatedUser(req);
  if (!/^tl_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const client = adminClient();
  const { data, error } = await client.from('timelogger_api_tokens')
    .select('id,user_id').eq('token_hash', tokenHash(token))
    .is('revoked_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (error || !data) return null;
  if (!await hasApiTokenAppAccess(data.user_id as string, client)) return null;
  // Usage metadata is best effort; authentication does not depend on this write.
  await client.from('timelogger_api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  return { client, userId: data.user_id as string, kind: 'api_token' as const };
}

export const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
export const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });

export function details(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const fields = ['project', 'task', 'description'] as const;
  for (const field of fields) {
    if (input[field] !== undefined && (typeof input[field] !== 'string' || (input[field] as string).length > 500)) return null;
  }
  return {
    project: typeof input.project === 'string' ? input.project.trim() : '',
    task: typeof input.task === 'string' ? input.task.trim() : '',
    description: typeof input.description === 'string' ? input.description.trim() : '',
  };
}
