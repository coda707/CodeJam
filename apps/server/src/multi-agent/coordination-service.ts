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
  type RecoveryDecision,
  type TaskAttempt,
  type TaskNode,
} from "./contracts.js";
import type {
  CoordinationAgentCatalog,
  CoordinationArtifactRepository,
  CoordinationClock,
  CoordinationEventSink,
  CoordinationExecutor,
  CoordinationIdGenerator,
  CoordinationPlanner,
  CoordinationRecoveryPolicy,
  CoordinationTeamBuilder,
  CoordinationVerifier,
  TaskDependencyContext,
  TaskExecutionRequest,
  TaskExecutionResult,
} from "./ports.js";
import {
  FoundationCoordinationPlanner,
  validatePlannerOutput,
} from "./planner.js";
import { computeReadyTasks } from "./graph-scheduler.js";
import type { CoordinationStore } from "./coordination-store.js";
import { NoopCoordinationArtifactRepository } from "./artifact-store.js";
import { MechanicalCoordinationVerifier } from "./verifier.js";
import { projectCoordinationMetrics } from "./metrics.js";
import {
  ParticipantOrderTeamBuilder,
  validateTeamBuilderOutput,
} from "./team-builder.js";
import {
  StopCoordinationRecoveryPolicy,
  validateRecoveryDecision,
} from "./recovery-policy.js";

const systemClock: CoordinationClock = { now: () => new Date().toISOString() };
const uuidGenerator: CoordinationIdGenerator = { next: () => randomUUID() };

export interface CoordinationServiceOptions {
  clock?: CoordinationClock;
  ids?: CoordinationIdGenerator;
  artifacts?: CoordinationArtifactRepository;
  verifier?: CoordinationVerifier;
  planner?: CoordinationPlanner;
  teamBuilder?: CoordinationTeamBuilder;
  recoveryPolicy?: CoordinationRecoveryPolicy;
  catalog?: CoordinationAgentCatalog;
}

export class CoordinationService {
  private readonly activeSessions = new Map<string, Promise<void>>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly activeAttemptIds = new Map<string, Set<string>>();
  private readonly clock: CoordinationClock;
  private readonly ids: CoordinationIdGenerator;
  private readonly artifacts: CoordinationArtifactRepository;
  private readonly verifier: CoordinationVerifier;
  private readonly planner: CoordinationPlanner;
  private readonly teamBuilder: CoordinationTeamBuilder;
  private readonly recoveryPolicy: CoordinationRecoveryPolicy;
  private readonly catalog: CoordinationAgentCatalog | undefined;

  constructor(
    private readonly store: CoordinationStore,
    private readonly executor: CoordinationExecutor,
    private readonly events: CoordinationEventSink,
    options: CoordinationServiceOptions = {},
  ) {
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? uuidGenerator;
    this.artifacts = options.artifacts ?? new NoopCoordinationArtifactRepository();
    this.verifier = options.verifier ?? new MechanicalCoordinationVerifier();
    this.planner = options.planner ?? new FoundationCoordinationPlanner();
    this.teamBuilder = options.teamBuilder ?? new ParticipantOrderTeamBuilder();
    this.recoveryPolicy =
      options.recoveryPolicy ?? new StopCoordinationRecoveryPolicy();
    this.catalog = options.catalog;
  }

  async initialize(): Promise<void> {
    const interrupted = this.store
      .listSessions()
      .filter((session) =>
        ["forming_team", "executing", "verifying", "recovering"].includes(
          session.status,
        ),
      );
    for (const session of interrupted) {
      const completedAt = this.clock.now();
      await this.store.updateSession(session.id, (stored) => {
        stored.status = "cancelled";
        stored.completedAt = completedAt;
        stored.failureReason = "Server restarted while this Session was active";
      });
      await this.store.cancelSessionWork(session.id, completedAt);
      await this.emit(session.id, "session.cancelled", { reason: "server_restart" });
    }
  }

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

