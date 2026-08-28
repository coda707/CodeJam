import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonStore } from "../store.js";
import { CoordinationService } from "./coordination-service.js";
import { CoordinationStore } from "./coordination-store.js";
import { JsonCoordinationEventSink } from "./event-store.js";
import { FakeCoordinationExecutor } from "./fake-executor.js";
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
