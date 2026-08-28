import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_EVENT_PAYLOAD_BYTES,
  coordinationEventSchema,
  plannerOutputSchema,
} from "./contracts.js";

const criterion = {
  id: "check-output",
  kind: "artifact" as const,
  description: "The task produces a structured result",
  value: "worker-output",
};

describe("coordination contracts", () => {
  it("accepts a bounded planner DAG contract", () => {
    const result = plannerOutputSchema.parse({
      topology: "sequential",
      explanation: "The second task consumes the first task's result.",
      tasks: [
        {
          key: "plan",
          title: "Plan the work",
          instructions: "Create a small implementation plan.",
          dependencies: [],
          requiredCapabilities: ["planning"],
          acceptanceCriteria: [criterion],
        },
        {
          key: "deliver",
          title: "Deliver the result",
          instructions: "Use the plan to produce the final result.",
          dependencies: ["plan"],
          requiredCapabilities: ["delivery"],
          acceptanceCriteria: [criterion],
        },
      ],
    });

    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[1]?.dependencies).toEqual(["plan"]);
  });

  it("rejects unknown LLM control fields", () => {
    expect(() =>
      plannerOutputSchema.parse({
        topology: "single",
        explanation: "One bounded task is enough.",
        tasks: [
          {
            key: "deliver",
            title: "Deliver",
            instructions: "Produce the result.",
            dependencies: [],
            requiredCapabilities: [],
            acceptanceCriteria: [criterion],
            bypassVerification: true,
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects oversized event payloads", () => {
    expect(() =>
      coordinationEventSchema.parse({
        id: randomUUID(),
        sessionId: randomUUID(),
        type: "session.created",
        payload: { text: "x".repeat(MAX_EVENT_PAYLOAD_BYTES + 1) },
        createdAt: new Date().toISOString(),
      }),
    ).toThrow(/payload exceeds/i);
  });
});
