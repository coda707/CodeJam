import { randomUUID } from "node:crypto";
import type {
  CoordinationArtifact,
  CoordinationSession,
  TaskAttempt,
  TaskNode,
  WorkerOutput,
} from "../contracts.js";
import type {
  TaskExecutionRequest,
  VerificationRequest,
} from "../ports.js";

export const COORDINATION_TEST_TIMESTAMP = "2026-08-29T00:00:00.000Z";

export function makeCoordinationSession(
  overrides: Partial<CoordinationSession> = {},
): CoordinationSession {
  return {
    id: randomUUID(),
    userTask: "Build and verify a small feature",
    status: "executing",
    topology: "sequential",
    participantAgentIds: [],
    rootTraceId: randomUUID(),
    budget: {
      maxTasks: 8,
      maxConcurrentTasks: 2,
      maxAttemptsPerTask: 2,
      maxAgentCalls: 8,
      maxEvents: 500,
    },
    createdAt: COORDINATION_TEST_TIMESTAMP,
    ...overrides,
  };
}

export function makeTaskNode(
  session: CoordinationSession,
  overrides: Partial<TaskNode> = {},
): TaskNode {
  return {
    id: randomUUID(),
    sessionId: session.id,
    title: "Implement the feature",
    instructions: "Create the requested files and report evidence.",
    dependencies: [],
    requiredCapabilities: ["delivery"],
    acceptanceCriteria: [
      {
        id: "worker-output",
        kind: "artifact",
        description: "Return structured output",
        value: "worker-output",
      },
    ],
    status: "running",
    attemptCount: 1,
    createdAt: COORDINATION_TEST_TIMESTAMP,
    updatedAt: COORDINATION_TEST_TIMESTAMP,
    ...overrides,
  };
}

export function makeTaskAttempt(
  session: CoordinationSession,
  task: TaskNode,
  overrides: Partial<TaskAttempt> = {},
): TaskAttempt {
  return {
    id: randomUUID(),
    sessionId: session.id,
    taskId: task.id,
    status: "running",
    createdAt: COORDINATION_TEST_TIMESTAMP,
    startedAt: COORDINATION_TEST_TIMESTAMP,
    ...overrides,
  };
}

export function makeWorkerOutput(
  overrides: Partial<WorkerOutput> = {},
): WorkerOutput {
  return {
    summary: "Implemented and checked the feature",
    artifactPaths: [],
    evidence: ["Execution completed"],
    unresolvedIssues: [],
    ...overrides,
  };
}

export function makeCoordinationArtifact(
  session: CoordinationSession,
  task: TaskNode,
  attempt: TaskAttempt,
  overrides: Partial<CoordinationArtifact> = {},
): CoordinationArtifact {
  return {
    id: randomUUID(),
    sessionId: session.id,
    taskId: task.id,
    attemptId: attempt.id,
    type: "report",
    schemaVersion: 1,
    sourcePath: "reports/result.txt",
    path: `${session.id}/${attempt.id}/result.txt`,
    contentHash: "a".repeat(64),
    verificationStatus: "accepted",
    createdAt: COORDINATION_TEST_TIMESTAMP,
    ...overrides,
  };
}

export function makeTaskExecutionRequest(
  agentId: string | null = randomUUID(),
): TaskExecutionRequest {
  const session = makeCoordinationSession({
    participantAgentIds: agentId ? [agentId] : [],
  });
  const task = makeTaskNode(session, {
    ...(agentId ? { assignedAgentId: agentId } : {}),
  });
  const attempt = makeTaskAttempt(session, task, {
    ...(agentId ? { agentId } : {}),
  });
  return { session, task, attempt, dependencyContext: [] };
}

export function makeVerificationRequest(): VerificationRequest {
  const agentId = randomUUID();
  const session = makeCoordinationSession({
    userTask: "Verify a report",
    status: "verifying",
    participantAgentIds: [agentId],
  });
  const task = makeTaskNode(session, {
    title: "Create report",
    instructions: "Create reports/result.txt",
    requiredCapabilities: ["reporting"],
    acceptanceCriteria: [
      {
        id: "report-exists",
        kind: "file_exists",
        description: "The report is captured",
        value: "reports/result.txt",
      },
    ],
    status: "verifying",
    assignedAgentId: agentId,
  });
  const attempt = makeTaskAttempt(session, task, { agentId });
  return {
    session,
    task,
    attempt,
    artifacts: [
      makeCoordinationArtifact(session, task, attempt, {
        producerAgentId: agentId,
        verificationStatus: "unverified",
      }),
    ],
    output: makeWorkerOutput({
      summary: "Created report",
      artifactPaths: ["reports/result.txt"],
      evidence: ["File was written"],
    }),
  };
}
