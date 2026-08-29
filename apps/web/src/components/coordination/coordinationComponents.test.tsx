import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CoordinationArtifact,
  CoordinationAttempt,
  CoordinationTask,
} from "../../types";
import { CoordinationEmptyState } from "./CoordinationEmptyState";
import { TaskGraph } from "./TaskGraph";
import { TaskInspector } from "./TaskInspector";

const timestamp = "2026-08-29T00:00:00.000Z";

function makeTask(id: string, dependencies: string[] = []): CoordinationTask {
  return {
    id,
    sessionId: "session",
    title: `Task ${id}`,
    instructions: `Complete ${id}`,
    dependencies,
    requiredCapabilities: ["delivery"],
    acceptanceCriteria: [
      {
        id: `${id}-output`,
        kind: "artifact",
        description: "Produce output",
        value: "worker-output",
      },
    ],
    status: "succeeded",
    assignedAgentId: "agent-id",
    attemptCount: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("coordination components", () => {
  it("renders an actionable recovery state after a Session load fails", () => {
    const markup = renderToStaticMarkup(
      <CoordinationEmptyState
        hasSelection
        loading={false}
        onRetry={() => undefined}
      />,
    );

    expect(markup).toContain("Session unavailable");
    expect(markup).toContain("Retry Session");
  });

  it("renders selectable graph nodes with readable dependency text", () => {
    const tasks = [makeTask("plan"), makeTask("deliver", ["plan"])];
    const markup = renderToStaticMarkup(
      <TaskGraph
        tasks={tasks}
        agentNames={new Map([["agent-id", "Builder"]])}
        usesRealAgents
        selectedTaskId="deliver"
        onSelectTask={() => undefined}
      />,
    );

    expect(markup).toContain('aria-controls="task-inspector"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("After: Task plan");
    expect(markup).toContain("2 nodes / 1 edges");
  });

  it("renders complete evidence identifiers and verified WorkerOutput", () => {
    const task = makeTask("deliver");
    const attempt: CoordinationAttempt = {
      id: "attempt-complete-id",
      sessionId: "session",
      taskId: task.id,
      agentId: "agent-id",
      runId: "run-complete-id",
      status: "succeeded",
      workerOutput: {
        summary: "Delivered the verified result",
        artifactPaths: ["result.txt"],
        evidence: ["All checks passed"],
        unresolvedIssues: [],
      },
      createdAt: timestamp,
    };
    const artifact: CoordinationArtifact = {
      id: "artifact-complete-id",
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
    const markup = renderToStaticMarkup(
      <TaskInspector
        taskId={task.id}
        tasks={[task]}
        attempts={[attempt]}
        artifacts={[artifact]}
        agentNames={new Map([["agent-id", "Builder"]])}
        onSelectTask={() => undefined}
      />,
    );

    expect(markup).toContain("attempt-complete-id");
    expect(markup).toContain("run-complete-id");
    expect(markup).toContain("artifact-complete-id");
    expect(markup).toContain("Delivered the verified result");
    expect(markup).toContain("All checks passed");
  });
});
