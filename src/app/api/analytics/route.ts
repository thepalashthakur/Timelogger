import { NextRequest, NextResponse } from 'next/server';
import { authenticated, badRequest, unauthorized } from '@/lib/api';
import { adminClient } from '@/lib/admin';
import { uuidPattern } from '@/lib/catalog';
import { summarizeAnalytics, type AnalyticsEntry, type AnalyticsGroupBy, type AnalyticsTask } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

const groupings = new Set<AnalyticsGroupBy>(['project', 'task', 'root_task', 'tag', 'day', 'week']);
const pageSize = 1000;
const maxEntries = 20000;
const entryFields = 'id,project,task,description,status,start_at,end_at,elapsed_seconds,last_resumed_at';

export async function GET(req: NextRequest) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  const params = req.nextUrl.searchParams;
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const timeZone = params.get('timezone') ?? 'UTC';
  const groupBy = (params.get('group_by') ?? 'project') as AnalyticsGroupBy;
  const projectKey = params.get('project') ?? '';
  const taskId = params.get('task_id') ?? '';
  const tagId = params.get('tag_id') ?? '';
  const status = params.get('status') ?? 'all';
  const search = (params.get('q') ?? '').trim();
  const includeChildren = params.get('include_children') !== 'false';
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs || toMs - fromMs > 366 * 86400000 + 3600000
    || !groupings.has(groupBy) || projectKey.length > 100 || (taskId && !uuidPattern.test(taskId))
    || (tagId && !uuidPattern.test(tagId)) || !['all', 'stopped', 'running', 'paused'].includes(status)
    || search.length > 100 || timeZone.length > 100) return badRequest('Invalid analytics filters or date range');
  try { new Intl.DateTimeFormat('en-US', { timeZone }); }
  catch { return badRequest('Invalid time zone'); }

  const client = adminClient();
  const [projectsResult, tasksResult, tagsResult, hierarchyResult] = await Promise.all([
    client.from('timelogger_projects').select('id,key,name').eq('user_id', auth.userId).limit(1000),
    client.from('timelogger_tasks').select('id,project_id,key,name').eq('user_id', auth.userId).limit(2000),
    client.from('timelogger_tags').select('id,name').eq('user_id', auth.userId).limit(1000),
    client.from('timelogger_task_hierarchy').select('task_id,parent_task_id').eq('user_id', auth.userId).limit(2000),
  ]);
  const catalogError = projectsResult.error ?? tasksResult.error ?? tagsResult.error ?? hierarchyResult.error;
  if (catalogError) return NextResponse.json({ error: catalogError.message }, { status: 500 });
  const projects = projectsResult.data ?? [];
  const hierarchy = new Map((hierarchyResult.data ?? []).map((row) => [row.task_id, row.parent_task_id]));
  const tasks: AnalyticsTask[] = (tasksResult.data ?? []).map((task) => ({ ...task, parent_task_id: hierarchy.get(task.id) ?? null }));
  if (taskId && !tasks.some((task) => task.id === taskId)) return badRequest('Task not found');
  if (projectKey && !projects.some((project) => project.key === projectKey)) return badRequest('Project not found');
  if (tagId && !(tagsResult.data ?? []).some((tag) => tag.id === tagId)) return badRequest('Tag not found');

  const entries: AnalyticsEntry[] = [];
  for (let offset = 0; offset <= maxEntries; offset += pageSize) {
    const selection = tagId ? `${entryFields},timelogger_entry_tags!inner(tag_id)` : entryFields;
    let query = client.from('timelogger_time_entries').select(selection)
      .eq('user_id', auth.userId).gte('start_at', new Date(fromMs).toISOString()).lt('start_at', new Date(toMs).toISOString());
    if (projectKey) query = query.eq('project', projectKey);
    if (status !== 'all') query = query.eq('status', status);
    if (tagId) query = query.eq('timelogger_entry_tags.tag_id', tagId);
    if (search) {
      const value = search.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
      query = query.or(['project', 'task', 'description'].map((field) => `${field}.ilike."%${value}%"`).join(','));
    }
    const { data, error } = await query.order('start_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const batch = (data ?? []) as unknown as AnalyticsEntry[];
    if (offset === maxEntries && batch.length) return NextResponse.json({ error: 'This report contains more than 20,000 entries. Narrow the date range or filters.' }, { status: 422 });
    entries.push(...batch);
    if (batch.length < pageSize) break;
  }

  const tagIdsByEntry: Record<string, string[]> = {};
  if (groupBy === 'tag' && entries.length) {
    const ids = entries.map((entry) => entry.id);
    for (let offset = 0; offset < ids.length; offset += 800) {
      const chunks = Array.from({ length: Math.min(8, Math.ceil((ids.length - offset) / 100)) }, (_unused, index) => ids.slice(offset + index * 100, offset + (index + 1) * 100));
      const results = await Promise.all(chunks.map((chunk) => client.from('timelogger_entry_tags').select('entry_id,tag_id').eq('user_id', auth.userId).in('entry_id', chunk).limit(3000)));
      for (const result of results) {
        if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
        for (const row of result.data ?? []) (tagIdsByEntry[row.entry_id] ??= []).push(row.tag_id);
      }
    }
  }

  const summary = summarizeAnalytics({
    entries, projects, tasks, tags: tagsResult.data ?? [], tagIdsByEntry, groupBy, timeZone,
    projectKey, taskId, tagId: groupBy === 'tag' ? tagId : undefined, includeChildren, status, search, now: Date.now(),
  });
  return NextResponse.json({ ...summary, groups: summary.groups.slice(0, 500), group_count: summary.groups.length,
    groups_truncated: summary.groups.length > 500, from, to, group_by: groupBy });
}
