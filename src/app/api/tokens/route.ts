import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { adminClient, tokenHash } from '@/lib/admin';
import { authenticatedUser, badRequest, unauthorized } from '@/lib/api';

export const dynamic = 'force-dynamic';

const fields = 'id,name,created_at,expires_at,last_used_at,revoked_at';

export async function GET(req: NextRequest) {
  const auth = await authenticatedUser(req);
  if (!auth) return unauthorized();
  const { data, error } = await adminClient().from('timelogger_api_tokens').select(fields)
    .eq('user_id', auth.userId).is('revoked_at', null).order('created_at', { ascending: false });
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ tokens: data });
}

export async function POST(req: NextRequest) {
  const auth = await authenticatedUser(req);
  if (!auth) return unauthorized();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return badRequest('Invalid JSON'); }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) return badRequest('Name must be 1 to 80 characters');
  const client = adminClient();
  const { count, error: countError } = await client.from('timelogger_api_tokens')
    .select('id', { count: 'exact', head: true }).eq('user_id', auth.userId)
    .is('revoked_at', null).gt('expires_at', new Date().toISOString());
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
  if ((count ?? 0) >= 10) return badRequest('Revoke an active token before creating another');
  const token = `tl_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client.from('timelogger_api_tokens').insert({
    user_id: auth.userId, name, token_hash: tokenHash(token), expires_at: expiresAt,
  }).select(fields).single();
  return error ? NextResponse.json({ error: error.message }, { status: 500 })
    : NextResponse.json({ token, record: data }, { status: 201 });
}
