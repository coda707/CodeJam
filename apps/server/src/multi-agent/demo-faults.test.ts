import { describe, expect, it } from "vitest";
import { FaultInjectingExecutor } from "./demo-faults.js";
import type { CoordinationExecutor } from "./ports.js";
import { makeTaskExecutionRequest } from "./test-support/factories.js";

function makeInner(): CoordinationExecutor {
  return {
    execute: async (request) => ({
      status: "succeeded",
      output: {
        summary: `Completed ${request.task.title}`,
        artifactPaths: [],
        evidence: ["Execution completed"],
        unresolvedIssues: [],
      },
    }),
    cancel: async () => true,
  };
}

describe("FaultInjectingExecutor", () => {
  it("injects a fault exactly once on a matching task, then delegates", async () => {
    const request = makeTaskExecutionRequest();
    request.task.title = "Deliver the requested result";
    const executor = new FaultInjectingExecutor(makeInner(), {
      taskTitleMatch: "Deliver",
      failureClass: "transient_provider_error",
      error: "Simulated provider outage",
    });

    const first = await executor.execute(request);
    expect(first.status).toBe("failed");
    if (first.status === "failed") {
      expect(first.failureClass).toBe("transient_provider_error");
      expect(first.error).toContain("[demo fault injection]");
    }
    expect(executor.didFire).toBe(true);

    const second = await executor.execute(request);
    expect(second.status).toBe("succeeded");
  });

  it("never fires when the task title does not match", async () => {
    const request = makeTaskExecutionRequest();
    request.task.title = "Analyze requirements";
    const executor = new FaultInjectingExecutor(makeInner(), {
      taskTitleMatch: "Deliver",
      failureClass: "timeout",
      error: "Simulated timeout",
    });

    const result = await executor.execute(request);
    expect(result.status).toBe("succeeded");
    expect(executor.didFire).toBe(false);
  });

  it("delegates cancel to the inner executor", async () => {
    const executor = new FaultInjectingExecutor(makeInner(), {
      taskTitleMatch: "Deliver",
      failureClass: "tool_error",
      error: "Unused",
    });
    await expect(executor.cancel("attempt-1")).resolves.toBe(true);
  });
});
