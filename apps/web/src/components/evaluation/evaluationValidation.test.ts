import { describe, expect, it } from "vitest";
import { summarizeStrategy } from "./evaluationModel";
import type { EvaluationDataset } from "./evaluationTypes";
import { parseEvaluationDataset } from "./evaluationValidation";

const dataset: EvaluationDataset = {
  schemaVersion: 1,
  name: "MOSAIC comparison",
  generatedAt: "2026-08-30T00:00:00.000Z",
  source: { kind: "real", label: "WSL evaluation run" },
  runs: [
    {
      id: "mosaic-run-1",
      taskName: "Recover a failed verification",
      strategy: "mosaic",
      completedAt: "2026-08-30T00:00:00.000Z",
      evidenceRefs: ["session:session-id"],
      metrics: {
        taskSucceeded: true,
        acceptanceTestsPassed: 4,
        acceptanceTestsTotal: 4,
        acceptanceCriteriaMet: 3,
        acceptanceCriteriaTotal: 3,
        totalTokens: 1200,
        latencyMs: 4000,
        agentCalls: 4,
        duplicateWorkCount: 0,
        failedAttempts: 1,
        recoveryAttempted: true,
        recoverySucceeded: true,
        humanInterventions: 0,
        coordinationOverheadMs: 300,
        failureLocalizationCorrect: true,
      },
    },
    {
      id: "mosaic-run-2",
      taskName: "Build independent modules",
      strategy: "mosaic",
      completedAt: "2026-08-30T00:01:00.000Z",
      evidenceRefs: ["session:second-session-id"],
      metrics: {
        taskSucceeded: false,
        acceptanceTestsPassed: 2,
        acceptanceTestsTotal: 4,
        acceptanceCriteriaMet: 2,
        acceptanceCriteriaTotal: 4,
        totalTokens: 800,
        latencyMs: 2000,
        agentCalls: 2,
        duplicateWorkCount: 1,
        failedAttempts: 1,
        recoveryAttempted: false,
        recoverySucceeded: null,
        humanInterventions: 1,
        coordinationOverheadMs: 100,
        failureLocalizationCorrect: false,
      },
    },
  ],
};

describe("evaluation dataset", () => {
  it("accepts bounded, evidence-linked evaluation results", () => {
    expect(parseEvaluationDataset(dataset)).toEqual(dataset);
  });

  it("rejects unknown fields and inconsistent recovery results", () => {
    expect(() =>
      parseEvaluationDataset({ ...dataset, inventedScore: 99 }),
    ).toThrow("unknown fields");
    expect(() =>
      parseEvaluationDataset({
        ...dataset,
        runs: [
          {
            ...dataset.runs[0],
            metrics: {
              ...dataset.runs[0]!.metrics,
              recoveryAttempted: false,
              recoverySucceeded: true,
            },
          },
        ],
      }),
    ).toThrow("must be null");
  });

  it("aggregates only primary runs without inventing missing strategies", () => {
    const summary = summarizeStrategy("mosaic", dataset.runs);

    expect(summary?.runCount).toBe(2);
    expect(summary?.taskSuccessRate).toBe(0.5);
    expect(summary?.acceptanceTestPassRate).toBe(0.75);
    expect(summary?.recoverySuccessRate).toBe(1);
    expect(summary?.averageLatencyMs).toBe(3000);
    expect(summarizeStrategy("single_agent", dataset.runs)).toBeNull();
  });
});
