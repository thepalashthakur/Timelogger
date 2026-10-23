import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin';
import { authenticatedUser, badRequest, unauthorized } from '@/lib/api';

export const dynamic = 'force-dynamic';

function deploymentUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || url.port || url.username || url.password || url.search || url.hash
      || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) return null;
    return url.toString();
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const auth = await authenticatedUser(req);
  if (!auth) return unauthorized();
  const { data, error } = await adminClient().from('timelogger_calendar_integrations')
    .select('script_url,updated_at').eq('user_id', auth.userId).maybeSingle();
  return error ? NextResponse.json({ error: error.message }, { status: 500 })
    : NextResponse.json({ integration: data });
}

export async function PUT(req: NextRequest) {
  const auth = await authenticatedUser(req);
  if (!auth) return unauthorized();
  let body: unknown;
  try { body = await req.json(); } catch { return badRequest('Invalid JSON'); }
  const url = deploymentUrl((body as Record<string, unknown> | null)?.script_url);
  if (!url) return badRequest('Enter an HTTPS Google Apps Script deployment URL ending in /exec');
  const { data, error } = await adminClient().from('timelogger_calendar_integrations')
    .upsert({ user_id: auth.userId, script_url: url, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('script_url,updated_at').single();
  return error ? NextResponse.json({ error: error.message }, { status: 500 })
    : NextResponse.json({ integration: data });
}

export async function DELETE(req: NextRequest) {
  const auth = await authenticatedUser(req);
  if (!auth) return unauthorized();
  const { error } = await adminClient().from('timelogger_calendar_integrations')
    .delete().eq('user_id', auth.userId);
  return error ? NextResponse.json({ error: error.message }, { status: 500 })
    : NextResponse.json({ disconnected: true });
}
