#!/usr/bin/env node
// MOSAIC evaluation harness: runs one benchmark task under the three primary
// strategies (single_agent / static_team / mosaic) plus an optional ablation,
// then emits a dataset that the evaluation view imports and validates against
// docs/evaluation/mosaic-evaluation.schema.json.
//
// Two modes:
//
//   Live (requires a running server in real-Agent mode + Ark configured):
//     node scripts/evaluate.mjs --out evaluation/result.json
//
//   Fixture (no server — emits a schema-valid sample marked source.kind=fixture):
//     node scripts/evaluate.mjs --fixture --out evaluation/fixture.json
//
// Strategy execution:
//   single_agent  one Agent does the whole task through the Playground path.
//   static_team   a coordination session whose workflow fixes every task's
//                 assignedAgentId up front (no dynamic team building).
//   mosaic        a coordination session with turnTaking (round-robin) and the
//                 full verify + recovery pipeline.
//
// Ablation: run mosaic again against a differently-configured server and tag it
// with `--variant`. Variant runs are excluded from the primary three-way
// aggregates by the evaluation view.
//   node scripts/evaluate.mjs --strategy mosaic --variant without_recovery
//     (server started with COORDINATION_RECOVERY=off COORDINATION_DEMO_FAULT=test_failure)
//   node scripts/evaluate.mjs --strategy mosaic --variant self_healing
//     (server started with COORDINATION_DEMO_FAULT=test_failure, recovery ON)
//
// Overridable via environment:
//   MOSAIC_BASE_URL   API origin (default http://localhost:3000)
//   APP_AUTH_TOKEN    bearer token, if the server requires one
//   MOSAIC_TASK       the userTask benchmark to coordinate (see default below)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const baseUrl = (process.env.MOSAIC_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const authToken = (process.env.APP_AUTH_TOKEN ?? "").trim();
const defaultTask =
  process.env.MOSAIC_TASK ??
  "Deliver a greet(name) function as three work products: a plan, an implementation, and documentation.";

