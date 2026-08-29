import type { FailureClass } from "./contracts.js";
import type {
  CoordinationExecutor,
  TaskExecutionRequest,
  TaskExecutionResult,
} from "./ports.js";

export interface DemoFaultConfig {
  /** Substring matched against the Task title (case-insensitive). */
  taskTitleMatch: string;
  failureClass: FailureClass;
  error: string;
}

/**
 * One-shot demo fault injector. Wraps an inner executor and, on the first Task
 * whose title matches the configured pattern, returns a failed result once. It
 * records that the fault fired so it can never fire twice and so the injected
 * failure is explicit, observable and bounded (handout §11).
 */
export class FaultInjectingExecutor implements CoordinationExecutor {
  private fired = false;

  constructor(
    private readonly inner: CoordinationExecutor,
    private readonly config: DemoFaultConfig,
  ) {}

  async execute(
    request: TaskExecutionRequest,
    signal?: AbortSignal,
  ): Promise<TaskExecutionResult> {
    if (
      !this.fired &&
      request.task.title.toLowerCase().includes(this.config.taskTitleMatch.toLowerCase())
    ) {
      this.fired = true;
      return {
        status: "failed",
        failureClass: this.config.failureClass,
        error: `[demo fault injection] ${this.config.error}`,
      };
    }
    return this.inner.execute(request, signal);
  }

  cancel(attemptId: string): Promise<boolean> {
    return this.inner.cancel(attemptId);
  }

  get didFire(): boolean {
    return this.fired;
  }
}
