import 'server-only';
import { adminClient } from './admin';

export type Project = { id: string; user_id: string; key: string; name: string; color: string; archived: boolean; created_at: string };
export type Task = { id: string; user_id: string; project_id: string; key: string; name: string; archived: boolean; created_at: string };
export type Tag = { id: string; user_id: string; name: string; color: string; created_at: string };

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const colorPattern = /^#[0-9a-f]{6}$/i;

export function catalogKey(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
}

export async function resolveSelection(userId: string, projectId: unknown, taskId: unknown) {
  if (projectId !== undefined && projectId !== null && (typeof projectId !== 'string' || (projectId && !uuidPattern.test(projectId)))) throw new Error('Invalid project');
  if (taskId !== undefined && taskId !== null && (typeof taskId !== 'string' || (taskId && !uuidPattern.test(taskId)))) throw new Error('Invalid task');
  const client = adminClient();
  let project: Project | null = null;
  let task: Task | null = null;
  if (projectId) {
    const { data, error } = await client.from('timelogger_projects').select('*').eq('id', projectId).eq('user_id', userId).eq('archived', false).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Project not found');
    project = data as Project;
  }
  if (taskId) {
    if (!project) throw new Error('Select a project before a task');
    const { data, error } = await client.from('timelogger_tasks').select('*').eq('id', taskId).eq('user_id', userId).eq('project_id', project.id).eq('archived', false).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Task not found in this project');
    task = data as Task;
  }
  return { project, task };
}

export async function setEntryTags(userId: string, entryId: string, tagIds: unknown) {
  if (!Array.isArray(tagIds) || tagIds.length > 30 || tagIds.some((id) => typeof id !== 'string' || !uuidPattern.test(id))) throw new Error('Invalid tags');
  const { error } = await adminClient().rpc('timelogger_set_entry_tags', {
    p_user_id: userId, p_entry_id: entryId, p_tag_ids: [...new Set(tagIds)] as string[],
  });
  if (error) throw error;
}

export async function validateTagIds(userId: string, tagIds: unknown): Promise<string[]> {
  if (!Array.isArray(tagIds) || tagIds.length > 30 || tagIds.some((id) => typeof id !== 'string' || !uuidPattern.test(id))) throw new Error('Invalid tags');
  const unique = [...new Set(tagIds)] as string[];
  if (!unique.length) return unique;
  const { data, error } = await adminClient().from('timelogger_tags').select('id').eq('user_id', userId).in('id', unique);
  if (error) throw error;
  if (data.length !== unique.length) throw new Error('Tag not found');
  return unique;
}

export async function attachTagsToNewEntry(userId: string, entryId: string, tagIds: string[]) {
  if (!tagIds.length) return;
  try { await setEntryTags(userId, entryId, tagIds); }
  catch (caught) {
    const rollback = await adminClient().from('timelogger_time_entries').delete().eq('id', entryId).eq('user_id', userId);
    if (rollback.error) console.error('Could not roll back entry after tag assignment failed', rollback.error);
    throw caught;
  }
}

export async function ensureJiraCatalog(userId: string, projectKey: string, issueKey: string) {
  if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(projectKey) || !new RegExp(`^${projectKey}-[0-9]+$`).test(issueKey)) return;
  const client = adminClient();
  const { data: project, error: projectError } = await client.from('timelogger_projects')
    .upsert({ user_id: userId, key: projectKey, name: projectKey }, { onConflict: 'user_id,key', ignoreDuplicates: true })
    .select('id').maybeSingle();
  if (projectError) throw projectError;
  let projectId = project?.id as string | undefined;
  if (!projectId) {
    const existing = await client.from('timelogger_projects').select('id').eq('user_id', userId).eq('key', projectKey).single();
    if (existing.error) throw existing.error;
    projectId = existing.data.id;
  }
  const { error: taskError } = await client.from('timelogger_tasks')
    .upsert({ user_id: userId, project_id: projectId, key: issueKey, name: issueKey }, { onConflict: 'project_id,key', ignoreDuplicates: true });
  if (taskError) throw taskError;
}
