import { z } from "zod";

export const MAX_COORDINATION_TASKS = 32;
export const MAX_COORDINATION_EVENTS = 2_000;
export const MAX_EVENT_PAYLOAD_BYTES = 32_768;

const boundedId = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const taskKeySchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string().max(10_000),
    z.array(jsonValueSchema).max(100),
    z.record(z.string().max(80), jsonValueSchema),
  ]),
);

export const sessionStatusSchema = z.enum([
  "planning",
  "forming_team",
  "executing",
  "verifying",
  "recovering",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
]);

export const coordinationTopologySchema = z.enum([
  "single",
  "sequential",
  "parallel",
  "manager_worker",
  "review",
  "dag",
]);

export const taskStatusSchema = z.enum([
  "pending",
  "ready",
  "leased",
  "running",
  "verifying",
  "succeeded",
  "failed",
  "blocked",
  "superseded",
]);

export const attemptStatusSchema = z.enum([
  "created",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
  "reassigned",
]);

export const failureClassSchema = z.enum([
  "transient_provider_error",
  "timeout",
  "malformed_output",
  "tool_error",
  "test_failure",
  "dependency_failure",
  "agent_capability_mismatch",
  "conflicting_artifact",
  "budget_exceeded",
  "no_progress",
  "unsafe_action",
]);

export const artifactTypeSchema = z.enum([
  "plan",
  "report",
  "patch",
  "commit",
  "test_report",
  "review",
  "failure_report",
  "final_result",
]);

export const verificationStatusSchema = z.enum([
  "unverified",
  "accepted",
  "rejected",
]);

export const acceptanceCriterionSchema = z.strictObject({
  id: boundedText(80),
  kind: z.enum(["command", "file_exists", "artifact", "manual_review"]),
  description: boundedText(1_000),
  value: boundedText(2_000),
});

export const coordinationBudgetSchema = z.strictObject({
  maxTasks: z.number().int().min(1).max(MAX_COORDINATION_TASKS),
  maxConcurrentTasks: z.number().int().min(1).max(8),
  maxAttemptsPerTask: z.number().int().min(1).max(5),
  maxAgentCalls: z.number().int().min(1).max(100),
  maxEvents: z.number().int().min(10).max(MAX_COORDINATION_EVENTS),
  deadlineAt: timestamp.optional(),
});

export const coordinationSessionSchema = z.strictObject({
  id: boundedId,
  userTask: boundedText(50_000),
  status: sessionStatusSchema,
  topology: coordinationTopologySchema,
  participantAgentIds: z.array(boundedId).max(32),
  rootTraceId: boundedId,
  budget: coordinationBudgetSchema,
  createdAt: timestamp,
  startedAt: timestamp.optional(),
  completedAt: timestamp.optional(),
  failureReason: z.string().max(2_000).optional(),
});

export const taskNodeSchema = z.strictObject({
  id: boundedId,
  sessionId: boundedId,
  title: boundedText(160),
  instructions: boundedText(10_000),
  dependencies: z.array(boundedId).max(MAX_COORDINATION_TASKS),
  requiredCapabilities: z.array(boundedText(80)).max(16),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).min(1).max(16),
  status: taskStatusSchema,
  assignedAgentId: boundedId.optional(),
  attemptCount: z.number().int().min(0).max(5),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const workerOutputSchema = z.strictObject({
  summary: boundedText(5_000),
  artifactPaths: z.array(z.string().max(1_000)).max(32),
  evidence: z.array(boundedText(2_000)).max(32),
  unresolvedIssues: z.array(boundedText(2_000)).max(32),
});

export const taskAttemptSchema = z.strictObject({
  id: boundedId,
  sessionId: boundedId,
  taskId: boundedId,
  agentId: boundedId.optional(),
  runId: boundedId.optional(),
  status: attemptStatusSchema,
  retryOfAttemptId: boundedId.optional(),
  startedAt: timestamp.optional(),
  completedAt: timestamp.optional(),
  errorClass: failureClassSchema.optional(),
  errorMessage: z.string().max(2_000).optional(),
  usage: z
    .strictObject({
      inputTokens: z.number().int().min(0).optional(),
      cachedInputTokens: z.number().int().min(0).optional(),
      outputTokens: z.number().int().min(0).optional(),
    })
    .optional(),
  workerOutput: workerOutputSchema.optional(),
  createdAt: timestamp,
});

export const coordinationArtifactSchema = z.strictObject({
  id: boundedId,
  sessionId: boundedId,
  taskId: boundedId,
  producerAgentId: boundedId.optional(),
  attemptId: boundedId.optional(),
  type: artifactTypeSchema,
  schemaVersion: z.number().int().min(1).max(100),
  sourcePath: z.string().max(1_000).optional(),
  path: z.string().max(1_000).optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  verificationStatus: verificationStatusSchema,
  createdAt: timestamp,
});

export const coordinationEventTypeSchema = z.enum([
  "session.created",
  "session.started",
  "session.completed",
  "session.failed",
  "session.cancelled",
  "session.approved",
  "session.rejected",
  "plan.created",
  "plan.revised",
  "agent.selected",
  "task.ready",
  "task.leased",
  "task.started",
  "task.succeeded",
  "task.failed",
  "task.retried",
  "task.reassigned",
  "attempt.created",
  "attempt.started",
  "attempt.succeeded",
  "attempt.failed",
  "attempt.cancelled",
  "artifact.created",
  "artifact.accepted",
  "artifact.rejected",
  "verification.started",
  "verification.passed",
  "verification.failed",
  "recovery.decided",
  "integration.completed",
]);

const eventPayloadSchema = z
  .record(z.string().max(80), jsonValueSchema)
  .superRefine((payload, context) => {
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_EVENT_PAYLOAD_BYTES) {
      context.addIssue({
        code: "custom",
        message: `Event payload exceeds ${MAX_EVENT_PAYLOAD_BYTES} bytes`,
      });
    }
  });

