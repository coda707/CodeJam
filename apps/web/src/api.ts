import type {
  Agent,
  AgentRun,
  CoordinationArtifact,
  CoordinationAttempt,
  CoordinationEvent,
  CoordinationSession,
  CoordinationTask,
  CoordinationMetrics,
  CreateCoordinationSessionInput,
  Message,
  SystemInfo,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

let authToken = "";

export function setAuthToken(token: string): void {
  authToken = token.trim();
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = {
    ...(options?.body ? { "Content-Type": "application/json" } : {}),
    ...(authToken ? { Authorization: "Bearer " + authToken } : {}),
    ...options?.headers,
  };
  const response = await fetch(url, {
    ...options,
    headers,
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new ApiError(data.error ?? "Request failed", response.status);
  }
  return data;
}

export const api = {
  auth: () => request<{ required: boolean }>("/api/auth"),
  system: () => request<SystemInfo>("/api/system"),
  listAgents: () => request<{ agents: Agent[] }>("/api/agents"),
  createAgent: (body: {
    name: string;
    description: string;
    instructions: string;
  }) =>
    request<{ agent: Agent }>("/api/agents", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateAgent: (
    id: string,
    body: { name: string; description: string; instructions: string },
  ) =>
    request<{ agent: Agent }>("/api/agents/" + id, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteAgent: (id: string) =>
    request<{ archivedWorkspace: string }>("/api/agents/" + id, {
      method: "DELETE",
    }),
  startAgent: (id: string) =>
    request<{ agent: Agent }>("/api/agents/" + id + "/start", {
      method: "POST",
    }),
  stopAgent: (id: string) =>
    request<{ agent: Agent }>("/api/agents/" + id + "/stop", {
      method: "POST",
    }),
  messages: (id: string) =>
    request<{ messages: Message[] }>("/api/agents/" + id + "/messages"),
  runs: (id: string) =>
    request<{ runs: AgentRun[] }>("/api/agents/" + id + "/runs"),
  sendMessage: (id: string, content: string) =>
    request<{ run: AgentRun; message: Message }>(
      "/api/agents/" + id + "/messages",
      {
        method: "POST",
        body: JSON.stringify({ content }),
      },
    ),
  run: (id: string) => request<{ run: AgentRun }>("/api/runs/" + id),
  coordinationSessions: () =>
    request<{ sessions: CoordinationSession[] }>("/api/coordination/sessions"),
  createCoordinationSession: (body: CreateCoordinationSessionInput) =>
    request<{ session: CoordinationSession; tasks: CoordinationTask[] }>(
      "/api/coordination/sessions",
      { method: "POST", body: JSON.stringify(body) },
    ),
  coordinationSession: (id: string) =>
    request<{ session: CoordinationSession }>(`/api/coordination/sessions/${id}`),
  startCoordinationSession: (id: string) =>
    request<{ session: CoordinationSession }>(
      `/api/coordination/sessions/${id}/start`,
      { method: "POST" },
    ),
  stopCoordinationSession: (id: string) =>
    request<{ session: CoordinationSession }>(
      `/api/coordination/sessions/${id}/stop`,
      { method: "POST" },
    ),
  approveCoordinationSession: (id: string, reason: string) =>
    request<{ session: CoordinationSession }>(
      `/api/coordination/sessions/${id}/approve`,
      { method: "POST", body: JSON.stringify({ reason }) },
    ),
  rejectCoordinationSession: (id: string, reason: string) =>
    request<{ session: CoordinationSession }>(
      `/api/coordination/sessions/${id}/reject`,
      { method: "POST", body: JSON.stringify({ reason }) },
    ),
  coordinationTasks: (id: string) =>
    request<{ tasks: CoordinationTask[] }>(
      `/api/coordination/sessions/${id}/tasks`,
    ),
  coordinationAttempts: (id: string) =>
    request<{ attempts: CoordinationAttempt[] }>(
      `/api/coordination/sessions/${id}/attempts`,
    ),
  coordinationEvents: (id: string) =>
    request<{ events: CoordinationEvent[] }>(
      `/api/coordination/sessions/${id}/events`,
    ),
  coordinationArtifacts: (id: string) =>
    request<{ artifacts: CoordinationArtifact[] }>(
      `/api/coordination/sessions/${id}/artifacts`,
    ),
  coordinationArtifactContent: (sessionId: string, artifactId: string) =>
    request<{ content: string; sourcePath?: string; contentHash: string }>(
      `/api/coordination/sessions/${sessionId}/artifacts/${artifactId}/content`,
    ),
  coordinationMetrics: (id: string) =>
    request<{ metrics: CoordinationMetrics }>(
      `/api/coordination/sessions/${id}/metrics`,
    ),
};
