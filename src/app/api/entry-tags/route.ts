import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin';
import { authenticated, badRequest, unauthorized } from '@/lib/api';
import { setEntryTags, uuidPattern } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  const ids = (req.nextUrl.searchParams.get('ids') ?? '').split(',').filter(Boolean);
  if (ids.length > 100 || ids.some((id) => !uuidPattern.test(id))) return badRequest('Invalid entry IDs');
  if (!ids.length) return NextResponse.json({ tags_by_entry: {} });
  const { data, error } = await adminClient().from('timelogger_entry_tags')
    .select('entry_id,tag_id').eq('user_id', auth.userId).in('entry_id', ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const tagsByEntry: Record<string, string[]> = {};
  for (const row of data) (tagsByEntry[row.entry_id] ??= []).push(row.tag_id);
  return NextResponse.json({ tags_by_entry: tagsByEntry });
}

export async function PUT(req: NextRequest) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return badRequest('Invalid JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.entry_id !== 'string' || !uuidPattern.test(body.entry_id)) return badRequest('Invalid entry');
  try {
    await setEntryTags(auth.userId, body.entry_id, body.tag_ids);
    return NextResponse.json({ saved: true });
  } catch (caught) {
    return badRequest(caught instanceof Error ? caught.message : 'Could not save tags');
  }
}