export const coordinationEventSchema = z.strictObject({
  id: boundedId,
  sessionId: boundedId,
  taskId: boundedId.optional(),
  attemptId: boundedId.optional(),
  agentId: boundedId.optional(),
  runId: boundedId.optional(),
  type: coordinationEventTypeSchema,
  payload: eventPayloadSchema,
  createdAt: timestamp,
});

export const coordinationMetricsSchema = z.strictObject({
  sessionId: boundedId,
  totalTasks: z.number().int().min(0),
  totalAttempts: z.number().int().min(0),
  totalAgentCalls: z.number().int().min(0),
  failedAttempts: z.number().int().min(0),
  retryAttempts: z.number().int().min(0),
  recoveredTasks: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  cachedInputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  totalArtifacts: z.number().int().min(0),
  acceptedArtifacts: z.number().int().min(0),
  totalEvents: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  recoveryStatus: z.enum([
    "not_needed",
    "not_attempted",
    "in_progress",
    "succeeded",
    "failed",
  ]),
});

export const createCoordinationSessionInputSchema = z.strictObject({
  userTask: boundedText(50_000),
  participantAgentIds: z.array(boundedId).max(32).default([]),
});

const plannerTaskSchema = z.strictObject({
  key: taskKeySchema,
  title: boundedText(160),
  instructions: boundedText(10_000),
  dependencies: z
    .array(taskKeySchema)
    .max(MAX_COORDINATION_TASKS),
  requiredCapabilities: z.array(boundedText(80)).max(16),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).min(1).max(16),
});

export const plannerOutputSchema = z.strictObject({
  topology: coordinationTopologySchema,
  explanation: boundedText(2_000),
  tasks: z.array(plannerTaskSchema).min(1).max(MAX_COORDINATION_TASKS),
});

export const teamBuilderOutputSchema = z.strictObject({
  participantAgentIds: z.array(boundedId).max(32),
  assignments: z
    .array(
      z.strictObject({
        taskKey: taskKeySchema,
        agentId: boundedId,
      }),
    )
    .max(MAX_COORDINATION_TASKS),
  explanation: boundedText(2_000),
});

export const recoveryActionSchema = z.enum([
  "retry",
  "reassign",
  "request_approval",
  "stop",
]);

export const recoveryDecisionSchema = z.strictObject({
  action: recoveryActionSchema,
  reason: boundedText(2_000),
  nextAgentId: boundedId.optional(),
});

export const reviewerOutputSchema = z.strictObject({
  verdict: z.enum(["pass", "fail"]),
  evidence: z.array(boundedText(2_000)).min(1).max(32),
  requiredFixes: z.array(boundedText(2_000)).max(32),
});

export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type CoordinationTopology = z.infer<typeof coordinationTopologySchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;
export type FailureClass = z.infer<typeof failureClassSchema>;
export type ArtifactType = z.infer<typeof artifactTypeSchema>;
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;
export type CoordinationBudget = z.infer<typeof coordinationBudgetSchema>;
export type CoordinationSession = z.infer<typeof coordinationSessionSchema>;
export type TaskNode = z.infer<typeof taskNodeSchema>;
export type TaskAttempt = z.infer<typeof taskAttemptSchema>;
export type CoordinationArtifact = z.infer<typeof coordinationArtifactSchema>;
export type CoordinationEventType = z.infer<typeof coordinationEventTypeSchema>;
export type CoordinationEvent = z.infer<typeof coordinationEventSchema>;
export type CoordinationRunUsage = NonNullable<TaskAttempt["usage"]>;
export type CoordinationMetrics = z.infer<typeof coordinationMetricsSchema>;
export type CreateCoordinationSessionInput = z.infer<
  typeof createCoordinationSessionInputSchema
>;
export type PlannerOutput = z.infer<typeof plannerOutputSchema>;
export type WorkerOutput = z.infer<typeof workerOutputSchema>;
export type TeamBuilderOutput = z.infer<typeof teamBuilderOutputSchema>;
export type RecoveryAction = z.infer<typeof recoveryActionSchema>;
export type RecoveryDecision = z.infer<typeof recoveryDecisionSchema>;
export type ReviewerOutput = z.infer<typeof reviewerOutputSchema>;
