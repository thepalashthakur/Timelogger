import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin';
import { authenticated, unauthorized } from '@/lib/api';

export async function POST(req: NextRequest) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  const { data, error } = await adminClient().rpc('timelogger_import_catalog', { p_user_id: auth.userId });
  return error
    ? NextResponse.json({ error: error.message }, { status: 500 })
    : NextResponse.json(data);
}
