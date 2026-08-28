const baseUrl = (process.env.MOSAIC_BASE_URL ?? "http://localhost:3000").replace(
  /\/+$/,
  "",
);
const authToken = (process.env.APP_AUTH_TOKEN ?? "").trim();
const timeoutMs = Number(process.env.MOSAIC_VERIFY_TIMEOUT_MS ?? 60_000);
const participantAgentIds = (process.env.MOSAIC_AGENT_IDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

async function request(path, options = {}) {
  const response = await fetch(baseUrl + path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path}: ${response.status} ${body.error ?? "request failed"}`);
  }
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const system = await request("/api/system");
if (system.coordinationExecutor === "agent" && participantAgentIds.length === 0) {
  throw new Error(
    "Agent executor mode requires MOSAIC_AGENT_IDS=id1,id2 for this verification",
  );
}

const created = await request("/api/coordination/sessions", {
  method: "POST",
  body: JSON.stringify({
    userTask: "Deterministic MOSAIC acceptance: plan, deliver, and record evidence.",
    participantAgentIds,
  }),
});
const sessionId = created.session.id;
await request(`/api/coordination/sessions/${sessionId}/start`, { method: "POST" });

const deadline = Date.now() + timeoutMs;
let session;
do {
  ({ session } = await request(`/api/coordination/sessions/${sessionId}`));
  if (["completed", "failed", "cancelled"].includes(session.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
} while (Date.now() < deadline);

assert(session?.status === "completed", `Session ended as ${session?.status ?? "timeout"}`);
const [{ tasks }, { attempts }, { artifacts }, { events }, { metrics }] =
  await Promise.all([
    request(`/api/coordination/sessions/${sessionId}/tasks`),
    request(`/api/coordination/sessions/${sessionId}/attempts`),
    request(`/api/coordination/sessions/${sessionId}/artifacts`),
    request(`/api/coordination/sessions/${sessionId}/events`),
    request(`/api/coordination/sessions/${sessionId}/metrics`),
  ]);

assert(tasks.length > 0 && tasks.every((task) => task.status === "succeeded"), "Not every Task succeeded");
assert(attempts.length === tasks.length, "Expected one Attempt per foundation Task");
assert(
  events.filter((event) => event.type === "verification.passed").length === tasks.length,
  "Every Task must have persisted verification evidence",
);
assert(events.at(-1)?.type === "session.completed", "Timeline must end with session.completed");
assert(metrics.totalAttempts === attempts.length, "Metrics Attempt count is inconsistent");

console.log(
  JSON.stringify(
    {
      ok: true,
      executor: system.coordinationExecutor,
      sessionId,
      tasks: tasks.length,
      attempts: attempts.length,
      artifacts: artifacts.length,
      events: events.length,
      metrics,
    },
    null,
    2,
  ),
);
