import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin';
import { authenticated, badRequest, unauthorized } from '@/lib/api';
import { catalogKey, colorPattern, uuidPattern } from '@/lib/catalog';
import { setTaskHierarchy } from '@/lib/task-hierarchy';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  const client = adminClient();
  const [projects, tasks, tags, hierarchy, totals] = await Promise.all([
    client.from('timelogger_projects').select('*').eq('user_id', auth.userId).order('name').limit(1000),
    client.from('timelogger_tasks').select('*').eq('user_id', auth.userId).order('name').limit(2000),
    client.from('timelogger_tags').select('*').eq('user_id', auth.userId).order('name').limit(1000),
    client.from('timelogger_task_hierarchy').select('task_id,parent_task_id,issue_type,source').eq('user_id', auth.userId).limit(2000),
    client.rpc('timelogger_task_totals', { p_user_id: auth.userId }),
  ]);
  const error = projects.error ?? tasks.error ?? tags.error ?? hierarchy.error ?? totals.error;
  const metadata = new Map((hierarchy.data ?? []).map((row) => [row.task_id, row]));
  return error
    ? NextResponse.json({ error: error.message }, { status: 500 })
    : NextResponse.json({ projects: projects.data, tasks: tasks.data?.map((task) => ({
      ...task, parent_task_id: metadata.get(task.id)?.parent_task_id ?? null,
      issue_type: metadata.get(task.id)?.issue_type ?? 'Task',
      source: metadata.get(task.id)?.source ?? 'manual',
    })), tags: tags.data, totals: totals.data });
}

export async function POST(req: NextRequest) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return badRequest('Invalid JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return badRequest('Invalid catalog item');
  const kind = body.kind;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > (kind === 'tag' ? 100 : 200)) return badRequest('Invalid name');
  const color = body.color === undefined ? undefined : body.color;
  if (color !== undefined && (typeof color !== 'string' || !colorPattern.test(color))) return badRequest('Invalid color');
  const client = adminClient();
  if (kind === 'tag') {
    const { data, error } = await client.from('timelogger_tags').insert({ user_id: auth.userId, name, ...(color ? { color } : {}) }).select('*').single();
    return error ? badRequest(error.code === '23505' ? 'Tag already exists' : error.message) : NextResponse.json({ item: data }, { status: 201 });
  }
  const key = typeof body.key === 'string' ? catalogKey(body.key) : catalogKey(name);
  if (!key) return badRequest('Invalid key');
  if (kind === 'project') {
    const { data, error } = await client.from('timelogger_projects').insert({ user_id: auth.userId, key, name, ...(color ? { color } : {}) }).select('*').single();
    return error ? badRequest(error.code === '23505' ? 'Project key already exists' : error.message) : NextResponse.json({ item: data }, { status: 201 });
  }
  if (kind === 'task') {
    const projectId = body.project_id;
    if (typeof projectId !== 'string' || !uuidPattern.test(projectId)) return badRequest('Choose a project');
    const project = await client.from('timelogger_projects').select('id').eq('id', projectId).eq('user_id', auth.userId).eq('archived', false).maybeSingle();
    if (project.error) return NextResponse.json({ error: project.error.message }, { status: 500 });
    if (!project.data) return badRequest('Project not found');
    const { data, error } = await client.from('timelogger_tasks').insert({ user_id: auth.userId, project_id: projectId, key, name }).select('*').single();
    if (error) return badRequest(error.code === '23505' ? 'Task key already exists in this project' : error.message);
    try { await setTaskHierarchy(auth.userId, data.id, body.parent_task_id ?? null, body.issue_type ?? 'Task', 'manual'); }
    catch (caught) {
      await client.from('timelogger_tasks').delete().eq('id', data.id).eq('user_id', auth.userId);
      return badRequest(caught instanceof Error ? caught.message : 'Invalid hierarchy');
    }
    return NextResponse.json({ item: data }, { status: 201 });
  }
  return badRequest('Invalid catalog kind');
}
