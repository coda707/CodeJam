import { HttpError } from "../errors.js";
import {
  plannerOutputSchema,
  type PlannerOutput,
  type Workflow,
} from "./contracts.js";
import { HeuristicCollaborationGate } from "./collaboration-gate.js";
import type {
  CoordinationPlanner,
  CoordinationPlanningRequest,
} from "./ports.js";

export function validatePlannerOutput(
  value: unknown,
  participantAgentIds?: string[],
): PlannerOutput {
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

  if (participantAgentIds) {
    const participants = new Set(participantAgentIds);
    for (const task of plan.tasks) {
      if (task.assignedAgentId && !participants.has(task.assignedAgentId)) {
        throw new HttpError(
          400,
          `Task ${task.key} is fixed to unknown Agent ${task.assignedAgentId}`,
        );
      }
    }
  }

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

/**
 * Compiles an explicit user-supplied workflow (structured ordering, fixed Agent
 * assignments and turn-taking) into a validated DAG. The scheduler stays
 * generic: this function only produces a {@link PlannerOutput}; it never
 * mutates state. Explicit constraints are preserved, never silently relaxed.
 */
export function compileWorkflowPlan(
  workflow: Workflow,
  userTask: string,
  participantAgentIds: string[],
): PlannerOutput {
  const participantSet = new Set(participantAgentIds);
  const turnAgentIds = workflow.turnTaking?.agentIds ?? [];
  for (const id of turnAgentIds) {
    if (!participantSet.has(id)) {
      throw new HttpError(400, "turnTaking.agentIds must all be participants");
    }
  }

  const tasks = workflow.tasks.map((task, index) => {
    const dependencies =
      task.dependencies.length > 0
        ? task.dependencies
        : index === 0
          ? []
          : [workflow.tasks[index - 1]!.key];
    const assignedAgentId =
      task.assignedAgentId ??
      (turnAgentIds.length > 0
        ? turnAgentIds[index % turnAgentIds.length]
        : undefined);
    return {
      key: task.key,
      title: task.title,
      instructions: task.instructions,
      dependencies,
      requiredCapabilities: task.requiredCapabilities,
      acceptanceCriteria: task.acceptanceCriteria,
      ...(assignedAgentId ? { assignedAgentId } : {}),
    };
  });

  return validatePlannerOutput(
    {
      topology: tasks.every((task) => task.dependencies.length <= 1)
        ? "sequential"
        : "dag",
      explanation: "User-constrained workflow compiled into a DAG.",
      tasks,
    },
    participantAgentIds,
  );
}

function heuristicTask(
  key: string,
  title: string,
  instructions: string,
  dependencies: string[],
  requiredCapabilities: string[],
) {
  return {
    key,
    title,
    instructions,
    dependencies,
    requiredCapabilities,
    acceptanceCriteria: [
      {
        id: `${key}-output`,
        kind: "artifact" as const,
        description: "Structured WorkerOutput is produced",
        value: "worker-output",
      },
    ],
  };
}

/**
 * LLM-free planner driven by the {@link HeuristicCollaborationGate}. It turns
 * the gate's topology decision into a concrete DAG whose acceptance criteria
 * are all `artifact`/`worker-output`, so the deterministic Fake Executor path
 * still verifies cleanly. `file_exists`/`command` criteria belong to the real
 * Agent demo path and are intentionally not emitted here.
 */
export class HeuristicCoordinationPlanner implements CoordinationPlanner {
  private readonly gate = new HeuristicCollaborationGate();

  async plan(request: CoordinationPlanningRequest): Promise<PlannerOutput> {
    if (request.workflow) {
      return compileWorkflowPlan(
        request.workflow,
        request.userTask,
        request.participantAgentIds,
      );
    }
    const taskContext =
      request.userTask.length > 9_000
        ? request.userTask.slice(0, 8_997) + "..."
        : request.userTask;
    const decision = this.gate.decide(
      request.userTask,
      request.participantAgentIds.length,
    );

    switch (decision.topology) {
      case "single":
        return validatePlannerOutput({
          topology: "single",
          explanation: decision.explanation,
          tasks: [
            heuristicTask(
              "deliver",
              "Deliver the requested result",
              `Produce a verified result for: ${taskContext}`,
              [],
              ["delivery"],
            ),
          ],
        });
      case "parallel":
        return validatePlannerOutput({
          topology: "parallel",
          explanation: decision.explanation,
          tasks: [
            heuristicTask(
              "analyze",
              "Analyze requirements",
              `Analyze the request and list the independent work items: ${taskContext}`,
              [],
              ["analysis"],
            ),
            heuristicTask(
              "implement",
              "Implement the core changes",
              `Implement the core changes for: ${taskContext}`,
              [],
              ["delivery"],
            ),
            heuristicTask(
              "document",
              "Document the result",
              `Document the completed work and its evidence: ${taskContext}`,
              [],
              ["reporting"],
            ),
          ],
        });
      case "dag":
        return validatePlannerOutput({
          topology: "dag",
          explanation: decision.explanation,
          tasks: [
            heuristicTask(
              "plan",
              "Plan the requested work",
              `Produce a bounded implementation plan for: ${taskContext}`,
              [],
              ["planning"],
            ),
            heuristicTask(
              "implement",
              "Implement the planned changes",
              `Implement the plan for: ${taskContext}`,
              ["plan"],
              ["delivery"],
            ),
            heuristicTask(
              "review",
              "Review the implementation",
              `Review the implementation and produce a verification report for: ${taskContext}`,
              ["plan"],
              ["review"],
            ),
            heuristicTask(
              "verify",
              "Verify and finalize",
              `Verify the implementation and the review converge, then finalize: ${taskContext}`,
              ["implement", "review"],
              ["verification"],
            ),
          ],
        });
      default:
        return validatePlannerOutput({
          topology: "sequential",
          explanation: decision.explanation,
          tasks: [
            heuristicTask(
              "plan",
              "Plan the requested work",
              `Produce a bounded implementation plan for: ${taskContext}`,
              [],
              ["planning"],
            ),
            heuristicTask(
              "deliver",
              "Deliver the requested result",
              `Use the verified plan to deliver: ${taskContext}`,
              ["plan"],
              ["delivery"],
            ),
            heuristicTask(
              "verify",
              "Verify the delivered result",
              `Verify the delivered result for: ${taskContext}`,
              ["deliver"],
              ["verification"],
            ),
          ],
        });
    }
  }
}
