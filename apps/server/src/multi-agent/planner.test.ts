import { describe, expect, it } from "vitest";
import { validatePlannerOutput } from "./planner.js";

const task = (key: string, dependencies: string[]) => ({
  key,
  title: `Task ${key}`,
  instructions: `Complete task ${key}`,
  dependencies,
  requiredCapabilities: [],
  acceptanceCriteria: [
    {
      id: `${key}-output`,
      kind: "artifact" as const,
      description: `Task ${key} produces output`,
      value: "worker-output",
    },
  ],
});

describe("planner validation", () => {
  it("rejects cycles before any task can execute", () => {
    expect(() =>
      validatePlannerOutput({
        topology: "dag",
        explanation: "Invalid cyclic graph",
        tasks: [task("first", ["second"]), task("second", ["first"])],
      }),
    ).toThrow(/cycle/i);
  });

  it("rejects missing dependency references", () => {
    expect(() =>
      validatePlannerOutput({
        topology: "dag",
        explanation: "Invalid missing dependency",
        tasks: [task("deliver", ["missing"])],
      }),
    ).toThrow(/missing dependency/i);
  });
});
