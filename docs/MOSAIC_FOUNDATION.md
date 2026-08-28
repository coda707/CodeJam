# MOSAIC Foundation Handoff

This document describes the shared thin vertical skeleton that Developers A, B,
and C build on. The project contract remains `docs/track1_handouts/` and the
official Track 1 problem statement.

## What works now

The browser can create a `CoordinationSession`, inspect a fixed two-node task
DAG, start or stop it, and observe persisted Task, Attempt, and Event evidence.
The execution path is:

```text
React MOSAIC workspace
  -> Fastify coordination routes
  -> CoordinationService
  -> validated fixed PlannerOutput
  -> dependency-aware scheduler
  -> CoordinationExecutor port
  -> deterministic FakeCoordinationExecutor (default) or AgentService adapter
  -> JsonStore-backed Session / Task / Attempt / Event records
```

The Fake Executor remains the safe default and is deliberately labelled in the
UI. Set `COORDINATION_EXECUTOR=agent` to use participant Agents through the
existing `AgentService` Run path. The UI reports the active mode, and real Run
IDs are correlated with Task Attempts and terminal Events. Existing Agent CRUD,
lifecycle, Playground, Codex sessions, and workspace behavior remain unchanged.

## Run the foundation

Use the existing local POC command and open <http://localhost:3000>:

```bash
ARK_API_KEY=your-ark-api-key ARK_MODEL=ep-your-endpoint-id npm run poc
```

Select **MOSAIC** in the left navigation, create a Session, optionally select
existing Agents as participants, then select **Start Session**. The two task
nodes should complete in dependency order and the timeline should end with
`session.completed`.

To exercise real Agent execution, create at least one ready Agent and start with:

```bash
COORDINATION_EXECUTOR=agent \
ARK_API_KEY=your-ark-api-key \
ARK_MODEL=ep-your-endpoint-id \
npm run poc
```

Real workers must return the strict `WorkerOutput` JSON requested by the
adapter. Malformed output fails the Attempt rather than unlocking dependencies.

## Stable shared contracts

The canonical TypeScript and Zod contracts are in:

```text
apps/server/src/multi-agent/contracts.ts
apps/server/src/multi-agent/ports.ts
```

They define:

- Session, Task, Attempt, Artifact, Event, Budget, status, topology, and failure
  types;
- strict Planner, Worker, and Reviewer outputs;
- bounded text, array, task, event, and event-payload sizes;
- the `CoordinationExecutor`, `CoordinationVerifier`, and
  `CoordinationEventSink` ownership seams.

LLM-produced control data must be parsed through these schemas before it changes
state. Do not introduce parallel status enums or slightly different copies in
Developer-specific modules. Proposed contract changes should be reviewed by
Developer A and communicated to B and C before merging.

## Persistence

The existing version 1 JSON database now also contains:

```text
coordinationSessions
coordinationTasks
coordinationAttempts
coordinationArtifacts
coordinationEvents
```

Legacy version 1 databases are normalized with empty coordination collections
on load. Mutations continue to use the existing serialized `JsonStore` queue and
atomic temporary-file rename.

Real Worker files are captured below `COORDINATION_ARTIFACT_ROOT` (by default
`APP_DATA_DIR/coordination-artifacts`). Capture rejects absolute/traversal paths,
symlinks, non-files, missing files, files above 2 MiB, and Attempts above 8 MiB.
Only Session-relative storage paths, source paths, SHA-256 hashes, and bounded
metadata are persisted in JSON.

An active foundation Session is marked `cancelled` on server restart, with its
unfinished Tasks blocked and a persisted `session.cancelled` event. This avoids
leaving false `running` state before durable resume is implemented.

## Foundation API

```text
GET  /api/coordination/sessions
POST /api/coordination/sessions
GET  /api/coordination/sessions/:id
POST /api/coordination/sessions/:id/start
POST /api/coordination/sessions/:id/stop
GET  /api/coordination/sessions/:id/tasks
GET  /api/coordination/sessions/:id/attempts
GET  /api/coordination/sessions/:id/events
GET  /api/coordination/sessions/:id/artifacts
GET  /api/coordination/sessions/:id/metrics
```

