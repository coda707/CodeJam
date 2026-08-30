// Real-Agent "two-Agent alternating 1..10" acceptance check (Developer A).
//
// Exercises the structured `workflow` input end-to-end: ten count Tasks with no
// explicit dependencies are compiled into an implicit chain, `turnTaking` assigns
// them round-robin across exactly two Agents, and a final `verify` Task asserts
// the reconstructed sequence mechanically via an allowlisted `node --test`
// command plus a captured `count.txt` file.
//
// Prerequisites (server already running):
//   1. .env with ARK_API_KEY and ARK_MODEL filled in.
//   2. COORDINATION_EXECUTOR=agent (so coordination uses real Agents).
//   3. server started, e.g. `npm run dev -w @launchpad/server`.
//
// Run:  node scripts/demo-counting-workflow.mjs
//
// Overridable via environment:
//   MOSAIC_BASE_URL   API origin (default http://localhost:3000)
//   APP_AUTH_TOKEN    bearer token, if the server requires one
//   MOSAIC_COUNT      sequence length to count (default 10, must be even)
const baseUrl = (process.env.MOSAIC_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const authToken = (process.env.APP_AUTH_TOKEN ?? "").trim();
const count = Number(process.env.MOSAIC_COUNT ?? 10);

if (!Number.isInteger(count) || count < 2 || count % 2 !== 0) {
  throw new Error("MOSAIC_COUNT must be an even integer >= 2");
}

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
  for (let i = 0; i < 600; i += 1) {
    const { session } = await get(`/api/coordination/sessions/${sessionId}`);
    if (terminal.includes(session.status)) return session;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Session did not reach a terminal state in time");
}

// 1. Confirm real-Agent mode and Ark configuration.
const system = await get("/api/system");
assert(
  system.coordinationExecutor === "agent",
  `COORDINATION_EXECUTOR must be "agent" for this check (server reports "${system.coordinationExecutor}").`,
);
assert(system.arkConfigured === true, "Ark is not configured. Set ARK_API_KEY and ARK_MODEL in .env.");
console.log("✓ server in agent mode, Ark configured");

// 2. Create the two Agents that will alternate.
const agents = [];
for (const name of ["Counter Alpha", "Counter Beta"]) {
  const { agent } = await request("/api/agents", "POST", {
    name,
    description: "counts a single integer and reports it",
    instructions: "You are a counting Agent. Report exactly the integer you are asked for.",
  });
  agents.push(agent);
  console.log(`✓ agent ${agent.id.slice(0, 8)}  ${agent.name}`);
}
const [alpha, beta] = agents;

// 3. Build the structured workflow: count-1..count-N (implicit chain) + verify.
const countTasks = Array.from({ length: count }, (_, index) => {
  const n = index + 1;
  return {
    key: `count-${n}`,
    title: `Count ${n}`,
    instructions:
      `Report the integer ${n} and nothing else. Return exactly: ` +
      `{"summary":"${n}","artifactPaths":[],"evidence":["${n}"],"unresolvedIssues":[]}.`,
    acceptanceCriteria: [
      { id: "value", kind: "artifact", value: "worker-output", description: `Reported the integer ${n}` },
    ],
  };
});

const verifyInstructions = [
  "Read the 'Verified dependency context' below. It contains the numbers your predecessors reported, in task order.",
  `Reconstruct the sequence 1..${count} from those reported numbers.`,
  `Write a file named count.txt containing the integers 1 through ${count}, one per line, in ascending order.`,
  "Then write a file named count.test.mjs with exactly this content:",
  "import { test } from \"node:test\";",
  "import assert from \"node:assert/strict\";",
  "import { readFileSync } from \"node:fs\";",
  `test(\"count.txt is 1..${count} in order\", () => {`,
  "  const nums = readFileSync(\"count.txt\", \"utf8\").trim().split(/\\s+/).map(Number);",
  `  assert.deepEqual(nums, [${Array.from({ length: count }, (_, i) => i + 1).join(", ")}]);`,
  "});",
  "Return a WorkerOutput JSON with artifactPaths set to [\"count.txt\", \"count.test.mjs\"], evidence describing the sequence you wrote, and unresolvedIssues empty.",
].join("\n");

const workflow = {
  tasks: [
    ...countTasks,
    {
      key: "verify",
      title: "Verify the count",
      instructions: verifyInstructions,
      dependencies: [`count-${count}`],
      acceptanceCriteria: [
        { id: "count-file", kind: "file_exists", value: "count.txt", description: "count.txt holds the reconstructed sequence" },
        { id: "sequence", kind: "command", value: "node --test count.test.mjs", description: "count.test.mjs asserts the sequence is 1..N in order" },
      ],
    },
  ],
  turnTaking: { agentIds: [alpha.id, beta.id], pattern: "round_robin" },
};

const participantAgentIds = agents.map((agent) => agent.id);
const { session, tasks } = await request("/api/coordination/sessions", "POST", {
  userTask: `Count from 1 to ${count}, alternating between two Agents, then verify the sequence.`,
  participantAgentIds,
  workflow,
});
console.log(`✓ session ${session.id.slice(0, 8)}  topology=${session.topology}  tasks=${tasks.length}`);

// 4. Start and wait.
await request(`/api/coordination/sessions/${session.id}/start`, "POST");
const finished = await pollSession(session.id, ["completed", "failed", "cancelled"]);
console.log(`\nfinal status: ${finished.status}${finished.failureReason ? ` — ${finished.failureReason}` : ""}`);

// 5. Pull evidence.
const [{ attempts }, { artifacts }, { events }] = await Promise.all([
  get(`/api/coordination/sessions/${session.id}/attempts`),
  get(`/api/coordination/sessions/${session.id}/artifacts`),
  get(`/api/coordination/sessions/${session.id}/events`),
]);

const taskById = new Map(tasks.map((task) => [task.id, task]));
const agentNameById = new Map(agents.map((agent) => [agent.id, agent.name]));

console.log("\n— attempts (count Tasks should alternate Agent) —");
for (const attempt of attempts) {
  const title = taskById.get(attempt.taskId)?.title ?? attempt.taskId;
  const agentName = attempt.agentId
    ? agentNameById.get(attempt.agentId) ?? attempt.agentId.slice(0, 8)
    : "—";
  console.log(`  ${attempt.status.padEnd(9)}  ${title.padEnd(12)}  agent=${agentName.padEnd(14)}  run=${attempt.runId ? attempt.runId.slice(0, 8) : "—"}`);
}

// 6. Assert alternation across the count Tasks specifically.
const countAttempts = attempts.filter((attempt) => {
  const title = taskById.get(attempt.taskId)?.title ?? "";
  return /^Count \d+$/.test(title);
});
assert(
  countAttempts.length === count,
  `expected ${count} count attempts, saw ${countAttempts.length}`,
);
const ordered = countAttempts
  .slice()
  .sort((a, b) => {
    const an = Number((taskById.get(a.taskId)?.title ?? "").replace("Count ", ""));
    const bn = Number((taskById.get(b.taskId)?.title ?? "").replace("Count ", ""));
    return an - bn;
  });
const producers = ordered.map((attempt) => attempt.agentId);
assert(
  new Set(producers).size === 2,
  `count Tasks must alternate across exactly two Agents (saw ${new Set(producers).size})`,
);
for (let i = 0; i < producers.length; i += 1) {
  assert(
    producers[i] === producers[i % 2],
    `count Task ${i + 1} broke the alternating round-robin assignment`,
  );
}
console.log("\n✓ alternating assignment confirmed: two Agents, round-robin in sequence order");

// 7. Verify the verify Task actually passed through the command criterion.
const verifyTask = tasks.find((task) => task.title === "Verify the count");
const verifyAttempt = attempts.find((attempt) => attempt.taskId === verifyTask?.id);
assert(verifyAttempt && verifyAttempt.status === "succeeded", "verify Task did not succeed");
console.log("✓ verify Task passed the mechanical `node --test` + `count.txt` criteria");

const countFile = artifacts.find((artifact) => artifact.sourcePath === "count.txt");
assert(countFile, "count.txt was not captured as an Artifact");
console.log(`✓ captured count.txt  sha256=${countFile.contentHash.slice(0, 12)}…`);

assert(finished.status === "completed", `Session ended as ${finished.status}`);
console.log("\n✓ two-Agent alternating count workflow passed");
