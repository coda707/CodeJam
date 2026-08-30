import type {
  EvaluationDataset,
  EvaluationMetrics,
  EvaluationRun,
  EvaluationStrategy,
} from "./evaluationTypes";

const strategies = new Set<EvaluationStrategy>([
  "single_agent",
  "static_team",
  "mosaic",
]);

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
};

const exactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
) => {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) {
    throw new Error(`${path} contains unknown fields: ${unexpected.join(", ")}`);
  }
};

const string = (value: unknown, path: string, maximum: number) => {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(`${path} must be a non-empty string of at most ${maximum} characters`);
  }
  return value.trim();
};

const timestamp = (value: unknown, path: string) => {
  const result = string(value, path, 64);
  if (Number.isNaN(Date.parse(result))) throw new Error(`${path} must be an ISO timestamp`);
  return result;
};

const integer = (value: unknown, path: string, maximum = 1_000_000_000) => {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error(`${path} must be an integer between 0 and ${maximum}`);
  }
  return value as number;
};

const boolean = (value: unknown, path: string) => {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  return value;
};

const nullableBoolean = (value: unknown, path: string) => {
  if (value !== null && typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean or null`);
  }
  return value as boolean | null;
};

const parseMetrics = (value: unknown, path: string): EvaluationMetrics => {
  const input = record(value, path);
  exactKeys(
    input,
    [
      "taskSucceeded",
      "acceptanceTestsPassed",
      "acceptanceTestsTotal",
      "acceptanceCriteriaMet",
      "acceptanceCriteriaTotal",
      "totalTokens",
      "latencyMs",
      "agentCalls",
      "duplicateWorkCount",
      "failedAttempts",
      "recoveryAttempted",
      "recoverySucceeded",
      "humanInterventions",
      "coordinationOverheadMs",
      "failureLocalizationCorrect",
    ],
    path,
  );
  const result: EvaluationMetrics = {
    taskSucceeded: boolean(input.taskSucceeded, `${path}.taskSucceeded`),
    acceptanceTestsPassed: integer(
      input.acceptanceTestsPassed,
      `${path}.acceptanceTestsPassed`,
    ),
    acceptanceTestsTotal: integer(
      input.acceptanceTestsTotal,
      `${path}.acceptanceTestsTotal`,
    ),
    acceptanceCriteriaMet: integer(
      input.acceptanceCriteriaMet,
      `${path}.acceptanceCriteriaMet`,
    ),
    acceptanceCriteriaTotal: integer(
      input.acceptanceCriteriaTotal,
      `${path}.acceptanceCriteriaTotal`,
    ),
    totalTokens: integer(input.totalTokens, `${path}.totalTokens`),
    latencyMs: integer(input.latencyMs, `${path}.latencyMs`),
    agentCalls: integer(input.agentCalls, `${path}.agentCalls`),
    duplicateWorkCount: integer(
      input.duplicateWorkCount,
      `${path}.duplicateWorkCount`,
    ),
    failedAttempts: integer(input.failedAttempts, `${path}.failedAttempts`),
    recoveryAttempted: boolean(input.recoveryAttempted, `${path}.recoveryAttempted`),
    recoverySucceeded: nullableBoolean(
      input.recoverySucceeded,
      `${path}.recoverySucceeded`,
    ),
    humanInterventions: integer(
      input.humanInterventions,
      `${path}.humanInterventions`,
    ),
    coordinationOverheadMs: integer(
      input.coordinationOverheadMs,
      `${path}.coordinationOverheadMs`,
    ),
    failureLocalizationCorrect: nullableBoolean(
      input.failureLocalizationCorrect,
      `${path}.failureLocalizationCorrect`,
    ),
  };
  if (result.acceptanceTestsPassed > result.acceptanceTestsTotal) {
    throw new Error(`${path}.acceptanceTestsPassed cannot exceed acceptanceTestsTotal`);
  }
  if (result.acceptanceCriteriaMet > result.acceptanceCriteriaTotal) {
    throw new Error(`${path}.acceptanceCriteriaMet cannot exceed acceptanceCriteriaTotal`);
  }
  if (!result.recoveryAttempted && result.recoverySucceeded !== null) {
    throw new Error(`${path}.recoverySucceeded must be null when recovery was not attempted`);
  }
  if (result.recoveryAttempted && result.recoverySucceeded === null) {
    throw new Error(`${path}.recoverySucceeded must be recorded when recovery was attempted`);
  }
  return result;
};

const parseRun = (value: unknown, index: number): EvaluationRun => {
  const path = `runs[${index}]`;
  const input = record(value, path);
  exactKeys(
    input,
    ["id", "taskName", "strategy", "variant", "completedAt", "evidenceRefs", "metrics"],
    path,
  );
  if (!strategies.has(input.strategy as EvaluationStrategy)) {
    throw new Error(`${path}.strategy must be single_agent, static_team, or mosaic`);
  }
  if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length === 0 || input.evidenceRefs.length > 16) {
    throw new Error(`${path}.evidenceRefs must contain between 1 and 16 references`);
  }
  return {
    id: string(input.id, `${path}.id`, 120),
    taskName: string(input.taskName, `${path}.taskName`, 240),
    strategy: input.strategy as EvaluationStrategy,
    ...(input.variant === undefined
      ? {}
      : { variant: string(input.variant, `${path}.variant`, 120) }),
    completedAt: timestamp(input.completedAt, `${path}.completedAt`),
    evidenceRefs: input.evidenceRefs.map((item, evidenceIndex) =>
      string(item, `${path}.evidenceRefs[${evidenceIndex}]`, 1_000),
    ),
    metrics: parseMetrics(input.metrics, `${path}.metrics`),
  };
};

export function parseEvaluationDataset(value: unknown): EvaluationDataset {
  const input = record(value, "dataset");
  exactKeys(input, ["schemaVersion", "name", "generatedAt", "source", "runs"], "dataset");
  if (input.schemaVersion !== 1) throw new Error("dataset.schemaVersion must be 1");
  const source = record(input.source, "dataset.source");
  exactKeys(source, ["kind", "label"], "dataset.source");
  if (source.kind !== "real" && source.kind !== "fixture") {
    throw new Error("dataset.source.kind must be real or fixture");
  }
  if (!Array.isArray(input.runs) || input.runs.length === 0 || input.runs.length > 100) {
    throw new Error("dataset.runs must contain between 1 and 100 runs");
  }
  const runs = input.runs.map(parseRun);
  if (new Set(runs.map((run) => run.id)).size !== runs.length) {
    throw new Error("dataset.runs contains duplicate run IDs");
  }
  return {
    schemaVersion: 1,
    name: string(input.name, "dataset.name", 240),
    generatedAt: timestamp(input.generatedAt, "dataset.generatedAt"),
    source: {
      kind: source.kind,
      label: string(source.label, "dataset.source.label", 240),
    },
    runs,
  };
}
