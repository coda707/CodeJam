export type EvaluationStrategy = "single_agent" | "static_team" | "mosaic";

export interface EvaluationMetrics {
  taskSucceeded: boolean;
  acceptanceTestsPassed: number;
  acceptanceTestsTotal: number;
  acceptanceCriteriaMet: number;
  acceptanceCriteriaTotal: number;
  totalTokens: number;
  latencyMs: number;
  agentCalls: number;
  duplicateWorkCount: number;
  failedAttempts: number;
  recoveryAttempted: boolean;
  recoverySucceeded: boolean | null;
  humanInterventions: number;
  coordinationOverheadMs: number;
  failureLocalizationCorrect: boolean | null;
}

export interface EvaluationRun {
  id: string;
  taskName: string;
  strategy: EvaluationStrategy;
  variant?: string;
  completedAt: string;
  evidenceRefs: string[];
  metrics: EvaluationMetrics;
}

export interface EvaluationDataset {
  schemaVersion: 1;
  name: string;
  generatedAt: string;
  source: {
    kind: "real" | "fixture";
    label: string;
  };
  runs: EvaluationRun[];
}

export interface StrategySummary {
  strategy: EvaluationStrategy;
  runCount: number;
  taskSuccessRate: number;
  acceptanceTestPassRate: number;
  acceptanceCriteriaCoverage: number;
  recoverySuccessRate: number | null;
  failureLocalizationAccuracy: number | null;
  totalTokens: number;
  averageLatencyMs: number;
  totalAgentCalls: number;
  duplicateWorkRate: number;
  totalFailedAttempts: number;
  totalHumanInterventions: number;
  averageCoordinationOverheadMs: number;
}
