export type ProjectRef = { id: string; key: string };
export type TaskRef = { id: string; project_id: string; key: string; parent_task_id: string | null };

export function findEntryTask<T extends TaskRef>(projectKey: string, taskKey: string, projects: ProjectRef[], tasks: T[]): T | null {
  const project = projects.find((item) => item.key === projectKey);
  return project ? tasks.find((item) => item.project_id === project.id && item.key === taskKey) ?? null : null;
}

export function taskLineage<T extends TaskRef>(task: T, tasks: T[]): T[] {
  const chain = [task];
  const visited = new Set([task.id]);
  let parentId = task.parent_task_id;
  while (parentId && !visited.has(parentId)) {
    const parent = tasks.find((item) => item.id === parentId && item.project_id === task.project_id);
    if (!parent) break;
    chain.unshift(parent);
    visited.add(parent.id);
    parentId = parent.parent_task_id;
  }
  return chain;
}
