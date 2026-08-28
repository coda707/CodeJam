import type {
  CoordinationArtifact,
  CoordinationEvent,
  CoordinationSession,
  CoordinationRunUsage,
  FailureClass,
  PlannerOutput,
  RecoveryDecision,
  TaskAttempt,
  TaskNode,
  TeamBuilderOutput,
  WorkerOutput,
} from "./contracts.js";

export interface CoordinationPlanningRequest {
  userTask: string;
  participantAgentIds: string[];
}

export interface CoordinationPlanner {
  plan(
    request: CoordinationPlanningRequest,
    signal?: AbortSignal,
  ): Promise<PlannerOutput>;
}

export interface CoordinationTeamBuilderRequest {
  userTask: string;
  plan: PlannerOutput;
  candidateAgentIds: string[];
}

export interface CoordinationTeamBuilder {
  select(
    request: CoordinationTeamBuilderRequest,
    signal?: AbortSignal,
  ): Promise<TeamBuilderOutput>;
}

export interface TaskDependencyContext {
  task: TaskNode;
  attempt: TaskAttempt;
  artifacts: CoordinationArtifact[];
}

export interface TaskExecutionRequest {
  session: CoordinationSession;
  task: TaskNode;
  attempt: TaskAttempt;
  dependencyContext: TaskDependencyContext[];
}

export type TaskExecutionResult =
  | {
      status: "succeeded";
      output: WorkerOutput;
      runId?: string;
      usage?: CoordinationRunUsage;
    }
  | {
      status: "failed";
      failureClass: FailureClass;
      error: string;
      runId?: string;
      usage?: CoordinationRunUsage;
    };

export interface CoordinationExecutor {
  execute(
    request: TaskExecutionRequest,
    signal?: AbortSignal,
  ): Promise<TaskExecutionResult>;
  cancel(attemptId: string): Promise<boolean>;
}

export interface VerificationRequest {
  session: CoordinationSession;
  task: TaskNode;
  attempt: TaskAttempt;
  artifacts: CoordinationArtifact[];
  output: WorkerOutput;
}

export type VerificationResult =
  | { status: "accepted"; evidence: string[] }
  | { status: "rejected"; evidence: string[]; failureClass: FailureClass };

export interface CoordinationVerifier {
  verify(request: VerificationRequest): Promise<VerificationResult>;
}

export type ArtifactCaptureResult =
  | { status: "captured"; artifacts: CoordinationArtifact[] }
  | { status: "rejected"; failureClass: FailureClass; error: string };

export interface CoordinationArtifactRepository {
  capture(
    request: TaskExecutionRequest,
    output: WorkerOutput,
  ): Promise<ArtifactCaptureResult>;
}

export interface CoordinationEventSink {
  append(event: CoordinationEvent): Promise<void>;
}

export interface RecoveryPolicyRequest {
  session: CoordinationSession;
  task: TaskNode;
  failedAttempt: TaskAttempt;
  attempts: TaskAttempt[];
  availableAgentIds: string[];
}

export interface CoordinationRecoveryPolicy {
  decide(
    request: RecoveryPolicyRequest,
    signal?: AbortSignal,
  ): Promise<RecoveryDecision>;
}

export interface CoordinationClock {
  now(): string;
}

export interface CoordinationIdGenerator {
  next(): string;
}
