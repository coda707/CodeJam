import { describe, expect, it } from "vitest";
import type { CoordinationTask } from "../../types";
import {
  buildTaskGraphModel,
  reconcileSelectedTaskId,
} from "./graphModel";

const timestamp = "2026-08-29T00:00:00.000Z";

function makeTask(
  id: string,
  dependencies: string[] = [],
  status: CoordinationTask["status"] = "pending",
): CoordinationTask {
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
    status,
    attemptCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const layerIds = (tasks: CoordinationTask[]) =>
  buildTaskGraphModel(tasks).layers.map((layer) =>
    layer.tasks.map((task) => task.id),
  );

describe("buildTaskGraphModel", () => {
  it("orders an input-independent dependency chain", () => {
    expect(
      layerIds([
        makeTask("deliver", ["implement"]),
        makeTask("plan"),
        makeTask("implement", ["plan"]),
      ]),
    ).toEqual([["plan"], ["implement"], ["deliver"]]);
  });

  it("preserves fan-out, fan-in and disconnected roots", () => {
    const model = buildTaskGraphModel([
      makeTask("plan"),
      makeTask("frontend", ["plan"]),
      makeTask("backend", ["plan"]),
      makeTask("integrate", ["frontend", "backend"]),
      makeTask("independent"),
    ]);

    expect(model.layers.map((layer) => layer.tasks.map((task) => task.id))).toEqual([
      ["plan", "independent"],
      ["frontend", "backend"],
      ["integrate"],
    ]);
    expect(model.edges).toEqual([
      { fromTaskId: "plan", toTaskId: "frontend" },
      { fromTaskId: "plan", toTaskId: "backend" },
      { fromTaskId: "frontend", toTaskId: "integrate" },
      { fromTaskId: "backend", toTaskId: "integrate" },
    ]);
  });

  it("keeps malformed Tasks visible and reports graph issues", () => {
    const missing = buildTaskGraphModel([makeTask("deliver", ["missing"])]);
    expect(missing.layers[0]?.tasks[0]?.id).toBe("deliver");
    expect(missing.issues).toEqual([
      {
        type: "missing_dependency",
        taskId: "deliver",
        dependencyId: "missing",
      },
    ]);

    const cycle = buildTaskGraphModel([
      makeTask("first", ["second"]),
      makeTask("second", ["first"]),
    ]);
    expect(cycle.layers.flatMap((layer) => layer.tasks)).toHaveLength(2);
    expect(cycle.issues).toEqual([
      { type: "cycle", taskId: "first" },
      { type: "cycle", taskId: "second" },
    ]);
  });

  it("returns an empty model for an empty graph", () => {
    expect(buildTaskGraphModel([])).toEqual({
      layers: [],
      edges: [],
      issues: [],
    });
  });
});

describe("reconcileSelectedTaskId", () => {
  it("preserves an existing selection", () => {
    const tasks = [makeTask("failed", [], "failed"), makeTask("selected")];
    expect(reconcileSelectedTaskId(tasks, "selected")).toBe("selected");
  });

  it("falls back to failed, active, incomplete and completed Tasks in order", () => {
    const tasks = [
      makeTask("done", [], "succeeded"),
      makeTask("pending"),
      makeTask("active", [], "running"),
      makeTask("failed", [], "failed"),
    ];
    expect(reconcileSelectedTaskId(tasks, "removed")).toBe("failed");
    expect(
      reconcileSelectedTaskId(
        tasks.filter((task) => task.id !== "failed"),
        null,
      ),
    ).toBe("active");
    expect(reconcileSelectedTaskId([], null)).toBeNull();
  });
});
