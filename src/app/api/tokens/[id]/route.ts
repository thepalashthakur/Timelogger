import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin';
import { authenticatedUser, unauthorized } from '@/lib/api';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticatedUser(req);
  if (!auth) return unauthorized();
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: 'Invalid token ID' }, { status: 400 });
  const { data, error } = await adminClient().from('timelogger_api_tokens')
    .update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('user_id', auth.userId)
    .is('revoked_at', null).select('id').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return data ? NextResponse.json({ revoked: true }) : NextResponse.json({ error: 'Token not found' }, { status: 404 });
}
