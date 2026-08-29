import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonStore } from "../store.js";
import { CoordinationService } from "./coordination-service.js";
import type { CoordinationServiceOptions } from "./coordination-service.js";
import { CoordinationStore } from "./coordination-store.js";
import { JsonCoordinationEventSink } from "./event-store.js";
import { FakeCoordinationExecutor } from "./fake-executor.js";
import { HeuristicCoordinationPlanner } from "./planner.js";
import { ClassificationRecoveryPolicy } from "./recovery-policy.js";
import type {
  CoordinationExecutor,
  TaskExecutionRequest,
  TaskExecutionResult,
} from "./ports.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function makeService(
  executor: CoordinationExecutor = new FakeCoordinationExecutor(0),
  options: CoordinationServiceOptions = {},
): Promise<CoordinationService> {
  const root = await mkdtemp(path.join(tmpdir(), "coordination-test-"));
  temporaryDirectories.push(root);
  const jsonStore = new JsonStore(path.join(root, "database.json"));
  await jsonStore.initialize();
  const store = new CoordinationStore(jsonStore);
  return new CoordinationService(
    store,
    executor,
    new JsonCoordinationEventSink(store),
    options,
  );
}

describe("foundation coordination flow", () => {
  it("executes the fixed two-node DAG in dependency order", async () => {
    const service = await makeService();
    const { session, tasks } = await service.createSession({
      userTask: "Build a small verified feature",
      participantAgentIds: [],
    });

    expect(tasks).toHaveLength(2);
    expect(tasks[1]?.dependencies).toEqual([tasks[0]?.id]);
    await service.startSession(session.id);
    await service.waitForIdle(session.id);

    expect(service.getSession(session.id).status).toBe("completed");
    expect(service.getTasks(session.id).map((task) => task.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(service.getAttempts(session.id)).toHaveLength(2);
    const events = service.getEvents(session.id);
    expect(events.filter((event) => event.type === "task.succeeded")).toHaveLength(2);
    expect(events.filter((event) => event.type === "verification.passed")).toHaveLength(2);
    expect(events.at(-1)?.type).toBe("session.completed");
    const firstSucceeded = events.findIndex(
      (event) => event.type === "task.succeeded" && event.taskId === tasks[0]?.id,
    );
    const secondStarted = events.findIndex(
      (event) => event.type === "task.started" && event.taskId === tasks[1]?.id,
    );
    expect(firstSucceeded).toBeLessThan(secondStarted);
  });

  it("starts a Session idempotently under concurrent requests", async () => {
    const service = await makeService();
    const { session } = await service.createSession({
      userTask: "Start exactly once",
      participantAgentIds: [],
    });

    await Promise.all([service.startSession(session.id), service.startSession(session.id)]);
    await service.waitForIdle(session.id);

    expect(
      service.getEvents(session.id).filter((event) => event.type === "session.started"),
    ).toHaveLength(1);
    expect(service.getAttempts(session.id)).toHaveLength(2);
  });

  it("records a failed Attempt and blocks dependent work", async () => {
    const service = await makeService({
      execute: async () => ({
        status: "failed",
        failureClass: "test_failure",
        error: "Acceptance command exited with code 1",
      }),
      cancel: async () => false,
    });
    const { session } = await service.createSession({
      userTask: "Exercise the failure path",
      participantAgentIds: [],
    });

    await service.startSession(session.id);
    await service.waitForIdle(session.id);

    expect(service.getSession(session.id)).toMatchObject({
      status: "failed",
      failureReason: "A foundation task failed",
    });
    expect(service.getTasks(session.id).map((task) => task.status)).toEqual([
      "failed",
      "blocked",
    ]);
    expect(service.getAttempts(session.id)[0]).toMatchObject({
      status: "failed",
      errorClass: "test_failure",
    });
    expect(service.getEvents(session.id).at(-1)?.type).toBe("session.failed");
  });

  it("does not unlock dependent work when mechanical verification rejects", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "coordination-verifier-test-"));
    temporaryDirectories.push(root);
    const jsonStore = new JsonStore(path.join(root, "database.json"));
    await jsonStore.initialize();
    const store = new CoordinationStore(jsonStore);
    const service = new CoordinationService(
      store,
      new FakeCoordinationExecutor(0),
      new JsonCoordinationEventSink(store),
      {
        verifier: {
          verify: async () => ({
            status: "rejected",
            failureClass: "test_failure",
            evidence: ["Expected report was missing"],
          }),
        },
      },
    );
    const { session } = await service.createSession({
      userTask: "Reject an unverified result",
      participantAgentIds: [],
    });

    await service.startSession(session.id);
    await service.waitForIdle(session.id);

    expect(service.getSession(session.id).status).toBe("failed");
    expect(service.getTasks(session.id).map((task) => task.status)).toEqual([
      "failed",
      "blocked",
    ]);
    expect(service.getAttempts(session.id)[0]).toMatchObject({
      status: "failed",
      errorClass: "test_failure",
    });
    expect(
      service.getEvents(session.id).some((event) => event.type === "verification.failed"),
    ).toBe(true);
  });

  it("persists Agent Run correlation on Attempts and terminal events", async () => {
    const agentId = randomUUID();
    const runId = randomUUID();
    const service = await makeService({
      execute: async () => ({
        status: "succeeded",
        runId,
        output: {
          summary: "real worker result",
          artifactPaths: [],
          evidence: ["run completed"],
          unresolvedIssues: [],
        },
      }),
      cancel: async () => false,
    });
    const { session } = await service.createSession({
      userTask: "Correlate the real Agent Run",
      participantAgentIds: [agentId],
    });

    await service.startSession(session.id);
    await service.waitForIdle(session.id);

    expect(service.getAttempts(session.id)).toHaveLength(2);
    expect(service.getAttempts(session.id).every((attempt) => attempt.runId === runId)).toBe(
      true,
    );
    const succeeded = service
      .getEvents(session.id)
      .filter((event) => event.type === "attempt.succeeded");
    expect(succeeded).toHaveLength(2);
    expect(succeeded.every((event) => event.agentId === agentId && event.runId === runId)).toBe(
      true,
    );
  });

  it("passes verified dependency output to downstream execution", async () => {
    const requests: TaskExecutionRequest[] = [];
    const service = await makeService({
      execute: async (request) => {
        requests.push(request);
        return {
          status: "succeeded",
          output: {
            summary: `Completed ${request.task.title}`,
            artifactPaths: [],
            evidence: ["Execution completed"],
            unresolvedIssues: [],
          },
        };
      },
      cancel: async () => false,
    });
    const { session } = await service.createSession({
      userTask: "Pass verified work between Tasks",
      participantAgentIds: [],
    });

    await service.startSession(session.id);
    await service.waitForIdle(session.id);

    expect(requests).toHaveLength(2);
    expect(requests[0]?.dependencyContext).toEqual([]);
    expect(requests[1]?.dependencyContext).toHaveLength(1);
    expect(requests[1]?.dependencyContext[0]?.attempt.workerOutput).toMatchObject({
      summary: "Completed Plan the requested work",
    });
    expect(requests[1]?.dependencyContext[0]?.artifacts).toEqual([]);
  });

  it("applies a bounded retry decision from the RecoveryPolicy", async () => {
    let calls = 0;
    const root = await mkdtemp(path.join(tmpdir(), "coordination-recovery-test-"));
    temporaryDirectories.push(root);
    const jsonStore = new JsonStore(path.join(root, "database.json"));
    await jsonStore.initialize();
    const store = new CoordinationStore(jsonStore);
    const service = new CoordinationService(
      store,
      {
        execute: async () => {
          calls += 1;
          if (calls === 1) {
            return {
              status: "failed",
              failureClass: "transient_provider_error",
              error: "Temporary provider error",
            };
          }
          return {
            status: "succeeded",
            output: {
              summary: "Recovered execution",
              artifactPaths: [],
              evidence: ["Execution completed"],
              unresolvedIssues: [],
            },
          };
        },
        cancel: async () => false,
      },
      new JsonCoordinationEventSink(store),
      {
        recoveryPolicy: {
          decide: async () => ({
            action: "retry",
            reason: "Retry one transient failure",
          }),
        },
      },
    );
    const { session } = await service.createSession({
      userTask: "Recover one transient failure",
      participantAgentIds: [],
    });

    await service.startSession(session.id);
    await service.waitForIdle(session.id);

    expect(service.getSession(session.id).status).toBe("completed");
    const attempts = service.getAttempts(session.id);
    expect(attempts).toHaveLength(3);
    expect(attempts[1]?.retryOfAttemptId).toBe(attempts[0]?.id);
    expect(service.getEvents(session.id).some((event) => event.type === "task.retried")).toBe(
      true,
    );
  });

  it("cancels active foundation work and leaves a terminal Session", async () => {
    let started!: () => void;
    const executionStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const executor: CoordinationExecutor = {
      execute: async (
        _request: TaskExecutionRequest,
        signal?: AbortSignal,
      ): Promise<TaskExecutionResult> => {
        started();
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return {
          status: "failed",
          failureClass: "tool_error",
          error: "cancelled",
        };
      },
      cancel: async () => true,
    };
    const service = await makeService(executor);
    const { session } = await service.createSession({
      userTask: "Run long enough to stop",
      participantAgentIds: [],
    });
    await service.startSession(session.id);
    await executionStarted;

    const stopped = await service.stopSession(session.id);
    await service.waitForIdle(session.id);

    expect(stopped.status).toBe("cancelled");
    expect(service.getSession(session.id).status).toBe("cancelled");
    expect(service.getAttempts(session.id)[0]?.status).toBe("cancelled");
    expect(service.getEvents(session.id).at(-1)?.type).toBe("session.cancelled");
  });

  it("reconciles persisted active work after a server restart", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "coordination-restart-test-"));
    temporaryDirectories.push(root);
    const jsonStore = new JsonStore(path.join(root, "database.json"));
    await jsonStore.initialize();
    const store = new CoordinationStore(jsonStore);
    const service = new CoordinationService(
      store,
      new FakeCoordinationExecutor(0),
      new JsonCoordinationEventSink(store),
    );
    const { session } = await service.createSession({
      userTask: "Recover this interrupted Session",
      participantAgentIds: [],
    });
    await store.startSession(session.id, new Date().toISOString());

    await service.initialize();

    expect(service.getSession(session.id)).toMatchObject({
      status: "cancelled",
      failureReason: "Server restarted while this Session was active",
    });
    expect(service.getTasks(session.id).every((task) => task.status === "blocked")).toBe(
      true,
    );
    expect(service.getEvents(session.id).at(-1)?.type).toBe("session.cancelled");
  });
});

