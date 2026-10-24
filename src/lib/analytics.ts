import { taskLineage, type ProjectRef, type TaskRef } from './entry-insights';

export type AnalyticsGroupBy = 'project' | 'task' | 'root_task' | 'tag' | 'day' | 'week';
export type AnalyticsEntry = {
  id: string; project: string; task: string; description: string;
  start_at: string; end_at: string | null; status: 'running' | 'paused' | 'stopped';
  elapsed_seconds: number; last_resumed_at: string | null;
};
export type AnalyticsTask = TaskRef & { name: string };
export type AnalyticsProject = ProjectRef & { name: string };
export type AnalyticsTag = { id: string; name: string };
export type AnalyticsGroup = { key: string; label: string; seconds: number; entries: number; recent_entries: AnalyticsEntry[] };

function localDay(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function weekStart(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

export function summarizeAnalytics(options: {
  entries: AnalyticsEntry[]; projects: AnalyticsProject[]; tasks: AnalyticsTask[]; tags: AnalyticsTag[];
  tagIdsByEntry: Record<string, string[]>; groupBy: AnalyticsGroupBy; timeZone: string;
  projectKey?: string; taskId?: string; includeChildren?: boolean; tagId?: string;
  status?: string; search?: string; now?: number;
}) {
  const { entries, projects, tasks, tags, tagIdsByEntry, groupBy, timeZone } = options;
  const now = options.now ?? Date.now();
  const projectByKey = new Map(projects.map((project) => [project.key, project]));
  const taskByProjectAndKey = new Map(tasks.map((task) => [`${task.project_id}\0${task.key}`, task]));
  const tagById = new Map(tags.map((tag) => [tag.id, tag]));
  const selectedTask = tasks.find((task) => task.id === options.taskId);
  const taskIds = new Set(selectedTask ? [selectedTask.id] : []);
  if (selectedTask && options.includeChildren) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of tasks) {
        if (task.project_id === selectedTask.project_id && task.parent_task_id && taskIds.has(task.parent_task_id) && !taskIds.has(task.id)) {
          taskIds.add(task.id); changed = true;
        }
      }
    }
  }
  const taskKeys = new Set(tasks.filter((task) => taskIds.has(task.id)).map((task) => task.key));
  const selectedProject = selectedTask ? projects.find((project) => project.id === selectedTask.project_id) : null;
  const search = options.search?.trim().toLocaleLowerCase() ?? '';
  const groups = new Map<string, AnalyticsGroup>();
  const trend = new Map<string, { day: string; seconds: number; entries: number }>();
  let totalSeconds = 0;
  let entryCount = 0;
  let activeCount = 0;
  for (const entry of entries) {
    const entryTags = tagIdsByEntry[entry.id] ?? [];
    if (options.projectKey && entry.project !== options.projectKey) continue;
    if (selectedTask && (entry.project !== selectedProject?.key || !taskKeys.has(entry.task))) continue;
    if (options.tagId && !entryTags.includes(options.tagId)) continue;
    if (options.status && options.status !== 'all' && entry.status !== options.status) continue;
    if (search && !`${entry.project} ${entry.task} ${entry.description}`.toLocaleLowerCase().includes(search)) continue;

    const seconds = Math.max(0, Number(entry.elapsed_seconds) + (entry.status === 'running' && entry.last_resumed_at ? Math.max(0, Math.floor((now - Date.parse(entry.last_resumed_at)) / 1000)) : 0));
    const day = localDay(entry.start_at, timeZone);
    const daily = trend.get(day) ?? { day, seconds: 0, entries: 0 };
    daily.seconds += seconds; daily.entries += 1; trend.set(day, daily);
    totalSeconds += seconds; entryCount += 1;
    if (entry.status !== 'stopped') activeCount += 1;

    const project = projectByKey.get(entry.project);
    const task = project ? taskByProjectAndKey.get(`${project.id}\0${entry.task}`) : undefined;
    let assignments: { key: string; label: string }[];
    switch (groupBy) {
      case 'project': assignments = [{ key: `project:${entry.project}`, label: (project?.name ?? entry.project) || 'No project' }]; break;
      case 'task': assignments = [{ key: `task:${entry.project}:${entry.task}`, label: task ? `${project?.name ?? entry.project} › ${taskLineage(task, tasks).map((item) => item.name).join(' › ')}` : `${(project?.name ?? entry.project) || 'No project'} › ${entry.task || 'No task'}` }]; break;
      case 'root_task': {
        const root = task ? taskLineage(task, tasks)[0] : null;
        assignments = [{ key: `root:${entry.project}:${root?.key ?? entry.task}`, label: root ? `${project?.name ?? entry.project} › ${root.name}` : entry.task || 'No task' }];
        break;
      }
      case 'tag': {
        const ids = options.tagId ? [options.tagId] : entryTags;
        assignments = ids.length ? ids.map((id) => ({ key: `tag:${id}`, label: tagById.get(id)?.name ?? 'Unknown tag' })) : [{ key: 'tag:none', label: 'Untagged' }];
        break;
      }
      case 'day': assignments = [{ key: `day:${day}`, label: day }]; break;
      case 'week': { const week = weekStart(day); assignments = [{ key: `week:${week}`, label: `Week of ${week}` }]; break; }
    }
    for (const assignment of assignments) {
      const group = groups.get(assignment.key) ?? { ...assignment, seconds: 0, entries: 0, recent_entries: [] };
      group.seconds += seconds; group.entries += 1;
      if (group.recent_entries.length < 5) group.recent_entries.push(entry);
      groups.set(assignment.key, group);
    }
  }
  return {
    total_seconds: totalSeconds, entry_count: entryCount, active_count: activeCount,
    groups: [...groups.values()].sort((a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label)),
    trend: [...trend.values()].sort((a, b) => a.day.localeCompare(b.day)),
    overlapping_groups: groupBy === 'tag',
  };
}
