import { describe, expect, it } from "vitest";
import { HeuristicCollaborationGate } from "./collaboration-gate.js";

describe("HeuristicCollaborationGate", () => {
  const gate = new HeuristicCollaborationGate();

  it("picks a single Agent for a small task with no decomposition signals", () => {
    expect(gate.decide("Rename a local variable", 0)).toMatchObject({
      topology: "single",
      singleAgent: true,
    });
  });

  it("picks a parallel topology for several independent work items", () => {
    expect(gate.decide("Build several independent modules", 0)).toMatchObject({
      topology: "parallel",
      singleAgent: false,
    });
  });

  it("picks a DAG when independent work also carries verification risk", () => {
    expect(
      gate.decide("Build several independent modules and verify each", 0),
    ).toMatchObject({ topology: "dag", singleAgent: false });
  });

  it("picks a sequential topology for ordered stages with risk", () => {
    expect(gate.decide("First refactor the service, then test it", 0)).toMatchObject({
      topology: "sequential",
      singleAgent: false,
    });
  });

  it("always returns a non-empty explanation", () => {
    expect(gate.decide("Do the thing", 0).explanation.length).toBeGreaterThan(0);
  });
});
