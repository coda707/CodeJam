import { randomUUID } from "node:crypto";
import { HttpError } from "../errors.js";
import {
  coordinationEventSchema,
  createCoordinationSessionInputSchema,
  type CoordinationEvent,
  type CoordinationEventType,
  type CoordinationSession,
  type CreateCoordinationSessionInput,
  type JsonValue,
  type TaskAttempt,
  type TaskNode,
} from "./contracts.js";
import type {
  CoordinationClock,
  CoordinationEventSink,
  CoordinationExecutor,
  CoordinationIdGenerator,
  TaskExecutionResult,
} from "./ports.js";
import { createFoundationPlan } from "./planner.js";
import type { CoordinationStore } from "./coordination-store.js";

const systemClock: CoordinationClock = { now: () => new Date().toISOString() };
const uuidGenerator: CoordinationIdGenerator = { next: () => randomUUID() };

export class CoordinationService {
  private readonly activeSessions = new Map<string, Promise<void>>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly activeAttemptIds = new Map<string, string>();

  constructor(
    private readonly store: CoordinationStore,
    private readonly executor: CoordinationExecutor,
    private readonly events: CoordinationEventSink,
    private readonly clock: CoordinationClock = systemClock,
    private readonly ids: CoordinationIdGenerator = uuidGenerator,
  ) {}

  listSessions(): CoordinationSession[] {
    return this.store.listSessions();
  }

  getSession(id: string): CoordinationSession {
    return this.store.getSession(id);
  }

  getTasks(sessionId: string): TaskNode[] {
    return this.store.getTasks(sessionId);
  }

  getAttempts(sessionId: string): TaskAttempt[] {
    return this.store.getAttempts(sessionId);
  }

  getEvents(sessionId: string): CoordinationEvent[] {
    return this.store.getEvents(sessionId);
  }

  getArtifacts(sessionId: string) {
    return this.store.getArtifacts(sessionId);
  }

  async createSession(
    value: CreateCoordinationSessionInput,
  ): Promise<{ session: CoordinationSession; tasks: TaskNode[] }> {
    const input = createCoordinationSessionInputSchema.parse(value);
    const plan = createFoundationPlan(input.userTask);
    const createdAt = this.clock.now();
    const taskIds = new Map(plan.tasks.map((task) => [task.key, this.ids.next()]));
    const session: CoordinationSession = {
      id: this.ids.next(),
      userTask: input.userTask,
      status: "planning",
      topology: plan.topology,
      participantAgentIds: input.participantAgentIds,
      rootTraceId: this.ids.next(),
      budget: {
        maxTasks: 8,
        maxConcurrentTasks: 2,
        maxAttemptsPerTask: 2,
        maxAgentCalls: 8,
        maxEvents: 500,
      },
      createdAt,
    };
    const tasks = plan.tasks.map<TaskNode>((task) => ({
      id: taskIds.get(task.key)!,
      sessionId: session.id,
      title: task.title,
      instructions: task.instructions,
      dependencies: task.dependencies.map((key) => taskIds.get(key)!),
      requiredCapabilities: task.requiredCapabilities,
      acceptanceCriteria: task.acceptanceCriteria,
      status: "pending",
      attemptCount: 0,
      createdAt,
      updatedAt: createdAt,
    }));

    await this.store.createSession(session, tasks);
    await this.emit(session.id, "session.created", {
      topology: session.topology,
      taskCount: tasks.length,
    });
    await this.emit(session.id, "plan.created", {
      explanation: plan.explanation,
      taskIds: tasks.map((task) => task.id),
    });
    return { session, tasks };
  }

  async startSession(id: string): Promise<CoordinationSession> {
    const startedAt = this.clock.now();
    const { session, started } = await this.store.startSession(id, startedAt);
    if (!started) return session;
    await this.emit(id, "session.started", {});

    const controller = new AbortController();
    this.abortControllers.set(id, controller);
    const execution = this.executeSession(id, controller.signal);
    this.activeSessions.set(id, execution);
    void execution
      .finally(() => {
        if (this.activeSessions.get(id) === execution) {
          this.activeSessions.delete(id);
          this.abortControllers.delete(id);
          this.activeAttemptIds.delete(id);
        }
      })
      .catch(() => undefined);
    return session;
  }

