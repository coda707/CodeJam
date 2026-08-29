import type {
  CoordinationArtifact,
  CoordinationAttempt,
  CoordinationTask,
} from "../../types";

export interface TaskDependencyView {
  id: string;
  task: CoordinationTask | null;
}

export interface TaskInspectorModel {
  task: CoordinationTask;
  assignedAgentName: string | null;
  dependencies: TaskDependencyView[];
  attempts: CoordinationAttempt[];
  artifacts: CoordinationArtifact[];
}

export function buildTaskInspectorModel(
  taskId: string | null,
  tasks: readonly CoordinationTask[],
  attempts: readonly CoordinationAttempt[],
  artifacts: readonly CoordinationArtifact[],
  agentNames: ReadonlyMap<string, string>,
): TaskInspectorModel | null {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return null;
  const tasksById = new Map(tasks.map((item) => [item.id, item]));
  return {
    task,
    assignedAgentName: task.assignedAgentId
      ? (agentNames.get(task.assignedAgentId) ?? null)
      : null,
    dependencies: task.dependencies.map((dependencyId) => ({
      id: dependencyId,
      task: tasksById.get(dependencyId) ?? null,
    })),
    attempts: attempts
      .filter((attempt) => attempt.taskId === task.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    artifacts: artifacts
      .filter((artifact) => artifact.taskId === task.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
  };
}