async function request(pathName, method = "GET", body) {
  const options = { method };
  const headers = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  options.headers = headers;
  const response = await fetch(baseUrl + pathName, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${pathName} -> ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

const get = (pathName) => request(pathName, "GET");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollSession(sessionId, terminal) {
  for (let i = 0; i < 600; i += 1) {
    const { session } = await get(`/api/coordination/sessions/${sessionId}`);
    if (terminal.includes(session.status)) return session;
    await sleep(500);
  }
  throw new Error("Session did not reach a terminal state in time");
}

async function pollRun(runId, terminal) {
  for (let i = 0; i < 400; i += 1) {
    const { run } = await get(`/api/runs/${runId}`);
    if (terminal.includes(run.status)) return run;
    await sleep(500);
  }
  throw new Error("Run did not reach a terminal state in time");
}

// ---------------------------------------------------------------------------
// Benchmark definition (shared across strategies)
// ---------------------------------------------------------------------------
const deliverables = [
  {
    key: "plan",
    title: "Plan",
    resultPath: "mosaic/plan.md",
    testPath: "mosaic/plan.test.mjs",
    instructions: "Write a short implementation plan for greet(name) to mosaic/plan.md. Create mosaic/plan.test.mjs to verify the plan names the function and expected greeting. Run the test and report both files in artifactPaths.",
  },
  {
    key: "implement",
    title: "Implement",
    resultPath: "mosaic/greet.mjs",
    testPath: "mosaic/greet.test.mjs",
    instructions: "Implement greet(name) in mosaic/greet.mjs. Create mosaic/greet.test.mjs to verify greet('MOSAIC') returns 'Hello, MOSAIC!'. Run the test and report both files in artifactPaths.",
  },
  {
    key: "document",
    title: "Document",
    resultPath: "mosaic/README.md",
    testPath: "mosaic/document.test.mjs",
    instructions: "Document greet(name), its exact return format, and one usage example in mosaic/README.md. Create mosaic/document.test.mjs to verify those details are present. Run the test and report both files in artifactPaths.",
  },
];

const taskName = "greet(name): plan + implement + document";

const teamSpecs = [
  { name: "Planner", description: "planning and decomposition", instructions: "You produce plans." },
  { name: "Builder", description: "implementation and code", instructions: "You implement code." },
  { name: "Writer", description: "documentation and reporting", instructions: "You document results." },
];

const acceptanceCriteriaFor = (deliverable) => [
  {
    id: `${deliverable.key}-file`,
    kind: "file_exists",
    value: deliverable.resultPath,
    description: `Captured ${deliverable.resultPath}`,
  },
  {
    id: `${deliverable.key}-test`,
    kind: "command",
    value: `node --test ${deliverable.testPath}`,
    description: `Verified ${deliverable.title}`,
  },
];

async function createAgent(spec) {
  const { agent } = await request("/api/agents", "POST", spec);
  return agent;
}

// ---------------------------------------------------------------------------
// Strategy runners — each returns { metrics, evidence }.
// ---------------------------------------------------------------------------

async function runSingleAgent() {
  const agent = await createAgent({
    name: "Generalist",
    description: "delivers plans, implementations, and documentation",
    instructions: "You complete the whole deliverable yourself.",
  });
  const startedAt = Date.now();
  const prompt = [
    "Complete this task yourself, end to end.",
    defaultTask,
    "Create plan.md, greet.mjs, greet.test.mjs, and README.md. Run node --test greet.test.mjs before reporting the result.",
  ].join("\n");
  const { run } = await request(`/api/agents/${agent.id}/messages`, "POST", { content: prompt });
  const finished = await pollRun(run.id, ["completed", "failed", "cancelled"]);
  const latencyMs = Date.now() - startedAt;
  const usage = finished.usage ?? {};
  const succeeded = finished.status === "completed";
  return {
    metrics: {
      taskSucceeded: succeeded,
      acceptanceTestsPassed: 0,
      acceptanceTestsTotal: 0,
      acceptanceCriteriaMet: succeeded ? deliverables.length : 0,
      acceptanceCriteriaTotal: deliverables.length,
      totalTokens: (usage.inputTokens ?? 0) + (usage.cachedInputTokens ?? 0) + (usage.outputTokens ?? 0),
      latencyMs,
      agentCalls: 1,
      duplicateWorkCount: 0,
      failedAttempts: succeeded ? 0 : 1,
      recoveryAttempted: false,
      recoverySucceeded: null,
      humanInterventions: 0,
      coordinationOverheadMs: 0,
      failureLocalizationCorrect: null,
    },
    evidence: [`run:${finished.id}`, `agent:${agent.id}`],
  };
}

async function runTeamStrategy(agents, workflow, strategy) {
  const { session } = await request("/api/coordination/sessions", "POST", {
    userTask: defaultTask,
    participantAgentIds: agents.map((agent) => agent.id),
    workflow,
  });
  await request(`/api/coordination/sessions/${session.id}/start`, "POST");
  const finished = await pollSession(session.id, ["completed", "failed", "cancelled"]);
  const [{ metrics }, { attempts }, { events }, { tasks }] = await Promise.all([
    get(`/api/coordination/sessions/${session.id}/metrics`),
    get(`/api/coordination/sessions/${session.id}/attempts`),
    get(`/api/coordination/sessions/${session.id}/events`),
    get(`/api/coordination/sessions/${session.id}/tasks`),
  ]);

  const criteriaOf = (task) => task.acceptanceCriteria ?? [];
  const criteriaTotal = tasks.reduce((sum, task) => sum + criteriaOf(task).length, 0);
  const commandTotal = tasks.reduce(
    (sum, task) => sum + criteriaOf(task).filter((criterion) => criterion.kind === "command").length,
    0,
  );
  const succeededTasks = tasks.filter((task) => task.status === "succeeded");
  const criteriaMet = succeededTasks.reduce((sum, task) => sum + criteriaOf(task).length, 0);
  const commandMet = succeededTasks.reduce(
    (sum, task) => sum + criteriaOf(task).filter((criterion) => criterion.kind === "command").length,
    0,
  );

  const recoveryAttempted =
    metrics.recoveryStatus !== "not_needed" && metrics.recoveryStatus !== "not_attempted";
  const recoverySucceeded = recoveryAttempted ? metrics.recoveryStatus === "succeeded" : null;

  // Coordination overhead = session wall-clock minus the Agents' own compute time.
  const agentComputeMs = attempts.reduce((sum, attempt) => {
    if (!attempt.startedAt || !attempt.completedAt) return sum;
    const duration = Date.parse(attempt.completedAt) - Date.parse(attempt.startedAt);
    return duration > 0 ? sum + duration : sum;
  }, 0);
  const coordinationOverheadMs = Math.max(0, metrics.durationMs - agentComputeMs);

  const humanInterventions = events.filter((event) =>
    ["session.approved", "session.rejected"].includes(event.type),
  ).length;

  return {
    metrics: {
      taskSucceeded: finished.status === "completed",
      acceptanceTestsPassed: commandMet,
      acceptanceTestsTotal: commandTotal,
      acceptanceCriteriaMet: criteriaMet,
      acceptanceCriteriaTotal: criteriaTotal,
      totalTokens:
        (metrics.inputTokens ?? 0) + (metrics.cachedInputTokens ?? 0) + (metrics.outputTokens ?? 0),
      latencyMs: metrics.durationMs,
      agentCalls: metrics.totalAgentCalls,
      duplicateWorkCount: metrics.retryAttempts,
      failedAttempts: metrics.failedAttempts,
      recoveryAttempted,
      recoverySucceeded,
      humanInterventions,
      coordinationOverheadMs,
      failureLocalizationCorrect:
        recoveryAttempted && recoverySucceeded ? true : recoveryAttempted ? false : null,
    },
    evidence: [`session:${session.id}`, `topology:${session.topology}`],
  };
}

// ---------------------------------------------------------------------------
// Validation (mirrors the browser-side parseEvaluationDataset rules)
// ---------------------------------------------------------------------------
const STRATEGIES = new Set(["single_agent", "static_team", "mosaic"]);
const METRIC_KEYS = [
  "taskSucceeded",
  "acceptanceTestsPassed",
  "acceptanceTestsTotal",
  "acceptanceCriteriaMet",
  "acceptanceCriteriaTotal",
  "totalTokens",
  "latencyMs",
  "agentCalls",
  "duplicateWorkCount",
  "failedAttempts",
  "recoveryAttempted",
  "recoverySucceeded",
  "humanInterventions",
  "coordinationOverheadMs",
  "failureLocalizationCorrect",
];

function validateDataset(dataset) {
  assert(dataset.schemaVersion === 1, "schemaVersion must be 1");
  assert(typeof dataset.name === "string" && dataset.name.trim().length > 0, "name required");
  assert(!Number.isNaN(Date.parse(dataset.generatedAt)), "generatedAt must be an ISO timestamp");
  assert(["real", "fixture"].includes(dataset.source.kind), "source.kind must be real or fixture");
  assert(
    Array.isArray(dataset.runs) && dataset.runs.length >= 1 && dataset.runs.length <= 100,
    "runs must have 1..100 entries",
  );

  const ids = new Set();
  for (const run of dataset.runs) {
    assert(typeof run.id === "string" && run.id.trim(), "run.id required");
    assert(!ids.has(run.id), `duplicate run id: ${run.id}`);
    ids.add(run.id);
    assert(STRATEGIES.has(run.strategy), `invalid strategy: ${run.strategy}`);
    assert(Array.isArray(run.evidenceRefs) && run.evidenceRefs.length >= 1, "evidenceRefs required");
    assert(!Number.isNaN(Date.parse(run.completedAt)), "run.completedAt must be an ISO timestamp");

    const metrics = run.metrics;
    const unexpected = Object.keys(metrics).filter((key) => !METRIC_KEYS.includes(key));
    assert(unexpected.length === 0, `unknown metric fields: ${unexpected.join(", ")}`);
    for (const key of METRIC_KEYS) assert(key in metrics, `missing metric: ${key}`);
    for (const key of [
      "acceptanceTestsPassed", "acceptanceTestsTotal", "acceptanceCriteriaMet", "acceptanceCriteriaTotal",
      "totalTokens", "latencyMs", "agentCalls", "duplicateWorkCount", "failedAttempts",
      "humanInterventions", "coordinationOverheadMs",
    ]) {
      assert(
        Number.isInteger(metrics[key]) && metrics[key] >= 0,
        `metrics.${key} must be a non-negative integer`,
      );
    }
    assert(typeof metrics.taskSucceeded === "boolean", "taskSucceeded must be boolean");
    assert(typeof metrics.recoveryAttempted === "boolean", "recoveryAttempted must be boolean");
    assert(
      metrics.recoverySucceeded === null || typeof metrics.recoverySucceeded === "boolean",
      "recoverySucceeded must be boolean or null",
    );
    assert(
      metrics.failureLocalizationCorrect === null || typeof metrics.failureLocalizationCorrect === "boolean",
      "failureLocalizationCorrect must be boolean or null",
    );
    assert(metrics.acceptanceTestsPassed <= metrics.acceptanceTestsTotal, "acceptanceTestsPassed exceeds total");
    assert(metrics.acceptanceCriteriaMet <= metrics.acceptanceCriteriaTotal, "acceptanceCriteriaMet exceeds total");
    if (!metrics.recoveryAttempted) {
      assert(metrics.recoverySucceeded === null, "recoverySucceeded must be null when not attempted");
    } else {
      assert(metrics.recoverySucceeded !== null, "recoverySucceeded must be recorded when attempted");
    }
  }
}

function writeDataset(dataset, out) {
  const target = path.resolve(out ?? "evaluation/result.json");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(dataset, null, 2) + "\n", "utf8");
  return target;
}

// ---------------------------------------------------------------------------
// Fixture mode: a complete, schema-valid sample dataset with no server access.
// ---------------------------------------------------------------------------
function emitFixture() {
  const completedAt = new Date().toISOString();
  const base = {
    taskName: "greet(name): plan + implement + document",
    completedAt,
  };
  return {
    schemaVersion: 1,
    name: "MOSAIC evaluation fixture (greet task)",
    generatedAt: completedAt,
    source: { kind: "fixture", label: "Development sample — not measured execution" },
    runs: [
      {
        id: "fixture-single-1",
        ...base,
        strategy: "single_agent",
        evidenceRefs: ["fixture:single-agent"],
        metrics: {
          taskSucceeded: true,
          acceptanceTestsPassed: 0,
          acceptanceTestsTotal: 0,
          acceptanceCriteriaMet: 3,
          acceptanceCriteriaTotal: 3,
          totalTokens: 2400,
          latencyMs: 41000,
          agentCalls: 1,
          duplicateWorkCount: 0,
          failedAttempts: 0,
          recoveryAttempted: false,
          recoverySucceeded: null,
          humanInterventions: 0,
          coordinationOverheadMs: 0,
          failureLocalizationCorrect: null,
        },
      },
      {
        id: "fixture-static-1",
        ...base,
        strategy: "static_team",
        evidenceRefs: ["fixture:static-team"],
        metrics: {
          taskSucceeded: true,
          acceptanceTestsPassed: 0,
          acceptanceTestsTotal: 0,
          acceptanceCriteriaMet: 3,
          acceptanceCriteriaTotal: 3,
          totalTokens: 3100,
          latencyMs: 33000,
          agentCalls: 3,
          duplicateWorkCount: 0,
          failedAttempts: 0,
          recoveryAttempted: false,
          recoverySucceeded: null,
          humanInterventions: 0,
          coordinationOverheadMs: 1500,
          failureLocalizationCorrect: null,
        },
      },
      {
        id: "fixture-mosaic-1",
        ...base,
        strategy: "mosaic",
        evidenceRefs: ["fixture:mosaic"],
        metrics: {
          taskSucceeded: true,
          acceptanceTestsPassed: 1,
          acceptanceTestsTotal: 1,
          acceptanceCriteriaMet: 4,
          acceptanceCriteriaTotal: 4,
          totalTokens: 3600,
          latencyMs: 36000,
          agentCalls: 3,
          duplicateWorkCount: 0,
          failedAttempts: 0,
          recoveryAttempted: false,
          recoverySucceeded: null,
          humanInterventions: 0,
          coordinationOverheadMs: 2800,
          failureLocalizationCorrect: null,
        },
      },
      {
        id: "fixture-mosaic-without-recovery",
        taskName: "greet(name): plan + implement + document (with a failing test)",
        strategy: "mosaic",
        variant: "without_recovery",
        completedAt,
        evidenceRefs: ["fixture:without-recovery"],
        metrics: {
          taskSucceeded: false,
          acceptanceTestsPassed: 0,
          acceptanceTestsTotal: 1,
          acceptanceCriteriaMet: 2,
          acceptanceCriteriaTotal: 4,
          totalTokens: 3400,
          latencyMs: 28000,
          agentCalls: 3,
          duplicateWorkCount: 1,
          failedAttempts: 1,
          recoveryAttempted: false,
          recoverySucceeded: null,
          humanInterventions: 0,
          coordinationOverheadMs: 2600,
          failureLocalizationCorrect: null,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);

if (hasFlag("help") || args.includes("-h")) {
  console.log("Usage: node scripts/evaluate.mjs [--fixture] [--out <path>] [--variant <name>]");
  console.log("  --fixture   emit a schema-valid sample dataset (no server)");
  console.log("  --out       output path (default evaluation/result.json)");
  console.log("  --variant   tag the mosaic run as an ablation variant");
  process.exit(0);
}

const out = flag("out", "evaluation/result.json");

let dataset;
if (hasFlag("fixture")) {
  dataset = emitFixture();
} else {
  const system = await get("/api/system");
  assert(system.coordinationExecutor === "agent", "Live evaluation requires COORDINATION_EXECUTOR=agent");
  assert(system.arkConfigured === true, "Ark is not configured. Set ARK_API_KEY and ARK_MODEL in .env.");
  console.log(
    `✓ server: agent mode, recovery=${system.coordinationRecovery ?? "on"}, ` +
      `demoFault=${system.coordinationDemoFault ?? "off"}`,
  );

  const completedAt = new Date().toISOString();
  const runs = [];

  const single = await runSingleAgent();
  runs.push({ id: `single-${Date.now()}`, taskName, strategy: "single_agent", completedAt, evidenceRefs: single.evidence, metrics: single.metrics });
  console.log(`✓ single_agent  succeeded=${single.metrics.taskSucceeded}  tokens=${single.metrics.totalTokens}`);

  // static_team: fix every task to an Agent up front.
  const staticAgents = [await createAgent(teamSpecs[0]), await createAgent(teamSpecs[1]), await createAgent(teamSpecs[2])];
  const staticWorkflow = {
    tasks: deliverables.map((deliverable, index) => ({
      key: deliverable.key,
      title: deliverable.title,
      instructions: deliverable.instructions,
      dependencies: index === 0 ? [] : [deliverables[index - 1].key],
      acceptanceCriteria: acceptanceCriteriaFor(deliverable),
      assignedAgentId: staticAgents[index].id,
    })),
  };
  const staticResult = await runTeamStrategy(staticAgents, staticWorkflow, "static_team");
  runs.push({ id: `static-${Date.now()}`, taskName, strategy: "static_team", completedAt, evidenceRefs: staticResult.evidence, metrics: staticResult.metrics });
  console.log(`✓ static_team   succeeded=${staticResult.metrics.taskSucceeded}  tokens=${staticResult.metrics.totalTokens}`);

  // mosaic: dynamic round-robin assignment via turnTaking.
  const mosaicAgents = [await createAgent(teamSpecs[0]), await createAgent(teamSpecs[1]), await createAgent(teamSpecs[2])];
  const mosaicWorkflow = {
    tasks: deliverables.map((deliverable, index) => ({
      key: deliverable.key,
      title: deliverable.title,
      instructions: deliverable.instructions,
      dependencies: index === 0 ? [] : [deliverables[index - 1].key],
      acceptanceCriteria: acceptanceCriteriaFor(deliverable),
    })),
    turnTaking: { agentIds: mosaicAgents.map((agent) => agent.id), pattern: "round_robin" },
  };
  const mosaicResult = await runTeamStrategy(mosaicAgents, mosaicWorkflow, "mosaic");
  const variant = flag("variant", null);
  runs.push({
    id: `mosaic${variant ? `-${variant}` : ""}-${Date.now()}`,
    taskName,
    strategy: "mosaic",
    ...(variant ? { variant } : {}),
    completedAt,
    evidenceRefs: mosaicResult.evidence,
    metrics: mosaicResult.metrics,
  });
  console.log(`✓ mosaic        succeeded=${mosaicResult.metrics.taskSucceeded}  tokens=${mosaicResult.metrics.totalTokens}${variant ? `  variant=${variant}` : ""}`);

  dataset = {
    schemaVersion: 1,
    name: "MOSAIC evaluation (greet task)",
    generatedAt: completedAt,
    source: {
      kind: "real",
      label: `Measured · recovery=${system.coordinationRecovery ?? "on"} · fault=${system.coordinationDemoFault ?? "off"}`,
    },
    runs,
  };
}

validateDataset(dataset);
const written = writeDataset(dataset, out);
console.log(`\n✓ dataset written to ${written} (${dataset.runs.length} runs, schemaVersion 1)`);
