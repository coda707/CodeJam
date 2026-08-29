import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { FailureClass } from "./contracts.js";
import type { RecoveryPolicyRequest } from "./ports.js";
import {
  ClassificationRecoveryPolicy,
  validateRecoveryDecision,
} from "./recovery-policy.js";

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

function makeClassificationRequest(
  errorClass: FailureClass,
  availableAgentIds: string[],
  attemptsCount = 1,
): RecoveryPolicyRequest {
  const base = makeRequest();
  const agentId = availableAgentIds[0] ?? randomUUID();
  base.failedAttempt.errorClass = errorClass;
  base.failedAttempt.agentId = agentId;
  base.session.budget.maxAttemptsPerTask = 2;
  base.session.participantAgentIds = availableAgentIds;
  base.availableAgentIds = availableAgentIds;
  base.attempts = Array.from({ length: attemptsCount }, (_, index) => ({
    ...base.failedAttempt,
    id: index === 0 ? base.failedAttempt.id : randomUUID(),
  }));
  return base;
}

describe("ClassificationRecoveryPolicy", () => {
  const policy = new ClassificationRecoveryPolicy();

  it("retries a transient provider error", async () => {
    await expect(
      policy.decide(makeClassificationRequest("transient_provider_error", ["a"])),
    ).resolves.toMatchObject({ action: "retry" });
  });

  it("reassigns a timeout to a different Agent", async () => {
    await expect(
      policy.decide(makeClassificationRequest("timeout", ["a", "b"])),
    ).resolves.toMatchObject({ action: "reassign", nextAgentId: "b" });
  });

  it("retries a timeout when no alternative Agent exists", async () => {
    await expect(
      policy.decide(makeClassificationRequest("timeout", ["a"])),
    ).resolves.toMatchObject({ action: "retry" });
  });

  it("requests approval for a test failure", async () => {
    await expect(
      policy.decide(makeClassificationRequest("test_failure", ["a"])),
    ).resolves.toMatchObject({ action: "request_approval" });
  });

  it("stops on an unrecoverable failure class", async () => {
    await expect(
      policy.decide(makeClassificationRequest("unsafe_action", ["a"])),
    ).resolves.toMatchObject({ action: "stop" });
  });

  it("stops when the Attempt budget is exhausted", async () => {
    await expect(
      policy.decide(makeClassificationRequest("transient_provider_error", ["a"], 2)),
    ).resolves.toMatchObject({ action: "stop", reason: "Attempt budget exceeded" });
  });
});
