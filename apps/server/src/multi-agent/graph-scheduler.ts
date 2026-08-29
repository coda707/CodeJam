import type { TaskNode } from "./contracts.js";

/**
 * Returns every `pending` Task whose dependencies are all in `succeededIds`.
 * Extracted from the service loop so dependency readiness can be unit-tested
 * independently of execution, and so the scheduler stays deterministic.
 */
export function computeReadyTasks(
  tasks: TaskNode[],
  succeededIds: ReadonlySet<string>,
): TaskNode[] {
  return tasks.filter(
    (task) =>
      task.status === "pending" &&
      task.dependencies.every((dependency) => succeededIds.has(dependency)),
  );
}
