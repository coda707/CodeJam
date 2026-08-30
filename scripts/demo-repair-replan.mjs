// Demo: the two self-healing paths that the handout requires (§11).
//   repair — a test/acceptance failure spawns a repair Task and rewires downstream
//            dependencies; the original Task is superseded, not failed.
//   replan — a no-progress failure re-plans the unfinished subgraph; already-succeeded
//            Tasks are never re-run.
//
// Prerequisites: a server is running with the matching fault injected at startup.
//   repair:  COORDINATION_DEMO_FAULT=test_failure   (matches a "Verify…" Task)
//   replan:  COORDINATION_DEMO_FAULT=no_progress    (matches a "Research…" Task)
//
// Run one of:
//   node scripts/demo-repair-replan.mjs repair
//   node scripts/demo-repair-replan.mjs replan
//
// The demo runs against the Fake executor, so no Ark key is required — the fault
// injector produces the failure deterministically and the recovery policy heals it.
//
// Overridable via environment:
//   MOSAIC_BASE_URL   API origin (default http://localhost:3000)
//   APP_AUTH_TOKEN    bearer token, if the server requires one
const baseUrl = (process.env.MOSAIC_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const authToken = (process.env.APP_AUTH_TOKEN ?? "").trim();

const mode = process.argv[2] ?? "repair";
if (!["repair", "replan"].includes(mode)) {
  console.error("Usage: node scripts/demo-repair-replan.mjs <repair|replan>");
  process.exit(2);
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

async function poll(sessionId, terminal) {
  for (let i = 0; i < 400; i += 1) {
    const { session } = await get(`/api/coordination/sessions/${sessionId}`);
    if (terminal.includes(session.status)) return session;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Session did not reach a terminal state in time");
}

const criterion = (id, description) => ({ id, kind: "artifact", value: "worker-output", description });

const workflow =
  mode === "repair"
    ? {
        tasks: [
          { key: "verify-design", title: "Verify the design", instructions: "Verify the design.", acceptanceCriteria: [criterion("verify", "Verified")] },
          { key: "implement", title: "Implement the design", instructions: "Implement it.", dependencies: ["verify-design"], acceptanceCriteria: [criterion("implement", "Implemented")] },
          { key: "document", title: "Document the result", instructions: "Document it.", dependencies: ["implement"], acceptanceCriteria: [criterion("document", "Documented")] },
        ],
      }
    : {
        tasks: [
          { key: "research", title: "Research the approach", instructions: "Research the approach.", acceptanceCriteria: [criterion("research", "Researched")] },
          { key: "implement", title: "Implement the approach", instructions: "Implement it.", dependencies: ["research"], acceptanceCriteria: [criterion("implement", "Implemented")] },
          { key: "document", title: "Document the approach", instructions: "Document it.", dependencies: ["implement"], acceptanceCriteria: [criterion("document", "Documented")] },
        ],
      };

// Sanity-check the configured fault matches the requested demo.
const system = await get("/api/system");
const fault = system.coordinationDemoFault ?? "off";
if (mode === "repair" && fault !== "test_failure") {
  throw new Error(`repair demo requires COORDINATION_DEMO_FAULT=test_failure (server reports "${fault}")`);
}
if (mode === "replan" && fault !== "no_progress") {
  throw new Error(`replan demo requires COORDINATION_DEMO_FAULT=no_progress (server reports "${fault}")`);
}
console.log(`✓ fault injected: ${fault}  ·  recovery: ${system.coordinationRecovery ?? "on"}`);

const { session, tasks } = await request("/api/coordination/sessions", "POST", {
  userTask: mode === "repair"
    ? "Verify, then implement, then document the design."
    : "Research, then implement, then document the approach.",
  participantAgentIds: [],
  workflow,
});
console.log(`✓ session ${session.id.slice(0, 8)}  tasks=${tasks.length}`);
await request(`/api/coordination/sessions/${session.id}/start`, "POST");

const finished = await poll(session.id, ["completed", "failed", "cancelled"]);
const [{ events }, { attempts }] = await Promise.all([
  get(`/api/coordination/sessions/${session.id}/events`),
  get(`/api/coordination/sessions/${session.id}/attempts`),
]);
const refreshed = await get(`/api/coordination/sessions/${session.id}/tasks`);

console.log(`\nfinal status: ${finished.status}`);
console.log(
  "attempts:",
  attempts.map((a) => `${a.status}${a.errorClass ? `(${a.errorClass})` : ""}`).join(", "),
);
console.log(
  "task statuses:",
  refreshed.tasks.map((t) => `${t.title}→${t.status}`).join(", "),
);

const recoveryEvents = events.filter((e) =>
  ["recovery.decided", "task.repair_created", "plan.revised", "task.succeeded"].includes(e.type),
);
console.log("\nrecovery timeline:");
console.log(
  recoveryEvents
    .map((e) => `  ${e.type}${e.payload?.action ? `(${e.payload.action})` : ""}`)
    .join("\n") || "  (none)",
);

if (mode === "repair") {
  assert(
    events.some((e) => e.type === "task.repair_created"),
    "expected a task.repair_created event (repair Task)",
  );
  assert(
    events.some((e) => e.type === "recovery.decided" && e.payload?.action === "repair"),
    "expected a recovery.decided(repair) event",
  );
  assert(
    refreshed.tasks.some((t) => t.status === "superseded" && t.title.includes("Verify")),
    "expected the failing Verify Task to be superseded",
  );
  console.log("\n✓ repair demo passed: superseded the failing Task, spawned a repair Task, rewired downstream");
} else {
  assert(
    events.some((e) => e.type === "plan.revised"),
    "expected a plan.revised event (replan)",
  );
  assert(
    events.some((e) => e.type === "recovery.decided" && e.payload?.action === "replan"),
    "expected a recovery.decided(replan) event",
  );
  console.log("\n✓ replan demo passed: re-planned the unfinished subgraph without re-running succeeded work");
}

assert(finished.status === "completed", `Session ended as ${finished.status}`);
console.log("✓ session completed");
