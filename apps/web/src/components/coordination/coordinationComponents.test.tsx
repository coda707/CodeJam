import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CoordinationArtifact,
  CoordinationAttempt,
  CoordinationEvent,
  CoordinationSession,
  CoordinationTask,
} from "../../types";
import { CoordinationEmptyState } from "./CoordinationEmptyState";
import { CopyIdentifier } from "./CopyIdentifier";
import { RefreshStatus } from "./RefreshStatus";
import { RecoveryPanel } from "./RecoveryPanel";
import { SessionRail } from "./SessionRail";
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
  it("exposes complete identifiers through copy actions", () => {
    const value = "attempt-complete-id";
    const markup = renderToStaticMarkup(
      <CopyIdentifier label="Attempt ID" value={value} compact />,
    );

    expect(markup).toContain("attempt-");
    expect(markup).toContain(`aria-label="Copy Attempt ID ${value}"`);
    expect(markup).toContain(`title="${value}"`);
  });

  it("renders an actionable recovery state after a Session load fails", () => {
    const markup = renderToStaticMarkup(
      <CoordinationEmptyState
        hasSelection
        loading={false}
        errorMessage="Connection lost"
        onRetry={() => undefined}
      />,
    );

    expect(markup).toContain("Session unavailable");
    expect(markup).toContain("Connection lost");
    expect(markup).toContain("Retry Session");
  });

  it("keeps stale Session data visible with a refresh recovery action", () => {
    const markup = renderToStaticMarkup(
      <RefreshStatus
        failedAt={timestamp}
        refreshing={false}
        onRetry={() => undefined}
      />,
    );

    expect(markup).toContain("Showing last confirmed Session data");
    expect(markup).toContain("Evidence may be stale");
    expect(markup).toContain("Retry refresh");
  });

  it("renders an evidence-backed approval decision", () => {
    const task = makeTask("review");
    const session: CoordinationSession = {
      id: "session-approval-id",
      userTask: "Review the failed result",
      status: "waiting_approval",
      topology: "review",
      participantAgentIds: ["agent-id"],
      rootTraceId: "trace-id",
      budget: {
        maxTasks: 4,
        maxConcurrentTasks: 2,
        maxAttemptsPerTask: 2,
        maxAgentCalls: 8,
        maxEvents: 100,
      },
      failureReason: "Acceptance criteria failed",
      createdAt: timestamp,
    };
    const attempt: CoordinationAttempt = {
      id: "attempt-failed-id",
      sessionId: session.id,
      taskId: task.id,
      agentId: "agent-id",
      status: "failed",
      errorClass: "test_failure",
      errorMessage: "Verification command failed",
      createdAt: timestamp,
    };
    const decision: CoordinationEvent = {
      id: "event-recovery-id",
      sessionId: session.id,
      taskId: task.id,
      attemptId: attempt.id,
      type: "recovery.decided",
      payload: {
        action: "request_approval",
        reason: "Acceptance criteria failed",
        nextAgentId: null,
      },
      createdAt: timestamp,
    };
    const markup = renderToStaticMarkup(
      <RecoveryPanel
        session={session}
        tasks={[task]}
        attempts={[attempt]}
        events={[decision]}
        agentNames={new Map([["agent-id", "Reviewer"]])}
        busy={false}
        onApprove={async () => undefined}
        onReject={async () => undefined}
      />,
    );

    expect(markup).toContain("Human decision required");
    expect(markup).toContain("attempt-failed-id");
    expect(markup).toContain("test_failure");
    expect(markup).toContain("Approve and Continue");
    expect(markup).toContain("Reject and Stop");
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

  it("renders every real DAG edge without inventing links", () => {
    const tasks = [
      makeTask("root"),
      makeTask("disconnected"),
      makeTask("branch-a", ["root"]),
      makeTask("branch-b", ["root"]),
      makeTask("merge", ["root", "branch-a", "branch-b"]),
    ];
    const markup = renderToStaticMarkup(
      <TaskGraph
        tasks={tasks}
        agentNames={new Map([["agent-id", "Builder"]])}
        usesRealAgents
        selectedTaskId="root"
        onSelectTask={() => undefined}
      />,
    );

    expect(markup.match(/class="dependency-link"/g)).toHaveLength(5);
    expect(markup).toContain('data-edge-from="root" data-edge-to="branch-a"');
    expect(markup).toContain('data-edge-from="root" data-edge-to="branch-b"');
    expect(markup).toContain('data-edge-from="root" data-edge-to="merge"');
    expect(markup).toContain('data-edge-from="branch-a" data-edge-to="merge"');
    expect(markup).toContain('data-edge-from="branch-b" data-edge-to="merge"');
    expect(markup).not.toContain('data-edge-from="disconnected"');
    expect(markup).not.toContain("graph-edge");
  });

  it("exposes the selected coordination Session to assistive technology", () => {
    const session: CoordinationSession = {
      id: "session-selected-id",
      userTask: "Coordinate the delivery",
      status: "planning",
      topology: "sequential",
      participantAgentIds: [],
      rootTraceId: "trace-id",
      budget: {
        maxTasks: 4,
        maxConcurrentTasks: 2,
        maxAttemptsPerTask: 2,
        maxAgentCalls: 8,
        maxEvents: 100,
      },
      createdAt: timestamp,
    };
    const markup = renderToStaticMarkup(
      <SessionRail
        agents={[]}
        sessions={[session]}
        selectedId={session.id}
        participantIds={[]}
        userTask=""
        busy={false}
        loading={false}
        listUnavailable={false}
        usesRealAgents={false}
        onUserTaskChange={() => undefined}
        onToggleParticipant={() => undefined}
        onCreate={() => undefined}
        onSelect={() => undefined}
        onRetrySessions={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Coordination sessions"');
    expect(markup).toContain('aria-current="page"');
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
