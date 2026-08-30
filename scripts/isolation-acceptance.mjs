// Isolation acceptance check (Developer B): a MOSAIC coordination Run must never
// contaminate the same Agent's Playground thread or transcript.
//
// Sequence:
//   1. Confirm real-Agent mode + Ark.
//   2. Create one Agent and record its initial Playground state.
//   3. Run a small coordination session on that Agent.
//   4. Assert the Agent's transcript is still empty and codexThreadId still null.
//   5. Send a Playground greeting and assert the transcript holds ONLY that
//      greeting (never the Worker prompt), and codexThreadId becomes a fresh,
//      non-coordination thread.
//
// Prerequisites (server already running):
//   1. .env with ARK_API_KEY and ARK_MODEL filled in.
//   2. COORDINATION_EXECUTOR=agent.
//   3. server started, e.g. `npm run dev -w @launchpad/server`.
//
// Run:  node scripts/isolation-acceptance.mjs
//
// Overridable via environment:
//   MOSAIC_BASE_URL   API origin (default http://localhost:3000)
//   APP_AUTH_TOKEN    bearer token, if the server requires one
const baseUrl = (process.env.MOSAIC_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const authToken = (process.env.APP_AUTH_TOKEN ?? "").trim();

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
  if (!condition) throw new Error(message);
}

async function pollSession(sessionId, terminal) {
  for (let i = 0; i < 400; i += 1) {
    const { session } = await get(`/api/coordination/sessions/${sessionId}`);
    if (terminal.includes(session.status)) return session;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Session did not reach a terminal state in time");
}

async function pollMessages(agentId, minimum, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { messages } = await get(`/api/agents/${agentId}/messages`);
    if (messages.length >= minimum) return messages;
    if (Date.now() > deadline) throw new Error("Timed out waiting for Playground reply");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// 1. Confirm real-Agent mode and Ark configuration.
const system = await get("/api/system");
assert(
  system.coordinationExecutor === "agent",
  `COORDINATION_EXECUTOR must be "agent" for this check (server reports "${system.coordinationExecutor}").`,
);
assert(system.arkConfigured === true, "Ark is not configured. Set ARK_API_KEY and ARK_MODEL in .env.");
console.log("✓ server in agent mode, Ark configured");

// 2. Create one Agent and record its initial Playground state.
const { agent } = await request("/api/agents", "POST", {
  name: "Isolation Probe",
  description: "used to prove coordination never pollutes the Playground",
  instructions: "You are a probe Agent. Answer Playground greetings normally.",
});
const agentId = agent.id;
console.log(`✓ agent ${agentId.slice(0, 8)}  ${agent.name}`);

let snapshot = await get(`/api/agents/${agentId}`);
let transcript = await get(`/api/agents/${agentId}/messages`);
assert(snapshot.agent.codexThreadId === null, "fresh Agent must start with a null Playground thread");
assert(transcript.messages.length === 0, "fresh Agent must start with an empty transcript");
console.log("✓ initial Playground state: no thread, no messages");

// 3. Run a coordination session on that Agent.
const { session } = await request("/api/coordination/sessions", "POST", {
  userTask: "Report the word READY to prove the coordination path executes.",
  participantAgentIds: [agentId],
  workflow: {
    tasks: [
      {
        key: "probe",
        title: "Coordination probe",
        instructions:
          'Return exactly: {"summary":"READY","artifactPaths":[],"evidence":["READY"],"unresolvedIssues":[]}.',
        acceptanceCriteria: [
          { id: "probe", kind: "artifact", value: "worker-output", description: "Reported READY" },
        ],
        assignedAgentId: agentId,
      },
    ],
  },
});
console.log(`✓ coordination session ${session.id.slice(0, 8)} started`);
await request(`/api/coordination/sessions/${session.id}/start`, "POST");
const finished = await pollSession(session.id, ["completed", "failed", "cancelled"]);
console.log(`✓ coordination finished: ${finished.status}`);

// 4. Assert isolation: coordination left no trace in the Playground.
snapshot = await get(`/api/agents/${agentId}`);
transcript = await get(`/api/agents/${agentId}/messages`);
assert(snapshot.agent.codexThreadId === null, "coordination must not set the Playground codexThreadId");
assert(transcript.messages.length === 0, "coordination must not write Playground messages");
console.log("✓ after coordination: thread still null, transcript still empty (isolated)");

// 5. Send a Playground greeting and confirm it is the only thing in the transcript.
const greeting = "Hello! This is a Playground greeting, not a coordination task.";
await request(`/api/agents/${agentId}/messages`, "POST", { content: greeting });
const messages = await pollMessages(agentId, 2);
assert(messages.length === 2, `expected exactly 2 Playground messages, saw ${messages.length}`);
assert(messages[0].role === "user", "first Playground message must be the user greeting");
assert(messages[0].content === greeting, "Playground user message must be the greeting verbatim");
assert(messages[1].role === "assistant", "second Playground message must be the assistant reply");
for (const message of messages) {
  assert(
    !/MOSAIC coordination session|WorkerOutput|Verified dependency context/.test(message.content),
    "a coordination Worker prompt must never appear in the Playground transcript",
  );
}
console.log("✓ Playground transcript holds only the greeting + reply (no Worker prompt leakage)");

snapshot = await get(`/api/agents/${agentId}`);
assert(snapshot.agent.codexThreadId !== null, "Playground greeting must create a fresh thread id");
console.log(`✓ Playground codexThreadId is now a fresh thread (${snapshot.agent.codexThreadId.slice(0, 8)}…)`);

// 6. Corroborate with the Run records: coordination runs carry purpose/correlation,
//    the Playground run does not.
const { runs } = await get(`/api/agents/${agentId}/runs`);
const coordinationRuns = runs.filter((run) => run.purpose === "coordination");
const playgroundRuns = runs.filter((run) => run.purpose === "playground");
assert(coordinationRuns.length >= 1, "expected at least one coordination Run");
assert(playgroundRuns.length >= 1, "expected at least one Playground Run");
assert(
  coordinationRuns.every((run) => run.sessionId && run.taskId && run.attemptId),
  "coordination Runs must carry session/task/attempt correlation",
);
console.log(
  `✓ runs corroborate isolation: ${coordinationRuns.length} coordination (correlated), ${playgroundRuns.length} playground`,
);

console.log("\n✓ isolation acceptance passed");
