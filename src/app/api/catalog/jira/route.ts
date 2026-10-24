import { NextRequest, NextResponse } from 'next/server';
import { authenticated, badRequest, unauthorized } from '@/lib/api';
import { adminClient } from '@/lib/admin';
import { ensureJiraCatalog } from '@/lib/catalog';
import { setTaskHierarchy } from '@/lib/task-hierarchy';
import { jiraIssueUrl } from '@/lib/jira-links';

export const dynamic = 'force-dynamic';

type JiraNode = { key: string; project_key: string; summary: string; issue_type: string };

export async function POST(req: NextRequest) {
  const auth = await authenticated(req);
  if (!auth) return unauthorized();
  let body: unknown;
  try { body = await req.json(); } catch { return badRequest('Invalid JSON'); }
  const nodes = (body as { nodes?: unknown })?.nodes;
  if (!Array.isArray(nodes) || !nodes.length || nodes.length > 10) return badRequest('Invalid Jira hierarchy');
  const valid = nodes.every((node) => {
    if (!node || typeof node !== 'object') return false;
    const value = node as JiraNode;
    return typeof value.project_key === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(value.project_key)
      && typeof value.key === 'string' && value.key.length <= 100 && value.key.startsWith(`${value.project_key}-`) && /^\d+$/.test(value.key.slice(value.project_key.length + 1))
      && typeof value.summary === 'string' && value.summary.trim().length > 0 && value.summary.trim().length <= 200
      && typeof value.issue_type === 'string' && value.issue_type.trim().length > 0 && value.issue_type.trim().length <= 100;
  });
  if (!valid || new Set(nodes.map((node: JiraNode) => node.key)).size !== nodes.length) return badRequest('Invalid Jira hierarchy');
  const siteUrl = (body as { site_url?: unknown }).site_url;
  if (siteUrl !== undefined && !jiraIssueUrl(siteUrl, (nodes.at(-1) as JiraNode).key)) return badRequest('Invalid Jira site URL');
  const client = adminClient();
  let parent: { id: string; project_id: string } | null = null;
  const linkedTaskIds: string[] = [];
  try {
    for (const node of nodes as JiraNode[]) {
      await ensureJiraCatalog(auth.userId, node.project_key, node.key);
      const project = await client.from('timelogger_projects').select('id,name').eq('user_id', auth.userId).eq('key', node.project_key).single();
      if (project.error) throw project.error;
      const task = await client.from('timelogger_tasks').select('id,project_id,name').eq('user_id', auth.userId).eq('project_id', project.data.id).eq('key', node.key).single();
      if (task.error) throw task.error;
      if (task.data.name === node.key) {
        const rename = await client.from('timelogger_tasks').update({ name: node.summary.trim() }).eq('id', task.data.id).eq('user_id', auth.userId);
        if (rename.error) throw rename.error;
      }
      await setTaskHierarchy(auth.userId, task.data.id,
        parent && parent.project_id === task.data.project_id ? parent.id : null, node.issue_type, 'jira');
      linkedTaskIds.push(task.data.id);
      parent = { id: task.data.id, project_id: task.data.project_id };
    }
    if (typeof siteUrl === 'string') {
      const { error } = await client.from('timelogger_jira_task_links').upsert(linkedTaskIds.map((taskId) => ({
        task_id: taskId, user_id: auth.userId, site_url: siteUrl, updated_at: new Date().toISOString(),
      })), { onConflict: 'task_id' });
      if (error && !['PGRST205', '42P01'].includes(error.code)) throw error;
    }
  } catch (caught) {
    return NextResponse.json({ error: caught instanceof Error ? caught.message : 'Could not sync Jira hierarchy' }, { status: 500 });
  }
  return NextResponse.json({ synced: nodes.length });
}
