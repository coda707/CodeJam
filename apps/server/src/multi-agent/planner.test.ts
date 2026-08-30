import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Workflow } from "./contracts.js";
import { compileWorkflowPlan, validatePlannerOutput } from "./planner.js";

const task = (key: string, dependencies: string[]) => ({
  key,
  title: `Task ${key}`,
  instructions: `Complete task ${key}`,
  dependencies,
  requiredCapabilities: [],
  acceptanceCriteria: [
    {
      id: `${key}-output`,
      kind: "artifact" as const,
      description: `Task ${key} produces output`,
      value: "worker-output",
    },
  ],
});

function workflowTask(key: string, overrides: Partial<Workflow["tasks"][number]> = {}) {
  return {
    key,
    title: `Count ${key}`,
    instructions: `Report ${key}`,
    dependencies: [],
    requiredCapabilities: [],
    acceptanceCriteria: [
      {
        id: `${key}-output`,
        kind: "artifact" as const,
        description: `Task ${key} produces output`,
        value: "worker-output",
      },
    ],
    ...overrides,
  };
}

describe("planner validation", () => {
  it("rejects cycles before any task can execute", () => {
    expect(() =>
      validatePlannerOutput({
        topology: "dag",
        explanation: "Invalid cyclic graph",
        tasks: [task("first", ["second"]), task("second", ["first"])],
      }),
    ).toThrow(/cycle/i);
  });

  it("rejects missing dependency references", () => {
    expect(() =>
      validatePlannerOutput({
        topology: "dag",
        explanation: "Invalid missing dependency",
        tasks: [task("deliver", ["missing"])],
      }),
    ).toThrow(/missing dependency/i);
  });

  it("rejects a task fixed to an unknown Agent", () => {
    const participant = randomUUID();
    expect(() =>
      validatePlannerOutput(
        {
          topology: "sequential",
          explanation: "Fixed assignment",
          tasks: [{ ...task("deliver", []), assignedAgentId: randomUUID() }],
        },
        [participant],
      ),
    ).toThrow(/unknown Agent/i);
  });
});

describe("compileWorkflowPlan", () => {
  const [agentA, agentB] = [randomUUID(), randomUUID()];

  it("compiles an ordered workflow into an implicit dependency chain", () => {
    const plan = compileWorkflowPlan(
      { tasks: [workflowTask("count-1"), workflowTask("count-2"), workflowTask("count-3")] },
      "Count one through three",
      [agentA, agentB],
    );

    expect(plan.tasks.map((t) => t.key)).toEqual(["count-1", "count-2", "count-3"]);
    expect(plan.tasks[0]?.dependencies).toEqual([]);
    expect(plan.tasks[1]?.dependencies).toEqual(["count-1"]);
    expect(plan.tasks[2]?.dependencies).toEqual(["count-2"]);
    expect(plan.topology).toBe("sequential");
  });

  it("preserves an explicit assignedAgentId", () => {
    const plan = compileWorkflowPlan(
      {
        tasks: [
          workflowTask("first", { assignedAgentId: agentB }),
          workflowTask("second"),
        ],
      },
      "Fixed first task",
      [agentA, agentB],
    );

    expect(plan.tasks[0]?.assignedAgentId).toBe(agentB);
  });

  it("round-robins turn-taking Agents over otherwise unassigned tasks", () => {
    const plan = compileWorkflowPlan(
      {
        tasks: [
          workflowTask("one"),
          workflowTask("two"),
          workflowTask("three"),
          workflowTask("four"),
        ],
        turnTaking: { agentIds: [agentA, agentB], pattern: "round_robin" },
      },
      "Alternate between two Agents",
      [agentA, agentB],
    );

    expect(plan.tasks.map((t) => t.assignedAgentId)).toEqual([
      agentA,
      agentB,
      agentA,
      agentB,
    ]);
  });

  it("rejects turn-taking Agents outside the participant set", () => {
    expect(() =>
      compileWorkflowPlan(
        {
          tasks: [workflowTask("one"), workflowTask("two")],
          turnTaking: { agentIds: [agentA, randomUUID()], pattern: "round_robin" },
        },
        "Invalid turn-taking",
        [agentA, agentB],
      ),
    ).toThrow(/participant/i);
  });

  it("rejects an explicit fixed Agent outside the participant set", () => {
    expect(() =>
      compileWorkflowPlan(
        { tasks: [workflowTask("one", { assignedAgentId: randomUUID() })] },
        "Invalid fixed Agent",
        [agentA, agentB],
      ),
    ).toThrow(/unknown Agent/i);
  });
});
