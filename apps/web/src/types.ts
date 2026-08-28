export type AgentStatus = "ready" | "busy" | "stopped" | "error";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface Agent {
  id: string;
  name: string;
  description: string;
  instructions: string;
  status: AgentStatus;
  workspacePath: string;
  codexThreadId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  agentId: string;
  runId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  status: RunStatus;
  prompt: string;
  output: string | null;
  error: string | null;
  usage: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
  } | null;
  createdAt: string;
}

export interface SystemInfo {
  arkConfigured: boolean;
  arkBaseUrl: string;
  arkModel: string | null;
  codexAvailable: boolean;
  codexSandboxMode: string;
  runtimeProvider: "local-process" | "container";
  coordinationExecutor: "fake" | "agent";
  containerEngine: string | null;
  runtime: string;
}

export type CoordinationSessionStatus =
  | "planning"
  | "forming_team"
  | "executing"
  | "verifying"
  | "recovering"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type CoordinationTaskStatus =
  | "pending"
  | "ready"
  | "leased"
  | "running"
  | "verifying"
  | "succeeded"
  | "failed"
  | "blocked"
  | "superseded";

export interface CoordinationSession {
  id: string;
  userTask: string;
  status: CoordinationSessionStatus;
  topology: "single" | "sequential" | "parallel" | "manager_worker" | "review" | "dag";
  participantAgentIds: string[];
  rootTraceId: string;
  budget: {
    maxTasks: number;
    maxConcurrentTasks: number;
    maxAttemptsPerTask: number;
    maxAgentCalls: number;
    maxEvents: number;
    deadlineAt?: string;
  };
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  failureReason?: string;
}

export interface CoordinationTask {
  id: string;
  sessionId: string;
  title: string;
  instructions: string;
  dependencies: string[];
  requiredCapabilities: string[];
  acceptanceCriteria: Array<{
    id: string;
    kind: "command" | "file_exists" | "artifact" | "manual_review";
    description: string;
    value: string;
  }>;
  status: CoordinationTaskStatus;
  assignedAgentId?: string;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CoordinationAttempt {
  id: string;
  sessionId: string;
  taskId: string;
  agentId?: string;
  runId?: string;
  status: "created" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled" | "reassigned";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  errorClass?: string;
  errorMessage?: string;
}

export interface CoordinationEvent {
  id: string;
  sessionId: string;
  taskId?: string;
  attemptId?: string;
  agentId?: string;
  runId?: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
