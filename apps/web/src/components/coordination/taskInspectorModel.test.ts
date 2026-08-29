import { describe, expect, it } from "vitest";
import type {
  CoordinationArtifact,
  CoordinationAttempt,
  CoordinationTask,
} from "../../types";
import { buildTaskInspectorModel } from "./taskInspectorModel";

const timestamp = "2026-08-29T00:00:00.000Z";

function makeTask(id: string, dependencies: string[] = []): CoordinationTask {
  return {
    id,
    sessionId: "session",
    title: `Task ${id}`,
    instructions: `Complete ${id}`,
    dependencies,
    requiredCapabilities: [],
    acceptanceCriteria: [
      {
        id: `${id}-output`,
        kind: "artifact",
        description: "Produce output",
        value: "worker-output",
      },
    ],
    status: "succeeded",
    assignedAgentId: "agent",
    attemptCount: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("buildTaskInspectorModel", () => {
  it("projects selected Task dependencies, Attempts and Artifacts", () => {
    const dependency = makeTask("plan");
    const task = makeTask("deliver", [dependency.id, "missing"]);
    const attempt: CoordinationAttempt = {
      id: "attempt",
      sessionId: "session",
      taskId: task.id,
      agentId: "agent",
      runId: "run",
      status: "succeeded",
      workerOutput: {
        summary: "Delivered the result",
        artifactPaths: ["result.txt"],
        evidence: ["Checks passed"],
        unresolvedIssues: [],
      },
      createdAt: timestamp,
    };
    const artifact: CoordinationArtifact = {
      id: "artifact",
      sessionId: "session",
      taskId: task.id,
      attemptId: attempt.id,
      type: "final_result",
      schemaVersion: 1,
      sourcePath: "result.txt",
      contentHash: "a".repeat(64),
      verificationStatus: "accepted",
      createdAt: timestamp,
    };

    const model = buildTaskInspectorModel(
      task.id,
      [dependency, task],
      [attempt, { ...attempt, id: "other", taskId: dependency.id }],
      [artifact, { ...artifact, id: "other", taskId: dependency.id }],
      new Map([["agent", "Builder"]]),
    );

    expect(model).toMatchObject({
      task: { id: "deliver" },
      assignedAgentName: "Builder",
      dependencies: [
        { id: "plan", task: { id: "plan" } },
        { id: "missing", task: null },
      ],
      attempts: [{ id: "attempt", runId: "run" }],
      artifacts: [{ id: "artifact" }],
    });
    expect(model?.attempts[0]?.workerOutput?.summary).toBe(
      "Delivered the result",
    );
  });

  it("returns null when the selected Task no longer exists", () => {
    expect(
      buildTaskInspectorModel("missing", [], [], [], new Map()),
    ).toBeNull();
  });
});