describe("parallel scheduling", () => {
  it("executes independent tasks concurrently up to the budget", async () => {
    let active = 0;
    let maxActive = 0;
    const executor: CoordinationExecutor = {
      execute: async (request) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active -= 1;
        return {
          status: "succeeded",
          output: {
            summary: `Completed ${request.task.title}`,
            artifactPaths: [],
            evidence: ["Execution completed"],
            unresolvedIssues: [],
          },
        };
      },
      cancel: async () => false,
    };
    const service = await makeService(executor, {
      planner: new HeuristicCoordinationPlanner(),
    });
    const { session, tasks } = await service.createSession({
      userTask: "Build several independent modules",
      participantAgentIds: [],
    });

    expect(tasks).toHaveLength(3);
    expect(tasks.every((task) => task.dependencies.length === 0)).toBe(true);

    await service.startSession(session.id);
    await service.waitForIdle(session.id);

    expect(service.getSession(session.id).status).toBe("completed");
    expect(maxActive).toBeGreaterThan(1);
  });
});

describe("approval flow", () => {
  it("pauses for approval on a test failure, then resumes when approved", async () => {
    let calls = 0;
    const executor: CoordinationExecutor = {
      execute: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            status: "failed",
            failureClass: "test_failure",
            error: "Acceptance command failed",
          };
        }
        return {
          status: "succeeded",
          output: {
            summary: "Fixed after approval",
            artifactPaths: [],
            evidence: ["Execution completed"],
            unresolvedIssues: [],
          },
        };
      },
      cancel: async () => false,
    };
    const service = await makeService(executor, {
      recoveryPolicy: new ClassificationRecoveryPolicy(),
    });
    const { session } = await service.createSession({
      userTask: "Exercise the approval path",
      participantAgentIds: [],
    });

    await service.startSession(session.id);
    await service.waitForIdle(session.id);
    expect(service.getSession(session.id).status).toBe("waiting_approval");

    await service.approveSession(session.id, "Looks correct");
    await service.waitForIdle(session.id);

    expect(service.getSession(session.id).status).toBe("completed");
    expect(
      service.getEvents(session.id).some((event) => event.type === "session.approved"),
    ).toBe(true);
  });

  it("fails the Session when the approval is rejected", async () => {
    const executor: CoordinationExecutor = {
      execute: async () => ({
        status: "failed",
        failureClass: "test_failure",
        error: "Still failing",
      }),
      cancel: async () => false,
    };
    const service = await makeService(executor, {
      recoveryPolicy: new ClassificationRecoveryPolicy(),
    });
    const { session } = await service.createSession({
      userTask: "Reject this Session",
      participantAgentIds: [],
    });

    await service.startSession(session.id);
    await service.waitForIdle(session.id);
    expect(service.getSession(session.id).status).toBe("waiting_approval");

    await service.rejectSession(session.id, "Not acceptable");

    expect(service.getSession(session.id)).toMatchObject({ status: "failed" });
    expect(
      service.getEvents(session.id).some((event) => event.type === "session.rejected"),
    ).toBe(true);
  });
});