  async stopSession(id: string): Promise<CoordinationSession> {
    const current = this.store.getSession(id);
    if (current.status === "cancelled") return current;
    if (["completed", "failed"].includes(current.status)) {
      throw new HttpError(409, `Cannot stop a ${current.status} Session`);
    }

    this.abortControllers.get(id)?.abort();
    const attemptId = this.activeAttemptIds.get(id);
    if (attemptId) await this.executor.cancel(attemptId);
    const completedAt = this.clock.now();
    const session = await this.store.updateSession(id, (stored) => {
      stored.status = "cancelled";
      stored.completedAt = completedAt;
    });
    await this.store.cancelSessionWork(id, completedAt);
    await this.emit(id, "session.cancelled", {});
    return session;
  }

  async waitForIdle(id: string): Promise<void> {
    await this.activeSessions.get(id);
  }

  private async executeSession(sessionId: string, signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted) {
        const session = this.store.getSession(sessionId);
        if (session.status === "cancelled") return;
        const tasks = this.store.getTasks(sessionId);
        if (tasks.every((task) => task.status === "succeeded")) {
          const completedAt = this.clock.now();
          await this.store.updateSession(sessionId, (stored) => {
            stored.status = "completed";
            stored.completedAt = completedAt;
          });
          await this.emit(sessionId, "session.completed", {
            completedTaskCount: tasks.length,
          });
          return;
        }
        if (tasks.some((task) => task.status === "failed")) {
          await this.failSession(sessionId, "A foundation task failed");
          return;
        }

        const succeeded = new Set(
          tasks.filter((task) => task.status === "succeeded").map((task) => task.id),
        );
        const ready = tasks.filter(
          (task) =>
            task.status === "pending" &&
            task.dependencies.every((dependency) => succeeded.has(dependency)),
        );
        if (ready.length === 0) {
          await this.failSession(sessionId, "No executable task remains");
          return;
        }
        for (const task of ready.slice(0, session.budget.maxConcurrentTasks)) {
          await this.executeTask(session, task, signal);
          if (signal.aborted) return;
        }
      }
    } catch (error) {
      if (this.store.getSession(sessionId).status !== "cancelled") {
        await this.failSession(
          sessionId,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  private async executeTask(
    session: CoordinationSession,
    task: TaskNode,
    signal: AbortSignal,
  ): Promise<void> {
    const readyAt = this.clock.now();
    await this.store.updateTask(task.id, (stored) => {
      if (stored.status !== "pending") {
        throw new HttpError(409, "Task is no longer pending");
      }
      stored.status = "ready";
      stored.updatedAt = readyAt;
    });
    await this.emit(session.id, "task.ready", { title: task.title }, { taskId: task.id });

    const agentId =
      session.participantAgentIds[
        task.attemptCount % Math.max(session.participantAgentIds.length, 1)
      ];
    const attempt: TaskAttempt = {
      id: this.ids.next(),
      sessionId: session.id,
      taskId: task.id,
      status: "created",
      createdAt: this.clock.now(),
      ...(agentId ? { agentId } : {}),
    };
    await this.store.createAttempt(attempt);
    const leasedAt = this.clock.now();
    const leasedTask = await this.store.updateTask(task.id, (stored) => {
      if (stored.status !== "ready") throw new HttpError(409, "Task lease conflict");
      stored.status = "leased";
      stored.attemptCount += 1;
      stored.updatedAt = leasedAt;
      if (agentId) stored.assignedAgentId = agentId;
    });
    await this.emit(
      session.id,
      "attempt.created",
      {},
      { taskId: task.id, attemptId: attempt.id, ...(agentId ? { agentId } : {}) },
    );
    await this.emit(
      session.id,
      "task.leased",
      { attemptCount: leasedTask.attemptCount },
      { taskId: task.id, attemptId: attempt.id, ...(agentId ? { agentId } : {}) },
    );

    const startedAt = this.clock.now();
    const runningTask = await this.store.updateTask(task.id, (stored) => {
      stored.status = "running";
      stored.updatedAt = startedAt;
    });
    const runningAttempt = await this.store.updateAttempt(attempt.id, (stored) => {
      stored.status = "running";
      stored.startedAt = startedAt;
    });
    this.activeAttemptIds.set(session.id, attempt.id);
    await this.emit(
      session.id,
      "attempt.started",
      {},
      { taskId: task.id, attemptId: attempt.id, ...(agentId ? { agentId } : {}) },
    );
    await this.emit(
      session.id,
      "task.started",
      { title: task.title },
      { taskId: task.id, attemptId: attempt.id, ...(agentId ? { agentId } : {}) },
    );

    let result: TaskExecutionResult;
    try {
      result = await this.executor.execute(
        { session, task: runningTask, attempt: runningAttempt },
        signal,
      );
    } catch (error) {
      result = {
        status: "failed",
        failureClass: "tool_error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (signal.aborted || this.store.getSession(session.id).status === "cancelled") return;
    await this.finishAttempt(session.id, runningTask, runningAttempt, result);
    if (this.activeAttemptIds.get(session.id) === attempt.id) {
      this.activeAttemptIds.delete(session.id);
    }
  }

  private async finishAttempt(
    sessionId: string,
    task: TaskNode,
    attempt: TaskAttempt,
    result: TaskExecutionResult,
  ): Promise<void> {
    const completedAt = this.clock.now();
    if (result.status === "succeeded") {
      await this.store.updateAttempt(attempt.id, (stored) => {
        stored.status = "succeeded";
        stored.completedAt = completedAt;
        if (result.runId) stored.runId = result.runId;
      });
      await this.store.updateTask(task.id, (stored) => {
        stored.status = "succeeded";
        stored.updatedAt = completedAt;
      });
      await this.emit(
        sessionId,
        "attempt.succeeded",
        { summary: result.output.summary },
        { taskId: task.id, attemptId: attempt.id },
      );
      await this.emit(
        sessionId,
        "task.succeeded",
        { title: task.title },
        { taskId: task.id, attemptId: attempt.id },
      );
      return;
    }

    await this.store.updateAttempt(attempt.id, (stored) => {
      stored.status = "failed";
      stored.completedAt = completedAt;
      stored.errorClass = result.failureClass;
      stored.errorMessage = result.error;
      if (result.runId) stored.runId = result.runId;
    });
    await this.store.updateTask(task.id, (stored) => {
      stored.status = "failed";
      stored.updatedAt = completedAt;
    });
    await this.emit(
      sessionId,
      "attempt.failed",
      { error: result.error, failureClass: result.failureClass },
      { taskId: task.id, attemptId: attempt.id },
    );
    await this.emit(
      sessionId,
      "task.failed",
      { title: task.title },
      { taskId: task.id, attemptId: attempt.id },
    );
  }

  private async failSession(sessionId: string, reason: string): Promise<void> {
    if (this.store.getSession(sessionId).status === "cancelled") return;
    const completedAt = this.clock.now();
    await this.store.updateSession(sessionId, (stored) => {
      stored.status = "failed";
      stored.failureReason = reason.slice(0, 2_000);
      stored.completedAt = completedAt;
    });
    await this.emit(sessionId, "session.failed", { reason: reason.slice(0, 2_000) });
  }

  private async emit(
    sessionId: string,
    type: CoordinationEventType,
    payload: Record<string, JsonValue>,
    correlation: Partial<
      Pick<CoordinationEvent, "taskId" | "attemptId" | "agentId" | "runId">
    > = {},
  ): Promise<void> {
    await this.events.append(
      coordinationEventSchema.parse({
        id: this.ids.next(),
        sessionId,
        type,
        payload,
        createdAt: this.clock.now(),
        ...correlation,
      }),
    );
  }
}
