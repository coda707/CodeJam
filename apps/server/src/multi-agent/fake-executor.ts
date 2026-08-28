import type {
  CoordinationExecutor,
  TaskExecutionRequest,
  TaskExecutionResult,
} from "./ports.js";

/**
 * Foundation-only executor. Developer B replaces this port with an AgentService
 * adapter; keeping it deterministic lets A and C build against a stable path.
 */
export class FakeCoordinationExecutor implements CoordinationExecutor {
  private readonly cancelledAttempts = new Set<string>();

  constructor(private readonly delayMs = 20) {}

  async execute(
    request: TaskExecutionRequest,
    signal?: AbortSignal,
  ): Promise<TaskExecutionResult> {
    if (this.delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (signal?.aborted || this.cancelledAttempts.has(request.attempt.id)) {
      return {
        status: "failed",
        failureClass: "tool_error",
        error: "Fake execution was cancelled",
      };
    }
    return {
      status: "succeeded",
      output: {
        summary: `Foundation executor completed: ${request.task.title}`,
        artifactPaths: [],
        evidence: [`fake-executor:${request.attempt.id}`],
        unresolvedIssues: [],
      },
    };
  }

  async cancel(attemptId: string): Promise<boolean> {
    this.cancelledAttempts.add(attemptId);
    return true;
  }
}