describe("multi-attempt cancellation", () => {
  it("cancels every active attempt when a parallel Session is stopped", async () => {
    let started = 0;
    let resolveTwoStarted!: () => void;
    const twoStarted = new Promise<void>((resolve) => {
      resolveTwoStarted = resolve;
    });
    const cancelledAttemptIds: string[] = [];
    const executor: CoordinationExecutor = {
      execute: async (_request, signal) => {
        started += 1;
        if (started === 2) resolveTwoStarted();
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return {
          status: "failed",
          failureClass: "tool_error",
          error: "cancelled",
        };
      },
      cancel: async (attemptId) => {
        cancelledAttemptIds.push(attemptId);
        return true;
      },
    };
    const service = await makeService(executor, {
      planner: new HeuristicCoordinationPlanner(),
    });
    const { session } = await service.createSession({
      userTask: "Build several independent modules",
      participantAgentIds: [],
    });

    await service.startSession(session.id);
    await twoStarted;
    await service.stopSession(session.id);
    await service.waitForIdle(session.id);

    expect(service.getSession(session.id).status).toBe("cancelled");
    expect(cancelledAttemptIds).toHaveLength(2);
    expect(service.getAttempts(session.id).every((attempt) => attempt.status === "cancelled")).toBe(
      true,
    );
  });
});
