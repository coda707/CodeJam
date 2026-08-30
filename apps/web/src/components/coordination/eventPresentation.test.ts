import { describe, expect, it } from "vitest";
import type { CoordinationEvent, CoordinationTask } from "../../types";
import { presentCoordinationEvent } from "./eventPresentation";

const task: CoordinationTask = {
  id: "task-complete-id",
  sessionId: "session-id",
  title: "Verify the result",
  instructions: "Verify output",
  dependencies: [],
  requiredCapabilities: ["verification"],
  acceptanceCriteria: [
    {
      id: "criterion-id",
      kind: "artifact",
      description: "Produce evidence",
      value: "worker-output",
    },
  ],
  status: "failed",
  assignedAgentId: "agent-complete-id",
  attemptCount: 1,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
};

const makeEvent = (
  type: string,
  payload: Record<string, unknown>,
): CoordinationEvent => ({
  id: `event-${type}`,
  sessionId: "session-id",
  taskId: task.id,
  attemptId: "attempt-id",
  agentId: task.assignedAgentId,
  type,
  payload,
  createdAt: "2026-08-30T00:00:00.000Z",
});

describe("event presentation", () => {
  it("explains recovery decisions with the selected target", () => {
    const result = presentCoordinationEvent(
      makeEvent("recovery.decided", {
        action: "reassign",
        reason: "The current Agent lacks the required capability",
        nextAgentId: "replacement-agent-id",
      }),
      [task],
      new Map([["replacement-agent-id", "Recovery Agent"]]),
    );

    expect(result.title).toBe("Recovery decision recorded");
    expect(result.description).toContain("reassign with Recovery Agent");
    expect(result.description).toContain("lacks the required capability");
  });

  it("renders verification evidence as readable text", () => {
    const result = presentCoordinationEvent(
      makeEvent("verification.passed", {
        evidence: ["WorkerOutput schema accepted", "npm test passed"],
      }),
      [task],
      new Map(),
    );

    expect(result.description).toBe(
      "Accepted Verify the result: WorkerOutput schema accepted · npm test passed",
    );
    expect(result.description).not.toContain("{");
  });

  it("explains a repair Task and links the superseded original", () => {
    const repairTask: CoordinationTask = {
      ...task,
      id: "task-repair-id",
      title: "Verify the result (repair)",
    };
    const result = presentCoordinationEvent(
      makeEvent("task.repair_created", {
        reason: "Acceptance command failed",
        originalTaskId: task.id,
        repairTaskId: repairTask.id,
      }),
      [task, repairTask],
      new Map(),
    );

    expect(result.title).toBe("Repair task created");
    expect(result.description).toContain("Verify the result (repair)");
    expect(result.description).toContain("Superseded");
  });
});