All routes inherit the existing `/api/` bearer-token boundary. Polling is the
intended POC transport.

## Developer A - Coordination control plane

Start with:

```text
contracts.ts
planner.ts
coordination-service.ts
coordination-store.ts
coordination-routes.ts
```

Next responsibilities:

1. Replace `createFoundationPlan` with a Planner port and validated structured
   output while retaining deterministic DAG validation.
2. Generalize the scheduler from the fixed sequential graph to bounded parallel
   readiness, leases, and budgets.
3. Add Collaboration Gate and capability-based Team Builder behavior.
4. Keep create/start/stop idempotent and maintain correct terminal states.
5. Remain final merge owner for `app.ts`, server `types.ts`, and shared contracts.

## Developer B - Execution and reliability

The initial `CoordinationExecutor` implementation now lives in:

```text
apps/server/src/multi-agent/agent-executor-adapter.ts
```

It already launches through `AgentService`, waits for completion, propagates
cancellation, validates `WorkerOutput`, persists Run correlation, safely captures
bounded Artifact files, and checks structured/file acceptance criteria. Extend it
to:

1. add safe dependency handoff between isolated Agent workspaces;
2. add allowlisted command/test verification and richer failure classification;
3. implement timeout policy and bounded recovery;
4. cover verified workspace promotion/integration.

Select the implementation through `COORDINATION_EXECUTOR`; composition remains
in `apps/server/src/index.ts`. Do not make the coordinator call Ark, Codex CLI,
or an `AgentRunner` directly.

## Developer C - Evidence plane and product

Start with:

```text
apps/server/src/multi-agent/event-store.ts
apps/web/src/components/coordination/CoordinationWorkspace.tsx
apps/web/src/api.ts
apps/web/src/types.ts
```

The workspace now renders authoritative metrics plus Attempt/Run and Artifact
evidence from these APIs. Next responsibilities:

1. evolve the bounded Event sink for richer recovery and integration evidence;
2. add Artifact download/preview and deeper retry/reassignment comparison;
3. extend the evaluation harness with single/static/MOSAIC comparison fixtures;
4. add recorded-demo polish and accessibility checks;
5. keep the Fake Executor label whenever that runtime mode is active.

## Tests and acceptance

Run before every integration milestone:

```bash
npm run check
```

With a server already running, execute the browser-API acceptance path with:

```bash
npm run verify:mosaic
```

For Agent mode, supply comma-separated real participants through
`MOSAIC_AGENT_IDS`. `MOSAIC_BASE_URL`, `APP_AUTH_TOKEN`, and
`MOSAIC_VERIFY_TIMEOUT_MS` configure remote or protected demos.

The foundation test suite covers:

- strict structured-output contracts and bounded Event payloads;
- missing dependency and cycle rejection;
- fixed dependency order;
- concurrent start idempotency;
- success, failure, cancellation, and server-restart cleanup;
- legacy JSON database compatibility;
- browser-facing create/start/query API behavior;
- Artifact path safety, hashing, capture limits, and mechanical verification;
- usage/recovery Metrics projection and evidence API consistency;
- all original Agent lifecycle, Runner, HTTP, and Store regressions.

## Intentional limitations

- The planner and graph are fixed and deterministic.
- Fake remains the default mode and produces no Artifact file.
- Agent mode invokes real participants and captures files, but cross-workspace
  Artifact promotion and command/test verification are not connected yet.
- There is no Collaboration Gate, dynamic selection, retry/reassignment, or
  durable resume yet.
- Coordination is single-process and uses the existing JSON Store.
- The current graph visualization is optimized for the two-node foundation DAG.

These are owned next steps, not hidden claims of completed functionality.

## Reference policy

Do not vendor or bulk-clone all referenced frameworks. Consult primary papers,
official documentation, and focused source files only when implementing the
related module. For the next scheduler work, prioritize Magentic-One's
orchestrator ledger and recovery ideas, LangGraph's state/graph semantics,
Google ADK TypeScript's sequential and parallel workflow behavior, and the
existing Starter Kit lifecycle. Record any adopted mechanism and its trade-off
in the relevant design or test documentation.