  getArtifactContent(sessionId: string, artifactId: string) {
    return this.artifacts.readArtifact(sessionId, artifactId);
  }

  getMetrics(sessionId: string) {
    const session = this.store.getSession(sessionId);
    return projectCoordinationMetrics(
      session,
      this.store.getTasks(sessionId),
      this.store.getAttempts(sessionId),
      this.store.getArtifacts(sessionId),
      this.store.getEvents(sessionId),
      this.clock.now(),
    );
  }

  async createSession(
    value: CreateCoordinationSessionInput,
  ): Promise<{ session: CoordinationSession; tasks: TaskNode[] }> {
    const input = createCoordinationSessionInputSchema.parse(value);
    const plan = validatePlannerOutput(
      await this.planner.plan({
        userTask: input.userTask,
        participantAgentIds: input.participantAgentIds,
        ...(input.workflow ? { workflow: input.workflow } : {}),
      }),
      input.participantAgentIds,
    );
    const candidates = this.catalog?.resolve(input.participantAgentIds);
    const team = validateTeamBuilderOutput(
      await this.teamBuilder.select({
        userTask: input.userTask,
        plan,
        candidateAgentIds: input.participantAgentIds,
        ...(candidates ? { candidates } : {}),
      }),
      plan,
      input.participantAgentIds,
    );
    const createdAt = this.clock.now();
    const taskIds = new Map(plan.tasks.map((task) => [task.key, this.ids.next()]));
    // User-fixed assignments are authoritative and must not be overwritten by the
    // Team Builder; dynamic assignments only fill the un-fixed remainder.
    const assignments = new Map(
      plan.tasks
        .filter((task) => task.assignedAgentId)
        .map((task) => [task.key, task.assignedAgentId!]),
    );
    for (const assignment of team.assignments) {
      assignments.set(assignment.taskKey, assignment.agentId);
    }
    const session: CoordinationSession = {
      id: this.ids.next(),
      userTask: input.userTask,
      status: "planning",
      topology: plan.topology,
      participantAgentIds: team.participantAgentIds,
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
      planKey: task.key,
      title: task.title,
      instructions: task.instructions,
      dependencies: task.dependencies.map((key) => taskIds.get(key)!),
      requiredCapabilities: task.requiredCapabilities,
      acceptanceCriteria: task.acceptanceCriteria,
      status: "pending",
      ...(assignments.has(task.key)
        ? { assignedAgentId: assignments.get(task.key)! }
        : {}),
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
    for (const [taskKey, agentId] of assignments) {
      await this.emit(
        session.id,
        "agent.selected",
        {
          taskKey,
          source: taskIds.has(taskKey) && plan.tasks.some((task) => task.key === taskKey && task.assignedAgentId)
            ? "user_constraint"
            : "team_builder",
          explanation: team.explanation,
        },
        {
          taskId: taskIds.get(taskKey),
          agentId,
        },
      );
    }
    return { session, tasks };
  }

  async startSession(id: string): Promise<CoordinationSession> {
    const startedAt = this.clock.now();
    const { session, started } = await this.store.startSession(id, startedAt);
    if (!started) return session;
    await this.emit(id, "session.started", {});
    this.launchExecution(id);
    return session;
  }

  private launchExecution(id: string): void {
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
  }

  async stopSession(id: string): Promise<CoordinationSession> {
    const current = this.store.getSession(id);
    if (current.status === "cancelled") return current;
    if (["completed", "failed"].includes(current.status)) {
      throw new HttpError(409, `Cannot stop a ${current.status} Session`);
    }

    this.abortControllers.get(id)?.abort();
    const attemptIds = [...(this.activeAttemptIds.get(id) ?? [])];
    if (attemptIds.length > 0) {
      await Promise.all(attemptIds.map((attemptId) => this.executor.cancel(attemptId)));
    }
    const completedAt = this.clock.now();
    const session = await this.store.updateSession(id, (stored) => {
      stored.status = "cancelled";
      stored.completedAt = completedAt;
    });
    await this.store.cancelSessionWork(id, completedAt);
    await this.emit(id, "session.cancelled", {});
    return session;
  }

  async approveSession(id: string, reason: string): Promise<CoordinationSession> {
    const current = this.store.getSession(id);
    if (current.status !== "waiting_approval") {
      throw new HttpError(409, `Cannot approve a ${current.status} Session`);
    }
    const approvedAt = this.clock.now();
    await this.store.updateSession(id, (stored) => {
      stored.status = "executing";
      delete stored.failureReason;
    });
    await this.store.mutateTasks(id, (task) => {
      if (task.status === "failed") {
        task.status = "pending";
        task.updatedAt = approvedAt;
      }
    });
    await this.emit(id, "session.approved", { reason: reason.slice(0, 2_000) });
    this.launchExecution(id);
    return this.store.getSession(id);
  }

  async rejectSession(id: string, reason: string): Promise<CoordinationSession> {
    const current = this.store.getSession(id);
    if (current.status !== "waiting_approval") {
      throw new HttpError(409, `Cannot reject a ${current.status} Session`);
    }
    const completedAt = this.clock.now();
    await this.store.updateSession(id, (stored) => {
      stored.status = "failed";
      stored.failureReason = (reason || "Approval rejected").slice(0, 2_000);
      stored.completedAt = completedAt;
    });
    await this.store.blockUnfinishedTasks(id, completedAt);
    await this.emit(id, "session.rejected", { reason: (reason || "Approval rejected").slice(0, 2_000) });
    return this.store.getSession(id);
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
        const isTerminal = (task: TaskNode): boolean =>
          task.status === "succeeded" || task.status === "superseded";
        if (tasks.every(isTerminal)) {
          const completedAt = this.clock.now();
          await this.store.updateSession(sessionId, (stored) => {
            stored.status = "completed";
            stored.completedAt = completedAt;
          });
          const succeededCount = tasks.filter(
            (task) => task.status === "succeeded",
          ).length;
          await this.emit(sessionId, "session.completed", {
            completedTaskCount: succeededCount,
          });
          return;
        }
        const failedTask = tasks.find((task) => task.status === "failed");
        if (failedTask) {
          const recovered = await this.recoverTask(session, failedTask, signal);
          if (recovered) continue;
          return;
        }

        const succeeded = new Set(
          tasks.filter((task) => task.status === "succeeded").map((task) => task.id),
        );
        const ready = computeReadyTasks(tasks, succeeded);
        if (ready.length === 0) {
          await this.failSession(sessionId, "No executable task remains");
          return;
        }
        await Promise.all(
          ready
            .slice(0, session.budget.maxConcurrentTasks)
            .map((task) => this.executeTask(session, task, signal)),
        );
        if (signal.aborted) return;
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
      task.assignedAgentId ??
      session.participantAgentIds[
        task.attemptCount % Math.max(session.participantAgentIds.length, 1)
      ];
    const previousAttempt = this.store
      .getAttempts(session.id)
      .filter((item) => item.taskId === task.id)
      .at(-1);
    const attempt: TaskAttempt = {
      id: this.ids.next(),
      sessionId: session.id,
      taskId: task.id,
      status: "created",
      createdAt: this.clock.now(),
      ...(agentId ? { agentId } : {}),
      ...(previousAttempt?.status === "failed"
        ? { retryOfAttemptId: previousAttempt.id }
        : {}),
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
    const sessionAttempts = this.activeAttemptIds.get(session.id) ?? new Set<string>();
    sessionAttempts.add(attempt.id);
    this.activeAttemptIds.set(session.id, sessionAttempts);
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
    const request: TaskExecutionRequest = {
      session,
      task: runningTask,
      attempt: runningAttempt,
      dependencyContext: this.getDependencyContext(session.id, runningTask),
    };
    try {
      result = await this.executor.execute(request, signal);
    } catch (error) {
      result = {
        status: "failed",
        failureClass: "tool_error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (result.status === "succeeded") {
      result = await this.captureAndVerify(
        session,
        runningTask,
        runningAttempt,
        request.dependencyContext,
        result,
      );
    }
    if (signal.aborted || this.store.getSession(session.id).status === "cancelled") return;
    await this.finishAttempt(session.id, runningTask, runningAttempt, result);
    this.activeAttemptIds.get(session.id)?.delete(attempt.id);
  }

  private async captureAndVerify(
    session: CoordinationSession,
    task: TaskNode,
    attempt: TaskAttempt,
    dependencyContext: TaskDependencyContext[],
    result: Extract<TaskExecutionResult, { status: "succeeded" }>,
  ): Promise<TaskExecutionResult> {
    const correlation = {
      taskId: task.id,
      attemptId: attempt.id,
      ...(attempt.agentId ? { agentId: attempt.agentId } : {}),
      ...(result.runId ? { runId: result.runId } : {}),
    };
    try {
      const verifyingAt = this.clock.now();
      await this.store.updateTask(task.id, (stored) => {
        if (stored.status !== "running") {
          throw new HttpError(409, "Task is no longer running");
        }
        stored.status = "verifying";
        stored.updatedAt = verifyingAt;
      });
      await this.store.updateAttempt(attempt.id, (stored) => {
        if (result.runId) stored.runId = result.runId;
        if (result.usage) stored.usage = result.usage;
      });
      await this.store.updateSession(session.id, (stored) => {
        if (stored.status === "executing") stored.status = "verifying";
      });
      await this.emit(session.id, "verification.started", {}, correlation);

      const capture = await this.artifacts.capture(
        { session, task, attempt, dependencyContext },
        result.output,
      );
      if (capture.status === "rejected") {
        await this.restoreExecutingStatus(session.id, task.id);
        await this.emit(
          session.id,
          "verification.failed",
          { error: capture.error, failureClass: capture.failureClass },
          correlation,
        );
        return {
          status: "failed",
          failureClass: capture.failureClass,
          error: capture.error,
          ...(result.runId ? { runId: result.runId } : {}),
        };
      }

      for (const artifact of capture.artifacts) {
        await this.emit(
          session.id,
          "artifact.created",
          {
            artifactId: artifact.id,
            type: artifact.type,
            sourcePath: artifact.sourcePath ?? null,
            contentHash: artifact.contentHash,
          },
          correlation,
        );
      }
      const verification = await this.verifier.verify({
        session,
        task,
        attempt,
        artifacts: capture.artifacts,
        output: result.output,
      });
      const artifactIds = capture.artifacts.map((artifact) => artifact.id);
      if (verification.status === "accepted") {
        await this.store.setArtifactVerification(artifactIds, "accepted");
        for (const artifact of capture.artifacts) {
          await this.emit(
            session.id,
            "artifact.accepted",
            { artifactId: artifact.id, contentHash: artifact.contentHash },
            correlation,
          );
        }
        await this.emit(
          session.id,
          "verification.passed",
          { evidence: verification.evidence },
          correlation,
        );
        await this.restoreExecutingStatus(session.id, task.id);
        return result;
      }

      await this.store.setArtifactVerification(artifactIds, "rejected");
      for (const artifact of capture.artifacts) {
        await this.emit(
          session.id,
          "artifact.rejected",
          { artifactId: artifact.id, contentHash: artifact.contentHash },
          correlation,
        );
      }
      const error = `Verification rejected: ${verification.evidence.join("; ")}`.slice(
        0,
        2_000,
      );
      await this.emit(
        session.id,
        "verification.failed",
        { error, failureClass: verification.failureClass },
        correlation,
      );
      await this.restoreExecutingStatus(session.id, task.id);
      return {
        status: "failed",
        failureClass: verification.failureClass,
        error,
        ...(result.runId ? { runId: result.runId } : {}),
      };
    } catch (error) {
      await this.restoreExecutingStatus(session.id, task.id);
      const message = (error instanceof Error ? error.message : String(error)).slice(
        0,
        2_000,
      );
      await this.emit(
        session.id,
        "verification.failed",
        { error: message, failureClass: "tool_error" },
        correlation,
      );
      return {
        status: "failed",
        failureClass: "tool_error",
        error: message,
        ...(result.runId ? { runId: result.runId } : {}),
      };
    }
  }

  private async restoreExecutingStatus(sessionId: string, taskId: string): Promise<void> {
    await this.store.updateSession(sessionId, (stored) => {
      if (stored.status !== "verifying") return;
      const stillVerifying = this.store
        .getTasks(sessionId)
        .some((task) => task.status === "verifying" && task.id !== taskId);
      if (!stillVerifying) stored.status = "executing";
    });
  }

  private async finishAttempt(
    sessionId: string,
    task: TaskNode,
    attempt: TaskAttempt,
    result: TaskExecutionResult,
  ): Promise<void> {
    const completedAt = this.clock.now();
    const correlation = {
      taskId: task.id,
      attemptId: attempt.id,
      ...(attempt.agentId ? { agentId: attempt.agentId } : {}),
      ...(result.runId ? { runId: result.runId } : {}),
    };
    if (result.status === "succeeded") {
      await this.store.updateAttempt(attempt.id, (stored) => {
        stored.status = "succeeded";
        stored.completedAt = completedAt;
        if (result.runId) stored.runId = result.runId;
        if (result.usage) stored.usage = result.usage;
        stored.workerOutput = result.output;
      });
      await this.store.updateTask(task.id, (stored) => {
        stored.status = "succeeded";
        stored.updatedAt = completedAt;
      });
      await this.emit(
        sessionId,
        "attempt.succeeded",
        { summary: result.output.summary },
        correlation,
      );
      await this.emit(
        sessionId,
        "task.succeeded",
        { title: task.title },
        correlation,
      );
      return;
    }

    await this.store.updateAttempt(attempt.id, (stored) => {
      stored.status = "failed";
      stored.completedAt = completedAt;
      stored.errorClass = result.failureClass;
      stored.errorMessage = result.error;
      if (result.runId) stored.runId = result.runId;
      if (result.usage) stored.usage = result.usage;
    });
    await this.store.updateTask(task.id, (stored) => {
      stored.status = "failed";
      stored.updatedAt = completedAt;
    });
    await this.emit(
      sessionId,
      "attempt.failed",
      { error: result.error, failureClass: result.failureClass },
      correlation,
    );
    await this.emit(
      sessionId,
      "task.failed",
      { title: task.title },
      correlation,
    );
  }

  private getDependencyContext(
    sessionId: string,
    task: TaskNode,
  ): TaskDependencyContext[] {
    if (task.dependencies.length === 0) return [];
    const tasks = new Map(
      this.store.getTasks(sessionId).map((stored) => [stored.id, stored]),
    );
    const attempts = this.store.getAttempts(sessionId);
    const artifacts = this.store.getArtifacts(sessionId);
    return task.dependencies.map((dependencyId) => {
      const dependency = tasks.get(dependencyId);
      if (!dependency) {
        throw new HttpError(409, "Task dependency no longer exists");
      }
      const attempt = attempts
        .filter(
          (stored) =>
            stored.taskId === dependencyId &&
            stored.status === "succeeded" &&
            stored.workerOutput,
        )
        .at(-1);
      if (!attempt?.workerOutput) {
        throw new HttpError(409, "Task dependency has no verified WorkerOutput");
      }
      return {
        task: dependency,
        attempt,
        artifacts: artifacts.filter(
          (artifact) =>
            artifact.attemptId === attempt.id &&
            artifact.verificationStatus === "accepted",
        ),
      };
    });
  }

  private async recoverTask(
    session: CoordinationSession,
    task: TaskNode,
    signal: AbortSignal,
  ): Promise<boolean> {
    const attempts = this.store
      .getAttempts(session.id)
      .filter((attempt) => attempt.taskId === task.id);
    const failedAttempt = attempts.at(-1);
    if (!failedAttempt || failedAttempt.status !== "failed") {
      throw new HttpError(409, "Failed Task has no failed Attempt");
    }
    const recoveringSession = await this.store.updateSession(session.id, (stored) => {
      stored.status = "recovering";
    });
    const request = {
      session: recoveringSession,
      task,
      failedAttempt,
      attempts,
      availableAgentIds: recoveringSession.participantAgentIds,
    };
    const decision = validateRecoveryDecision(
      await this.recoveryPolicy.decide(request, signal),
      request,
    );
    await this.emit(
      session.id,
      "recovery.decided",
      {
        action: decision.action,
        reason: decision.reason,
        nextAgentId: decision.nextAgentId ?? null,
      },
      {
        taskId: task.id,
        attemptId: failedAttempt.id,
        ...(failedAttempt.agentId ? { agentId: failedAttempt.agentId } : {}),
      },
    );

    if (decision.action === "stop") {
      await this.failSession(session.id, decision.reason);
      return false;
    }
    if (decision.action === "request_approval") {
      await this.store.updateSession(session.id, (stored) => {
        stored.status = "waiting_approval";
        stored.failureReason = decision.reason;
      });
      return false;
    }
    if (decision.action === "repair") {
      if (this.store.getTasks(session.id).length >= session.budget.maxTasks) {
        await this.failSession(session.id, "Repair would exceed the Task budget");
        return false;
      }
      await this.repairTask(session, task, failedAttempt, decision);
      return true;
    }
    if (decision.action === "replan") {
      if (this.store.getTasks(session.id).length >= session.budget.maxTasks) {
        await this.failSession(session.id, "Re-plan would exceed the Task budget");
        return false;
      }
      await this.replanSession(session, task, decision);
      return true;
    }

    await this.store.updateTask(task.id, (stored) => {
      stored.status = "pending";
      stored.updatedAt = this.clock.now();
      if (decision.action === "reassign") {
        stored.assignedAgentId = decision.nextAgentId!;
      }
    });
    await this.store.updateSession(session.id, (stored) => {
      stored.status = "executing";
      delete stored.failureReason;
    });
    await this.emit(
      session.id,
      decision.action === "reassign" ? "task.reassigned" : "task.retried",
      { reason: decision.reason, retryOfAttemptId: failedAttempt.id },
      {
        taskId: task.id,
        attemptId: failedAttempt.id,
        ...(decision.nextAgentId
          ? { agentId: decision.nextAgentId }
          : failedAttempt.agentId
            ? { agentId: failedAttempt.agentId }
            : {}),
      },
    );
    return true;
  }

  private async repairTask(
    session: CoordinationSession,
    task: TaskNode,
    failedAttempt: TaskAttempt,
    decision: RecoveryDecision,
  ): Promise<void> {
    const now = this.clock.now();
    const repairId = this.ids.next();
    const evidence = (failedAttempt.errorMessage ?? decision.reason).slice(0, 4_000);
    const repairTask: TaskNode = {
      id: repairId,
      sessionId: session.id,
      planKey: task.planKey ? `${task.planKey}--repair` : undefined,
      title: `${task.title} (repair)`,
      instructions: [
        task.instructions,
        "",
        "A previous attempt failed. Repair using this failure evidence:",
        evidence,
        "Original acceptance criteria still apply.",
      ]
        .join("\n")
        .slice(0, 10_000),
      dependencies: [...task.dependencies],
      requiredCapabilities: [...task.requiredCapabilities],
      acceptanceCriteria: task.acceptanceCriteria,
      status: "pending",
      ...(task.assignedAgentId ? { assignedAgentId: task.assignedAgentId } : {}),
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.createTasks(session.id, [repairTask]);
    await this.store.rewireDependencies(session.id, task.id, repairId);
    await this.store.updateTask(task.id, (stored) => {
      stored.status = "superseded";
      stored.updatedAt = now;
    });
    await this.store.updateSession(session.id, (stored) => {
      stored.status = "executing";
      delete stored.failureReason;
    });
    await this.emit(
      session.id,
      "task.repair_created",
      {
        reason: decision.reason,
        originalTaskId: task.id,
        repairTaskId: repairId,
        failureEvidence: evidence,
      },
      {
        taskId: task.id,
        attemptId: failedAttempt.id,
        ...(failedAttempt.agentId ? { agentId: failedAttempt.agentId } : {}),
      },
    );
  }

  private async replanSession(
    session: CoordinationSession,
    failedTask: TaskNode,
    decision: RecoveryDecision,
  ): Promise<void> {
    const now = this.clock.now();
    const plan = validatePlannerOutput(
      await this.planner.plan({
        userTask: session.userTask,
        participantAgentIds: session.participantAgentIds,
      }),
      session.participantAgentIds,
    );
    const tasks = this.store.getTasks(session.id);
    const existingByKey = new Map(
      tasks.filter((task) => task.planKey).map((task) => [task.planKey, task]),
    );
    const planKeys = new Set(plan.tasks.map((task) => task.key));
    const idByKey = new Map<string, string>();
    for (const task of tasks) {
      if (task.planKey) idByKey.set(task.planKey, task.id);
    }
    // Pre-mint ids for every newly planned Task before resolving dependencies so
    // that both existing and new Tasks can be referenced regardless of order.
    for (const planTask of plan.tasks) {
      if (!idByKey.has(planTask.key)) idByKey.set(planTask.key, this.ids.next());
    }

    const newTasks: TaskNode[] = [];
    for (const planTask of plan.tasks) {
      const existing = existingByKey.get(planTask.key);
      if (existing?.status === "succeeded") continue;
      if (existing) {
        await this.store.updateTask(existing.id, (stored) => {
          stored.instructions = planTask.instructions;
          stored.requiredCapabilities = planTask.requiredCapabilities;
          stored.acceptanceCriteria = planTask.acceptanceCriteria;
          stored.dependencies = planTask.dependencies.map((key) => idByKey.get(key)!);
          stored.status = "pending";
          stored.updatedAt = now;
          if (planTask.assignedAgentId) stored.assignedAgentId = planTask.assignedAgentId;
        });
      } else {
        const id = idByKey.get(planTask.key)!;
        newTasks.push({
          id,
          sessionId: session.id,
          planKey: planTask.key,
          title: planTask.title,
          instructions: planTask.instructions,
          dependencies: planTask.dependencies.map((key) => idByKey.get(key)!),
          requiredCapabilities: planTask.requiredCapabilities,
          acceptanceCriteria: planTask.acceptanceCriteria,
          status: "pending",
          ...(planTask.assignedAgentId ? { assignedAgentId: planTask.assignedAgentId } : {}),
          attemptCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    for (const task of tasks) {
      if (task.status !== "succeeded" && task.planKey && !planKeys.has(task.planKey)) {
        await this.store.updateTask(task.id, (stored) => {
          stored.status = "superseded";
          stored.updatedAt = now;
        });
      }
    }
    await this.store.createTasks(session.id, newTasks);
    await this.store.updateSession(session.id, (stored) => {
      stored.status = "executing";
      delete stored.failureReason;
    });
    await this.emit(
      session.id,
      "plan.revised",
      { reason: decision.reason, addedTaskCount: newTasks.length },
      { taskId: failedTask.id },
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
    await this.store.blockUnfinishedTasks(sessionId, completedAt);
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
