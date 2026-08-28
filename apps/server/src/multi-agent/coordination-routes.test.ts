import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentService } from "../agent-service.js";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { JsonStore } from "../store.js";
import { CoordinationService } from "./coordination-service.js";
import { CoordinationStore } from "./coordination-store.js";
import { JsonCoordinationEventSink } from "./event-store.js";
import { FakeCoordinationExecutor } from "./fake-executor.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("coordination HTTP boundary", () => {
  it("creates, starts and exposes foundation execution evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "coordination-routes-test-"));
    temporaryDirectories.push(root);
    const jsonStore = new JsonStore(path.join(root, "database.json"));
    await jsonStore.initialize();
    const store = new CoordinationStore(jsonStore);
    const coordination = new CoordinationService(
      store,
      new FakeCoordinationExecutor(0),
      new JsonCoordinationEventSink(store),
    );
    const agentService = {
      listAgents: () => [],
      systemInfo: async () => ({}),
    } as unknown as AgentService;
    const app = await createApp(
      loadConfig({ NODE_ENV: "test" }),
      agentService,
      coordination,
    );

    const created = await app.inject({
      method: "POST",
      url: "/api/coordination/sessions",
      payload: { userTask: "Exercise the coordination foundation" },
    });
    expect(created.statusCode).toBe(201);
    const sessionId = created.json().session.id as string;
    const started = await app.inject({
      method: "POST",
      url: `/api/coordination/sessions/${sessionId}/start`,
    });
    expect(started.statusCode).toBe(202);
    await coordination.waitForIdle(sessionId);

    const [session, tasks, events] = await Promise.all([
      app.inject({ method: "GET", url: `/api/coordination/sessions/${sessionId}` }),
      app.inject({
        method: "GET",
        url: `/api/coordination/sessions/${sessionId}/tasks`,
      }),
      app.inject({
        method: "GET",
        url: `/api/coordination/sessions/${sessionId}/events`,
      }),
    ]);
    expect(session.json().session.status).toBe("completed");
    expect(tasks.json().tasks).toHaveLength(2);
    expect(events.json().events.at(-1).type).toBe("session.completed");
    await app.close();
  });
});
