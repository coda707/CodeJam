// Real-Agent integration check: exercises the full MOSAIC path through the
// existing AgentService instead of the Fake executor.
//
// Prerequisites (server already running):
//   1. .env with ARK_API_KEY and ARK_MODEL filled in.
//   2. COORDINATION_EXECUTOR=agent (so coordination uses real Agents).
//   3. server started, e.g. `npm run dev -w @launchpad/server`.
//
// Run:  node scripts/integration-real-agents.mjs
//
// Overridable via environment:
//   MOSAIC_BASE_URL   API origin (default http://localhost:3000)
//   APP_AUTH_TOKEN    bearer token, if the server requires one
//   MOSAIC_TASK       the userTask to coordinate (see default below)
const baseUrl = (process.env.MOSAIC_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const authToken = (process.env.APP_AUTH_TOKEN ?? "").trim();
const userTask =
  process.env.MOSAIC_TASK ??
  "Build three independent deliverables: a plan, an implementation, and a documented result.";

async function request(path, method = "GET", body) {
  const options = { method };
  const headers = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  options.headers = headers;
  const response = await fetch(baseUrl + path, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

const get = (path) => request(path, "GET");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function pollSession(sessionId, terminal) {
  for (let i = 0; i < 400; i += 1) {
    const { session } = await get(`/api/coordination/sessions/${sessionId}`);
    if (terminal.includes(session.status)) return session;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Session did not reach a terminal state in time");
}

// 1. Confirm the server is in real-Agent mode before doing anything.
const system = await get("/api/system");
assert(
  system.coordinationExecutor === "agent",
  `COORDINATION_EXECUTOR must be "agent" for this check (server reports "${system.coordinationExecutor}"). ` +
    "Set it in .env and restart.",
);
assert(
  system.arkConfigured === true,
  "Ark is not configured. Set ARK_API_KEY and ARK_MODEL in .env and restart.",
);
console.log("✓ server in agent mode, Ark configured");

// 2. Create three Agents with distinct capabilities so the capability-based
//    team builder assigns each parallel Task to the best match.
const agentSpecs = [
  {
    name: "Analyst",
    description: "analysis and requirements decomposition specialist",
    instructions: "You decompose requests and produce structured plans.",
  },
  {
    name: "Builder",
    description: "delivery and implementation specialist, writes and edits files",
    instructions: "You implement changes and write files into the workspace.",
  },
  {
    name: "Reporter",
    description: "reporting and documentation specialist",
    instructions: "You summarize work and record evidence.",
  },
];
const agents = [];
for (const spec of agentSpecs) {
  const { agent } = await request("/api/agents", "POST", spec);
  agents.push(agent);
  console.log(`✓ agent ${agent.id.slice(0, 8)}  ${agent.name}  (${agent.status})`);
}

// 3. Coordinate them.
const participantAgentIds = agents.map((agent) => agent.id);
const { session, tasks } = await request("/api/coordination/sessions", "POST", {
  userTask,
  participantAgentIds,
});
console.log(`✓ session ${session.id.slice(0, 8)}  topology=${session.topology}  tasks=${tasks.length}`);

// 4. Start and wait for a terminal state.
await request(`/api/coordination/sessions/${session.id}/start`, "POST");
const finished = await pollSession(session.id, ["completed", "failed", "cancelled"]);
console.log(`\nfinal status: ${finished.status}${finished.failureReason ? ` — ${finished.failureReason}` : ""}`);

// 5. Pull the full evidence chain.
const [{ attempts }, { artifacts }, { events }, { metrics }] = await Promise.all([
  get(`/api/coordination/sessions/${session.id}/attempts`),
  get(`/api/coordination/sessions/${session.id}/artifacts`),
  get(`/api/coordination/sessions/${session.id}/events`),
  get(`/api/coordination/sessions/${session.id}/metrics`),
]);

const taskById = new Map(tasks.map((task) => [task.id, task]));
const agentById = new Map(agents.map((agent) => [agent.id, agent.name]));

console.log("\n— attempts —");
for (const attempt of attempts) {
  const title = taskById.get(attempt.taskId)?.title ?? attempt.taskId;
  const agentName = attempt.agentId ? agentById.get(attempt.agentId) ?? attempt.agentId.slice(0, 8) : "—";
  console.log(
    `  ${attempt.status.padEnd(9)}  ${title.padEnd(26)}  agent=${agentName.padEnd(10)}  run=${attempt.runId ? attempt.runId.slice(0, 8) : "—"}${attempt.errorClass ? `  ${attempt.errorClass}` : ""}`,
  );
}

console.log("\n— artifacts —");
if (artifacts.length === 0) {
  console.log("  (none captured — the Agents did not report any artifactPaths)");
} else {
  for (const artifact of artifacts) {
    console.log(
      `  ${artifact.verificationStatus.padEnd(10)}  ${artifact.sourcePath ?? artifact.path}  sha256=${artifact.contentHash.slice(0, 12)}…`,
    );
  }
}

const recovery = events.filter((event) =>
  ["recovery.decided", "task.retried", "task.reassigned", "session.approved", "session.rejected"].includes(event.type),
);
console.log("\n— recovery / approval —");
console.log(
  recovery.length
    ? recovery.map((event) => `  ${event.type}${event.payload?.action ? `(${event.payload.action})` : ""}`).join("\n")
    : "  (none)",
);

console.log("\n— metrics —");
console.log(
  `  tasks=${metrics.totalTasks}  attempts=${metrics.totalAttempts}  agentCalls=${metrics.totalAgentCalls}` +
    `  acceptedArtifacts=${metrics.acceptedArtifacts}  failedAttempts=${metrics.failedAttempts}` +
    `  duration=${metrics.durationMs}ms  recovery=${metrics.recoveryStatus}`,
);

// 6. Show real Agent Run correlation and token usage.
console.log("\n— agent runs —");
for (const agent of agents) {
  const { runs } = await get(`/api/agents/${agent.id}/runs`);
  const recent = runs.slice(-3);
  for (const run of recent) {
    const usage = run.usage
      ? `in=${run.usage.inputTokens ?? 0} out=${run.usage.outputTokens ?? 0}`
      : "no usage";
    console.log(
      `  ${agent.name.padEnd(10)}  run=${run.id.slice(0, 8)}  ${run.status.padEnd(9)}  ${usage}`,
    );
  }
  if (recent.length === 0) console.log(`  ${agent.name.padEnd(10)}  (no runs)`);
}

assert(
  finished.status === "completed",
  `Session ended as ${finished.status} — see the error above for the failing Task.`,
);
console.log("\n✓ real-Agent integration passed");
