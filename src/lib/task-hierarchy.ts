import 'server-only';
import { adminClient } from './admin';
import { uuidPattern } from './catalog';

export async function setTaskHierarchy(userId: string, taskId: string, parentTaskId: unknown, issueType: unknown, source: 'manual' | 'jira') {
  if (parentTaskId !== null && (typeof parentTaskId !== 'string' || !uuidPattern.test(parentTaskId))) throw new Error('Invalid parent task');
  if (typeof issueType !== 'string' || !issueType.trim() || issueType.trim().length > 100) throw new Error('Invalid task type');
  const { error } = await adminClient().rpc('timelogger_set_task_hierarchy', {
    p_user_id: userId, p_task_id: taskId, p_parent_task_id: parentTaskId,
    p_issue_type: issueType.trim(), p_source: source,
  });
  if (error) throw error;
}
