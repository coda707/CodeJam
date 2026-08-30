import type { AgentRun, SendMessageOptions } from "../types.js";
import { workerOutputSchema, type WorkerOutput } from "./contracts.js";
import { classifyExecutionFailure } from "./failure-classifier.js";
import type {
  CoordinationExecutor,
  TaskExecutionRequest,
  TaskExecutionResult,
} from "./ports.js";

export interface AgentExecutionService {
  sendMessage(
    agentId: string,
    prompt: string,
    options: SendMessageOptions,
  ): Promise<{ run: AgentRun }>;
  waitForRun(runId: string): Promise<AgentRun>;
  cancelRun(runId: string): Promise<boolean>;
}

const truncate = (value: string, maximum: number): string =>
  value.length <= maximum ? value : value.slice(0, maximum - 3) + "...";

export function buildWorkerPrompt(request: TaskExecutionRequest): string {
  const criteria = request.task.acceptanceCriteria.map((criterion) => ({
    id: criterion.id,
    kind: criterion.kind,
    description: criterion.description,
    value: criterion.value,
  }));
  const dependencies = request.dependencyContext.map((dependency) => ({
    taskId: dependency.task.id,
    title: dependency.task.title,
    output: dependency.attempt.workerOutput,
    artifacts: dependency.artifacts.map((item) => {
      // Accept legacy metadata-only contexts when replaying persisted tests;
      // newly built contexts always include the verified Artifact content.
      const artifact = "artifact" in item ? item.artifact : item;
      const content = "artifact" in item ? item.content : null;
      return {
        type: artifact.type,
        sourcePath: artifact.sourcePath,
        contentHash: artifact.contentHash,
        content: content?.content ?? null,
      };
    }),
  }));
  const recovery = request.recoveryContext
    ? {
        sourceTask: {
          id: request.recoveryContext.sourceTask.id,
          title: request.recoveryContext.sourceTask.title,
        },
        failedAttempts: request.recoveryContext.failedAttempts.map((attempt) => ({
          attemptId: attempt.id,
          errorClass: attempt.errorClass,
          errorMessage: attempt.errorMessage,
          verificationEvidence: attempt.verificationEvidence,
          priorOutput: attempt.workerOutput,
        })),
      }
    : null;
  return [
    "You are executing one bounded task inside a MOSAIC coordination session.",
    "Complete the task in your existing Agent workspace.",
    "Return exactly one JSON object with no Markdown fence or surrounding prose.",
    'The required shape is: {"summary":"string","artifactPaths":["relative/path"],"evidence":["string"],"unresolvedIssues":["string"]}.',
    "Only report artifact paths that you actually created or changed.",
    "",
    "Session task:",
    truncate(request.session.userTask, 12_000),
    "",
    `Task: ${request.task.title}`,
    truncate(request.task.instructions, 8_000),
    "",
    "Verified dependency context:",
    dependencies.length
      ? truncate(JSON.stringify(dependencies), 24_000)
      : "No dependencies.",
    "",
    "Recovery context from previous failed attempts:",
    recovery ? truncate(JSON.stringify(recovery), 16_000) : "No previous failure.",
    "",
    "Acceptance criteria:",
    truncate(JSON.stringify(criteria), 8_000),
  ].join("\n");
}

export function parseWorkerOutput(value: string): WorkerOutput | null {
  try {
    const parsed: unknown = JSON.parse(value);
    const result = workerOutputSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export class AgentServiceCoordinationExecutor implements CoordinationExecutor {
  private readonly activeRuns = new Map<string, string>();
  private readonly cancellationRequests = new Map<string, Promise<boolean>>();

  constructor(private readonly service: AgentExecutionService) {}

  async execute(
    request: TaskExecutionRequest,
    signal?: AbortSignal,
  ): Promise<TaskExecutionResult> {
    const agentId = request.attempt.agentId;
    if (!agentId) {
      return {
        status: "failed",
        failureClass: "agent_capability_mismatch",
        error: "Real Agent execution requires an assigned participant Agent",
      };
    }

    let runId: string | undefined;
    const abort = () => void this.cancel(request.attempt.id).catch(() => undefined);
    try {
      const started = await this.service.sendMessage(agentId, buildWorkerPrompt(request), {
        purpose: "coordination",
        coordination: {
          sessionId: request.session.id,
          taskId: request.task.id,
          attemptId: request.attempt.id,
        },
      });
      runId = started.run.id;
      this.activeRuns.set(request.attempt.id, runId);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) await this.cancel(request.attempt.id);

      const completed = await this.service.waitForRun(runId);
      if (completed.status === "completed") {
        const output = completed.output ? parseWorkerOutput(completed.output) : null;
        if (!output) {
          return {
            status: "failed",
            failureClass: "malformed_output",
            error: "Agent Run completed with malformed WorkerOutput",
            runId,
            ...(completed.usage ? { usage: completed.usage } : {}),
          };
        }
        return {
          status: "succeeded",
          output,
          runId,
          ...(completed.usage ? { usage: completed.usage } : {}),
        };
      }

      const error = completed.error ?? `Agent Run ended with status ${completed.status}`;
      return {
        status: "failed",
        failureClass: classifyExecutionFailure(error),
        error: truncate(error, 2_000),
        runId,
        ...(completed.usage ? { usage: completed.usage } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: "failed",
        failureClass: classifyExecutionFailure(error),
        error: truncate(message, 2_000),
        ...(runId ? { runId } : {}),
      };
    } finally {
      signal?.removeEventListener("abort", abort);
      this.activeRuns.delete(request.attempt.id);
    }
  }

  async cancel(attemptId: string): Promise<boolean> {
    const pending = this.cancellationRequests.get(attemptId);
    if (pending) return pending;
    const runId = this.activeRuns.get(attemptId);
    if (!runId) return false;
    const cancellation = this.service
      .cancelRun(runId)
      .finally(() => this.cancellationRequests.delete(attemptId));
    this.cancellationRequests.set(attemptId, cancellation);
    return cancellation;
  }
}
