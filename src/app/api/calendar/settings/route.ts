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
  const client = adminClient();
  const [integration, secret] = await Promise.all([
    client.from('timelogger_calendar_integrations').select('script_url,updated_at').eq('user_id', auth.userId).maybeSingle(),
    client.from('timelogger_calendar_webhook_secrets').select('user_id').eq('user_id', auth.userId).maybeSingle(),
  ]);
  const error = integration.error ?? secret.error;
  return error ? NextResponse.json({ error: error.message }, { status: 500 })
    : NextResponse.json({ integration: integration.data, has_secret: Boolean(secret.data) });
}

export async function PUT(req: NextRequest) {
  const auth = await authenticatedUser(req);
  if (!auth) return unauthorized();
  let body: unknown;
  try { body = await req.json(); } catch { return badRequest('Invalid JSON'); }
  const input = body as Record<string, unknown> | null;
  const url = deploymentUrl(input?.script_url);
  if (!url) return badRequest('Enter an HTTPS Google Apps Script deployment URL ending in /exec');
  const providedSecret = input?.webhook_secret;
  if (providedSecret !== undefined && (typeof providedSecret !== 'string' || providedSecret.length > 512)) {
    return badRequest('Invalid webhook secret');
  }
  const client = adminClient();
  const { data: existingSecret, error: readError } = await client.from('timelogger_calendar_webhook_secrets')
    .select('user_id').eq('user_id', auth.userId).maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!existingSecret && (!providedSecret || !providedSecret.trim())) return badRequest('Enter the WEBHOOK_SECRET from your Apps Script properties');
  if (providedSecret) {
    if (!providedSecret.trim()) return badRequest('Webhook secret cannot be blank');
    const { error: secretError } = await client.from('timelogger_calendar_webhook_secrets').upsert({
      user_id: auth.userId, webhook_secret: providedSecret, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (secretError) return NextResponse.json({ error: secretError.message }, { status: 500 });
  }
  const { data, error } = await client.from('timelogger_calendar_integrations')
    .upsert({ user_id: auth.userId, script_url: url, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('script_url,updated_at').single();
  return error ? NextResponse.json({ error: error.message }, { status: 500 })
    : NextResponse.json({ integration: data, has_secret: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await authenticatedUser(req);
  if (!auth) return unauthorized();
  const client = adminClient();
  const { error } = await client.from('timelogger_calendar_integrations')
    .delete().eq('user_id', auth.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { error: secretError } = await client.from('timelogger_calendar_webhook_secrets')
    .delete().eq('user_id', auth.userId);
  return secretError ? NextResponse.json({ error: secretError.message }, { status: 500 })
    : NextResponse.json({ disconnected: true });
}
