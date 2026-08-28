import { HttpError } from "../errors.js";
import type { JsonStore } from "../store.js";
import type {
  CoordinationArtifact,
  CoordinationEvent,
  CoordinationSession,
  TaskAttempt,
  TaskNode,
} from "./contracts.js";

export class CoordinationStore {
  constructor(private readonly store: JsonStore) {}

  listSessions(): CoordinationSession[] {
    return this.store
      .snapshot()
      .coordinationSessions.sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      );
  }

  getSession(id: string): CoordinationSession {
    const session = this.store
      .snapshot()
      .coordinationSessions.find((item) => item.id === id);
    if (!session) throw new HttpError(404, "Coordination Session not found");
    return session;
  }

  getTasks(sessionId: string): TaskNode[] {
    this.getSession(sessionId);
    return this.store
      .snapshot()
      .coordinationTasks.filter((task) => task.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getTask(id: string): TaskNode {
    const task = this.store.snapshot().coordinationTasks.find((item) => item.id === id);
    if (!task) throw new HttpError(404, "Coordination Task not found");
    return task;
  }

  getAttempts(sessionId: string): TaskAttempt[] {
    this.getSession(sessionId);
    return this.store
      .snapshot()
      .coordinationAttempts.filter((attempt) => attempt.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getAttempt(id: string): TaskAttempt {
    const attempt = this.store
      .snapshot()
      .coordinationAttempts.find((item) => item.id === id);
    if (!attempt) throw new HttpError(404, "Task Attempt not found");
    return attempt;
  }

  getArtifacts(sessionId: string): CoordinationArtifact[] {
    this.getSession(sessionId);
    return this.store
      .snapshot()
      .coordinationArtifacts.filter((artifact) => artifact.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getEvents(sessionId: string): CoordinationEvent[] {
    this.getSession(sessionId);
    return this.store
      .snapshot()
      .coordinationEvents.filter((event) => event.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async createSession(
    session: CoordinationSession,
    tasks: TaskNode[],
  ): Promise<void> {
    await this.store.mutate((database) => {
      database.coordinationSessions.push(session);
      database.coordinationTasks.push(...tasks);
    });
  }

  async updateSession(
    id: string,
    mutation: (session: CoordinationSession) => void,
  ): Promise<CoordinationSession> {
    return this.store.mutate((database) => {
      const session = database.coordinationSessions.find((item) => item.id === id);
      if (!session) throw new HttpError(404, "Coordination Session not found");
      mutation(session);
      return structuredClone(session);
    });
  }

  async startSession(
    id: string,
    startedAt: string,
  ): Promise<{ session: CoordinationSession; started: boolean }> {
    return this.store.mutate((database) => {
      const session = database.coordinationSessions.find((item) => item.id === id);
      if (!session) throw new HttpError(404, "Coordination Session not found");
      if (session.status === "executing") {
        return { session: structuredClone(session), started: false };
      }
      if (["completed", "failed", "cancelled"].includes(session.status)) {
        throw new HttpError(409, `Cannot start a ${session.status} Session`);
      }
      session.status = "executing";
      session.startedAt = startedAt;
      return { session: structuredClone(session), started: true };
    });
  }

  async updateTask(
    id: string,
    mutation: (task: TaskNode) => void,
  ): Promise<TaskNode> {
    return this.store.mutate((database) => {
      const task = database.coordinationTasks.find((item) => item.id === id);
      if (!task) throw new HttpError(404, "Coordination Task not found");
      mutation(task);
      return structuredClone(task);
    });
  }

  async createAttempt(attempt: TaskAttempt): Promise<void> {
    await this.store.mutate((database) => {
      if (database.coordinationAttempts.some((item) => item.id === attempt.id)) {
        throw new HttpError(409, "Task Attempt already exists");
      }
      database.coordinationAttempts.push(attempt);
    });
  }

  async updateAttempt(
    id: string,
    mutation: (attempt: TaskAttempt) => void,
  ): Promise<TaskAttempt> {
    return this.store.mutate((database) => {
      const attempt = database.coordinationAttempts.find((item) => item.id === id);
      if (!attempt) throw new HttpError(404, "Task Attempt not found");
      mutation(attempt);
      return structuredClone(attempt);
    });
  }

  async appendEvent(event: CoordinationEvent): Promise<void> {
    await this.store.mutate((database) => {
      const session = database.coordinationSessions.find(
        (item) => item.id === event.sessionId,
      );
      if (!session) throw new HttpError(404, "Coordination Session not found");
      const sessionEvents = database.coordinationEvents.filter(
        (item) => item.sessionId === event.sessionId,
      );
      if (sessionEvents.length >= session.budget.maxEvents) {
        const oldest = sessionEvents[0];
        if (oldest) {
          database.coordinationEvents = database.coordinationEvents.filter(
            (item) => item.id !== oldest.id,
          );
        }
      }
      database.coordinationEvents.push(event);
    });
  }

  async cancelSessionWork(sessionId: string, completedAt: string): Promise<void> {
    await this.store.mutate((database) => {
      for (const task of database.coordinationTasks) {
        if (
          task.sessionId === sessionId &&
          ["pending", "ready", "leased", "running", "verifying"].includes(task.status)
        ) {
          task.status = "blocked";
          task.updatedAt = completedAt;
        }
      }
      for (const attempt of database.coordinationAttempts) {
        if (
          attempt.sessionId === sessionId &&
          ["created", "running"].includes(attempt.status)
        ) {
          attempt.status = "cancelled";
          attempt.completedAt = completedAt;
          attempt.errorMessage = "Coordination Session was stopped";
        }
      }
    });
  }

  async blockUnfinishedTasks(sessionId: string, updatedAt: string): Promise<void> {
    await this.store.mutate((database) => {
      for (const task of database.coordinationTasks) {
        if (
          task.sessionId === sessionId &&
          ["pending", "ready", "leased", "running", "verifying"].includes(task.status)
        ) {
          task.status = "blocked";
          task.updatedAt = updatedAt;
        }
      }
    });
  }
}
