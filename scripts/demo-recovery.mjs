// Demo: automatic fault recovery.
// Prerequisites: a server is running with COORDINATION_DEMO_FAULT=transient.
//   $env:COORDINATION_DEMO_FAULT = "transient"
//   npm run dev -w @launchpad/server
// Then run: node scripts/demo-recovery.mjs
const baseUrl = (process.env.MOSAIC_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

async function request(path, method, body) {
  const options = { method };
  if (body !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(baseUrl + path, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

const get = (path) => request(path, "GET");

async function poll(sessionId, terminal) {
  for (let i = 0; i < 200; i += 1) {
    const { session } = await get(`/api/coordination/sessions/${sessionId}`);
    if (terminal.includes(session.status)) return session;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error("Session did not reach a terminal state in time");
}

const { session } = await request("/api/coordination/sessions", "POST", {
  userTask: "Build several independent modules",
  participantAgentIds: [],
});
console.log(`created session ${session.id} (topology: ${session.topology})`);
await request(`/api/coordination/sessions/${session.id}/start`, "POST");

const finished = await poll(session.id, ["completed", "failed", "cancelled"]);
const { attempts } = await get(`/api/coordination/sessions/${session.id}/attempts`);
const { events } = await get(`/api/coordination/sessions/${session.id}/events`);

console.log(`\nfinal status: ${finished.status}`);
console.log(
  "attempts:",
  attempts.map((a) => a.status + (a.errorClass ? `(${a.errorClass})` : "")).join(", "),
);
const recovery = events
  .filter((e) => ["recovery.decided", "task.retried", "task.reassigned", "task.failed"].includes(e.type))
  .map((e) => `${e.type}${e.payload?.action ? `(${e.payload.action})` : ""}`);
console.log("recovery timeline:", recovery.join(" -> "));
