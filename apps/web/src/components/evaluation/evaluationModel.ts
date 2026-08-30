import type {
  EvaluationRun,
  EvaluationStrategy,
  StrategySummary,
} from "./evaluationTypes";

export const primaryStrategies: EvaluationStrategy[] = [
  "single_agent",
  "static_team",
  "mosaic",
];

const ratio = (numerator: number, denominator: number) =>
  denominator === 0 ? 0 : numerator / denominator;

export function summarizeStrategy(
  strategy: EvaluationStrategy,
  runs: readonly EvaluationRun[],
): StrategySummary | null {
  const selected = runs.filter(
    (run) => run.strategy === strategy && !run.variant,
  );
  if (!selected.length) return null;
  const sum = (select: (run: EvaluationRun) => number) =>
    selected.reduce((total, run) => total + select(run), 0);
  const attemptedRecoveries = selected.filter(
    (run) => run.metrics.recoveryAttempted,
  );
  const localizedFailures = selected.filter(
    (run) => run.metrics.failureLocalizationCorrect !== null,
  );
  return {
    strategy,
    runCount: selected.length,
    taskSuccessRate: ratio(
      selected.filter((run) => run.metrics.taskSucceeded).length,
      selected.length,
    ),
    acceptanceTestPassRate: ratio(
      sum((run) => run.metrics.acceptanceTestsPassed),
      sum((run) => run.metrics.acceptanceTestsTotal),
    ),
    acceptanceCriteriaCoverage: ratio(
      sum((run) => run.metrics.acceptanceCriteriaMet),
      sum((run) => run.metrics.acceptanceCriteriaTotal),
    ),
    recoverySuccessRate: attemptedRecoveries.length
      ? ratio(
          attemptedRecoveries.filter((run) => run.metrics.recoverySucceeded).length,
          attemptedRecoveries.length,
        )
      : null,
    failureLocalizationAccuracy: localizedFailures.length
      ? ratio(
          localizedFailures.filter(
            (run) => run.metrics.failureLocalizationCorrect,
          ).length,
          localizedFailures.length,
        )
      : null,
    totalTokens: sum((run) => run.metrics.totalTokens),
    averageLatencyMs: sum((run) => run.metrics.latencyMs) / selected.length,
    totalAgentCalls: sum((run) => run.metrics.agentCalls),
    duplicateWorkRate: ratio(
      sum((run) => run.metrics.duplicateWorkCount),
      sum((run) => run.metrics.agentCalls),
    ),
    totalFailedAttempts: sum((run) => run.metrics.failedAttempts),
    totalHumanInterventions: sum((run) => run.metrics.humanInterventions),
    averageCoordinationOverheadMs:
      sum((run) => run.metrics.coordinationOverheadMs) / selected.length,
  };
}
