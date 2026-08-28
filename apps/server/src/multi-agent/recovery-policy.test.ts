import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RecoveryPolicyRequest } from "./ports.js";
import { validateRecoveryDecision } from "./recovery-policy.js";

const timestamp = "2026-08-29T00:00:00.000Z";

function makeRequest(): RecoveryPolicyRequest {
  const sessionId = randomUUID();
  const taskId = randomUUID();
  const agentId = randomUUID();
  const failedAttempt = {
    id: randomUUID(),
    sessionId,
    taskId,
    agentId,
    status: "failed" as const,
    errorClass: "tool_error" as const,
    errorMessage: "Tool failed",
    createdAt: timestamp,
    completedAt: timestamp,
  };
  return {
    session: {
      id: sessionId,
      userTask: "Recover the Task",
      status: "recovering",
      topology: "sequential",
      participantAgentIds: [agentId],
      rootTraceId: randomUUID(),
      budget: {
        maxTasks: 8,
        maxConcurrentTasks: 2,
        maxAttemptsPerTask: 2,
        maxAgentCalls: 8,
        maxEvents: 500,
      },
      createdAt: timestamp,
    },
    task: {
      id: taskId,
      sessionId,
      title: "Recover work",
      instructions: "Retry safely",
      dependencies: [],
      requiredCapabilities: [],
      acceptanceCriteria: [
        {
          id: "worker-output",
          kind: "artifact",
          description: "Produce structured output",
          value: "worker-output",
        },
      ],
      status: "failed",
      assignedAgentId: agentId,
      attemptCount: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    failedAttempt,
    attempts: [failedAttempt],
    availableAgentIds: [agentId],
  };
}

describe("recovery decision validation", () => {
  it("accepts a bounded retry before the Attempt budget is exhausted", () => {
    expect(
      validateRecoveryDecision(
        { action: "retry", reason: "Retry one transient failure" },
        makeRequest(),
      ),
    ).toMatchObject({ action: "retry" });
  });

  it("rejects reassignment to an unknown Agent", () => {
    expect(() =>
      validateRecoveryDecision(
        {
          action: "reassign",
          reason: "Try a different Agent",
          nextAgentId: randomUUID(),
        },
        makeRequest(),
      ),
    ).toThrow(/unknown Agent/i);
  });
});
