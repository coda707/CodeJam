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
cancellation, validates `WorkerOutput`, and persists Run correlation. Extend it
to:

1. add Artifact storage and safe dependency handoff;
2. add mechanical verification and richer failure classification;
3. implement timeout policy and bounded recovery;
4. cover multi-Agent workspace promotion/integration.

Replace `FakeCoordinationExecutor` only in application composition
(`apps/server/src/index.ts`). Do not make the coordinator call Ark, Codex CLI, or
an `AgentRunner` directly.

## Developer C - Evidence plane and product

Start with:

```text
apps/server/src/multi-agent/event-store.ts
apps/web/src/components/coordination/CoordinationWorkspace.tsx
apps/web/src/api.ts
apps/web/src/types.ts
```

Next responsibilities:

1. evolve the bounded Event sink and add metrics projections;
2. add artifact, verification, recovery, and Attempt-linkage views;
3. show authoritative backend state rather than inferring state in React;
4. add the evaluation harness and clearly labelled deterministic demo fixtures;
5. remove the Fake Executor label only after the UI is backed by real
   `AgentService` Runs.

## Tests and acceptance

Run before every integration milestone:

```bash
npm run check
```

The foundation test suite covers:

- strict structured-output contracts and bounded Event payloads;
- missing dependency and cycle rejection;
- fixed dependency order;
- concurrent start idempotency;
- success, failure, cancellation, and server-restart cleanup;
- legacy JSON database compatibility;
- browser-facing create/start/query API behavior;
- all original Agent lifecycle, Runner, HTTP, and Store regressions.

## Intentional limitations

- The planner and graph are fixed and deterministic.
- Fake remains the default mode and produces no Artifact file.
- Agent mode invokes real participants, but Artifact promotion and verification
  are not connected yet.
- There is no Collaboration Gate, dynamic selection, mechanical verifier,
  retry/reassignment, metrics projection, or durable resume yet.
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
