import type {
  CoordinationArtifact,
  CoordinationEvent,
  CoordinationSession,
  CoordinationRunUsage,
  FailureClass,
  TaskAttempt,
  TaskNode,
  WorkerOutput,
} from "./contracts.js";

export interface TaskExecutionRequest {
  session: CoordinationSession;
  task: TaskNode;
  attempt: TaskAttempt;
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

/** Developer B implements this port with the existing AgentService Run path. */
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

/** Developer B implements mechanical and optional semantic verification here. */
export interface CoordinationVerifier {
  verify(request: VerificationRequest): Promise<VerificationResult>;
}

export type ArtifactCaptureResult =
  | { status: "captured"; artifacts: CoordinationArtifact[] }
  | { status: "rejected"; failureClass: FailureClass; error: string };

/** Developer B owns safe file capture and bounded Artifact persistence here. */
export interface CoordinationArtifactRepository {
  capture(
    request: TaskExecutionRequest,
    output: WorkerOutput,
  ): Promise<ArtifactCaptureResult>;
}

/** Developer C owns the bounded event store behind this event sink. */
export interface CoordinationEventSink {
  append(event: CoordinationEvent): Promise<void>;
}

export interface CoordinationClock {
  now(): string;
}

export interface CoordinationIdGenerator {
  next(): string;
}
