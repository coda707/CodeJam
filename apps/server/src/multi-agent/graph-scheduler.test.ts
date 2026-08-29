import { describe, expect, it } from "vitest";
import { computeReadyTasks } from "./graph-scheduler.js";
import { makeCoordinationSession, makeTaskNode } from "./test-support/factories.js";

describe("computeReadyTasks", () => {
  const session = makeCoordinationSession();

  it("returns pending tasks whose dependencies are all succeeded", () => {
    const root = makeTaskNode(session, {
      id: "root",
      title: "Root",
      dependencies: [],
      status: "succeeded",
    });
    const child = makeTaskNode(session, {
      id: "child",
      title: "Child",
      dependencies: ["root"],
      status: "pending",
    });
    const ready = computeReadyTasks([root, child], new Set(["root"]));
    expect(ready.map((task) => task.id)).toEqual(["child"]);
  });

  it("excludes pending tasks with unmet dependencies", () => {
    const child = makeTaskNode(session, {
      id: "child",
      dependencies: ["missing-root"],
      status: "pending",
    });
    expect(computeReadyTasks([child], new Set(["missing-root"]))).toEqual([child]);
    expect(computeReadyTasks([child], new Set())).toEqual([]);
  });

  it("only considers pending tasks, not leased or running ones", () => {
    const running = makeTaskNode(session, {
      id: "running",
      dependencies: [],
      status: "running",
    });
    const leased = makeTaskNode(session, {
      id: "leased",
      dependencies: [],
      status: "leased",
    });
    expect(computeReadyTasks([running, leased], new Set())).toEqual([]);
  });

  it("returns an empty list for no tasks", () => {
    expect(computeReadyTasks([], new Set())).toEqual([]);
  });
});
