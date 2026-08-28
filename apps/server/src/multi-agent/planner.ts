import { HttpError } from "../errors.js";
import {
  plannerOutputSchema,
  type PlannerOutput,
} from "./contracts.js";
import type {
  CoordinationPlanner,
  CoordinationPlanningRequest,
} from "./ports.js";

export function validatePlannerOutput(value: unknown): PlannerOutput {
  const plan = plannerOutputSchema.parse(value);
  const tasksByKey = new Map(plan.tasks.map((task) => [task.key, task]));
  if (tasksByKey.size !== plan.tasks.length) {
    throw new HttpError(400, "Planner output contains duplicate task keys");
  }

  for (const task of plan.tasks) {
    for (const dependency of task.dependencies) {
      if (!tasksByKey.has(dependency)) {
        throw new HttpError(
          400,
          `Task ${task.key} references missing dependency ${dependency}`,
        );
      }
      if (dependency === task.key) {
        throw new HttpError(400, `Task ${task.key} cannot depend on itself`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key)) {
      throw new HttpError(400, "Planner output contains a dependency cycle");
    }
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of tasksByKey.get(key)?.dependencies ?? []) {
      visit(dependency);
    }
    visiting.delete(key);
    visited.add(key);
  };
  for (const task of plan.tasks) visit(task.key);

  return plan;
}

export function createFoundationPlan(userTask: string): PlannerOutput {
  const taskContext =
    userTask.length > 9_000 ? userTask.slice(0, 8_997) + "..." : userTask;
  return validatePlannerOutput({
    topology: "sequential",
    explanation:
      "The foundation flow proves dependency-aware scheduling before real Agent execution is connected.",
    tasks: [
      {
        key: "plan",
        title: "Plan the requested work",
        instructions: `Produce a bounded implementation plan for: ${taskContext}`,
        dependencies: [],
        requiredCapabilities: ["planning"],
        acceptanceCriteria: [
          {
            id: "plan-output",
            kind: "artifact",
            description: "A structured plan result is produced",
            value: "worker-output",
          },
        ],
      },
      {
        key: "deliver",
        title: "Deliver the requested result",
        instructions: `Use the verified plan to deliver: ${taskContext}`,
        dependencies: ["plan"],
        requiredCapabilities: ["delivery"],
        acceptanceCriteria: [
          {
            id: "delivery-output",
            kind: "artifact",
            description: "A structured delivery result is produced",
            value: "worker-output",
          },
        ],
      },
    ],
  });
}

export class FoundationCoordinationPlanner implements CoordinationPlanner {
  async plan(request: CoordinationPlanningRequest): Promise<PlannerOutput> {
    return createFoundationPlan(request.userTask);
  }
}
