import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EvaluationDataset } from "./evaluationTypes";
import { EvaluationComparison, EvaluationWorkspace } from "./EvaluationWorkspace";

const dataset: EvaluationDataset = {
  schemaVersion: 1,
  name: "Controlled comparison",
  generatedAt: "2026-08-30T00:00:00.000Z",
  source: { kind: "fixture", label: "UI development fixture" },
  runs: [
    {
      id: "mosaic-run",
      taskName: "Recover a failed Task",
      strategy: "mosaic",
      completedAt: "2026-08-30T00:00:00.000Z",
      evidenceRefs: ["session:session-id"],
      metrics: {
        taskSucceeded: true,
        acceptanceTestsPassed: 2,
        acceptanceTestsTotal: 2,
        acceptanceCriteriaMet: 2,
        acceptanceCriteriaTotal: 2,
        totalTokens: 1000,
        latencyMs: 2500,
        agentCalls: 3,
        duplicateWorkCount: 0,
        failedAttempts: 1,
        recoveryAttempted: true,
        recoverySucceeded: true,
        humanInterventions: 0,
        coordinationOverheadMs: 200,
        failureLocalizationCorrect: true,
      },
    },
  ],
};

describe("evaluation workspace", () => {
  it("starts empty without presenting invented comparison values", () => {
    const markup = renderToStaticMarkup(<EvaluationWorkspace />);

    expect(markup).toContain("Compare evidence, not claims");
    expect(markup).toContain("Choose JSON file");
    expect(markup).not.toContain("Task success rate");
  });

  it("labels fixtures and incomplete comparisons explicitly", () => {
    const markup = renderToStaticMarkup(
      <EvaluationComparison dataset={dataset} fileName="fixture.json" />,
    );

    expect(markup).toContain("Fixture data");
    expect(markup).toContain("Development fixture only");
    expect(markup).toContain("Comparison incomplete");
    expect(markup).toContain("Single Agent, Static Team");
    expect(markup).toContain("session:session-id");
    expect(markup).toContain("No ablation runs imported");
  });
});
