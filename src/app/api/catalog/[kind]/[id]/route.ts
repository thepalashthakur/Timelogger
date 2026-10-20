import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin';
import { authenticated, badRequest, unauthorized } from '@/lib/api';
import { colorPattern, uuidPattern } from '@/lib/catalog';

type Context = { params: Promise<{ kind: string; id: string }> };
const tables = { projects: 'timelogger_projects', tasks: 'timelogger_tasks', tags: 'timelogger_tags' } as const;
const notFound = () => NextResponse.json({ error: 'Item not found' }, { status: 404 });

export async function PATCH(req: NextRequest, { params }: Context) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  const { kind, id } = await params;
  if (!Object.hasOwn(tables, kind) || !uuidPattern.test(id)) return badRequest('Invalid catalog item');
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return badRequest('Invalid JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return badRequest('Invalid catalog item');
  const updates: Record<string, string | boolean> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > (kind === 'tags' ? 100 : 200)) return badRequest('Invalid name');
    updates.name = body.name.trim();
  }
  if (body.color !== undefined) {
    if (kind === 'tasks' || typeof body.color !== 'string' || !colorPattern.test(body.color)) return badRequest('Invalid color');
    updates.color = body.color;
  }
  if (body.archived !== undefined) {
    if (kind === 'tags' || typeof body.archived !== 'boolean') return badRequest('Invalid archive state');
    updates.archived = body.archived;
  }
  if (!Object.keys(updates).length) return badRequest('No changes provided');
  const table = tables[kind as keyof typeof tables];
  const { data, error } = await adminClient().from(table).update(updates).eq('id', id).eq('user_id', auth.userId).select('*').maybeSingle();
  if (error) return badRequest(error.code === '23505' ? 'Name already exists' : error.message);
  return data ? NextResponse.json({ item: data }) : notFound();
}

export async function DELETE(req: NextRequest, { params }: Context) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  const { kind, id } = await params;
  if (!Object.hasOwn(tables, kind) || !uuidPattern.test(id)) return badRequest('Invalid catalog item');
  const table = tables[kind as keyof typeof tables];
  const client = adminClient();
  const query = kind === 'tags'
    ? client.from(table).delete()
    : client.from(table).update({ archived: true });
  const { data, error } = await query.eq('id', id).eq('user_id', auth.userId).select('id').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return data ? NextResponse.json({ deleted: kind === 'tags', archived: kind !== 'tags' }) : notFound();
}
