import type { CoordinationTask } from "../../types";

export interface TaskGraphEdge {
  fromTaskId: string;
  toTaskId: string;
}

export interface TaskGraphIssue {
  type: "missing_dependency" | "cycle";
  taskId: string;
  dependencyId?: string;
}

export interface TaskGraphLayer {
  index: number;
  tasks: CoordinationTask[];
}

export interface TaskGraphModel {
  layers: TaskGraphLayer[];
  edges: TaskGraphEdge[];
  issues: TaskGraphIssue[];
}

const selectionPriority: Record<CoordinationTask["status"], number> = {
  failed: 0,
  running: 1,
  verifying: 1,
  leased: 1,
  ready: 1,
  pending: 2,
  blocked: 3,
  succeeded: 4,
  superseded: 5,
};

export function buildTaskGraphModel(
  tasks: readonly CoordinationTask[],
): TaskGraphModel {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const inputOrder = new Map(tasks.map((task, index) => [task.id, index]));
  const indegree = new Map(tasks.map((task) => [task.id, 0]));
  const children = new Map(tasks.map((task) => [task.id, new Set<string>()]));
  const edges: TaskGraphEdge[] = [];
  const issues: TaskGraphIssue[] = [];

  for (const task of tasks) {
    const uniqueDependencies = new Set(task.dependencies);
    for (const dependencyId of uniqueDependencies) {
      if (!tasksById.has(dependencyId)) {
        issues.push({
          type: "missing_dependency",
          taskId: task.id,
          dependencyId,
        });
        continue;
      }
      indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1);
      children.get(dependencyId)?.add(task.id);
      edges.push({ fromTaskId: dependencyId, toTaskId: task.id });
    }
  }

  const compareInputOrder = (left: string, right: string) =>
    (inputOrder.get(left) ?? 0) - (inputOrder.get(right) ?? 0);
  const queue = tasks
    .filter((task) => indegree.get(task.id) === 0)
    .map((task) => task.id)
    .sort(compareInputOrder);
  const levels = new Map(queue.map((taskId) => [taskId, 0]));
  const processed = new Set<string>();

  while (queue.length > 0) {
    const taskId = queue.shift()!;
    processed.add(taskId);
    const nextLevel = (levels.get(taskId) ?? 0) + 1;
    for (const childId of children.get(taskId) ?? []) {
      levels.set(childId, Math.max(levels.get(childId) ?? 0, nextLevel));
      const remaining = (indegree.get(childId) ?? 0) - 1;
      indegree.set(childId, remaining);
      if (remaining === 0) {
        queue.push(childId);
        queue.sort(compareInputOrder);
      }
    }
  }

  const highestLevel = Math.max(-1, ...levels.values());
  for (const task of tasks) {
    if (!processed.has(task.id)) {
      issues.push({ type: "cycle", taskId: task.id });
      levels.set(task.id, highestLevel + 1);
    }
  }

  const grouped = new Map<number, CoordinationTask[]>();
  for (const task of tasks) {
    const level = levels.get(task.id) ?? 0;
    const group = grouped.get(level) ?? [];
    group.push(task);
    grouped.set(level, group);
  }

  return {
    layers: [...grouped.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, layerTasks]) => ({ index, tasks: layerTasks })),
    edges,
    issues,
  };
}

export function reconcileSelectedTaskId(
  tasks: readonly CoordinationTask[],
  currentTaskId: string | null,
): string | null {
  if (currentTaskId && tasks.some((task) => task.id === currentTaskId)) {
    return currentTaskId;
  }
  return (
    tasks
      .map((task, index) => ({ task, index }))
      .sort(
        (left, right) =>
          selectionPriority[left.task.status] -
            selectionPriority[right.task.status] ||
          left.index - right.index,
      )[0]?.task.id ?? null
  );
}
