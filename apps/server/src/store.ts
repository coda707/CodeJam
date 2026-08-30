import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "./types.js";

const emptyDatabase = (): Database => ({
  version: 1,
  agents: [],
  messages: [],
  runs: [],
  coordinationSessions: [],
  coordinationTasks: [],
  coordinationAttempts: [],
  coordinationArtifacts: [],
  coordinationEvents: [],
});

const normalizeDatabase = (database: Database): Database => ({
  ...database,
  messages: Array.isArray(database.messages)
    ? database.messages.map((message) =>
        message.purpose ? message : { ...message, purpose: "playground" as const },
      )
    : [],
  runs: Array.isArray(database.runs)
    ? database.runs.map((run) => ({
        ...run,
        purpose: run.purpose ?? ("playground" as const),
        threadId: run.threadId ?? null,
      }))
    : [],
  coordinationSessions: Array.isArray(database.coordinationSessions)
    ? database.coordinationSessions
    : [],
  coordinationTasks: Array.isArray(database.coordinationTasks)
    ? database.coordinationTasks
    : [],
  coordinationAttempts: Array.isArray(database.coordinationAttempts)
    ? database.coordinationAttempts
    : [],
  coordinationArtifacts: Array.isArray(database.coordinationArtifacts)
    ? database.coordinationArtifacts
    : [],
  coordinationEvents: Array.isArray(database.coordinationEvents)
    ? database.coordinationEvents
    : [],
});

export class JsonStore {
  private data: Database = emptyDatabase();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Database;
      if (parsed.version !== 1 || !Array.isArray(parsed.agents)) {
        throw new Error("Unsupported database format");
      }
      this.data = normalizeDatabase(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      await this.persist();
    }
  }

  snapshot(): Database {
    return structuredClone(this.data);
  }

  async mutate<T>(mutation: (database: Database) => T | Promise<T>): Promise<T> {
    let result!: T;
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.data);
      result = await mutation(next);
      await this.persist(next);
      this.data = next;
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  private async persist(data: Database = this.data): Promise<void> {
    const temporaryPath = this.filePath + ".tmp";
    await writeFile(temporaryPath, JSON.stringify(data, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}
