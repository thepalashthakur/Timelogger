import { NextRequest, NextResponse } from 'next/server';
import { authenticated, badRequest, details, unauthorized } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  const { data, error } = await auth.client.from('timelogger_time_entries').select('*').in('status', ['running', 'paused']).maybeSingle();
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ entry: data });
}

export async function POST(req: NextRequest) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return badRequest('Invalid JSON'); }
  const action = body.action;
  if (!['start', 'pause', 'resume', 'stop'].includes(String(action))) return badRequest('Invalid timer action');
  if (action === 'start') {
    const fields = details(body);
    if (!fields) return badRequest('Invalid entry details');
    const { data, error } = await auth.client.rpc('timelogger_start_timer', {
      p_project: fields.project, p_task: fields.task, p_description: fields.description,
    });
    return error ? badRequest(error.message) : NextResponse.json({ entry: data });
  }
  const { data, error } = await auth.client.rpc('timelogger_transition_timer', { p_action: action });
  return error ? badRequest(error.message) : NextResponse.json({ entry: data });
}
