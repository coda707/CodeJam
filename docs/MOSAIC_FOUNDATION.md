# MOSAIC Foundation Handout

This is the shared starting point for the three MOSAIC workstreams. The product
requirements remain in `docs/track1_handouts/`. The frontend information
architecture and backend data requests are fixed separately in
[`MOSAIC_UI_STRUCTURE.md`](MOSAIC_UI_STRUCTURE.md).

## Implemented foundation

The repository now provides one working vertical path:

```text
MOSAIC workspace
  -> Fastify coordination API
  -> Planner and TeamBuilder ports
  -> persisted dependency graph
  -> Executor and Artifact ports
  -> mechanical verification
  -> RecoveryPolicy port
  -> persisted evidence, metrics, and UI
```

The foundation includes:

- strict Zod contracts for Sessions, Tasks, Attempts, Artifacts, Events,
  PlannerOutput, TeamBuilderOutput, WorkerOutput, ReviewerOutput, and recovery
  decisions;
- injectable `CoordinationPlanner`, `CoordinationTeamBuilder`,
  `CoordinationExecutor`, `CoordinationVerifier`, and
  `CoordinationRecoveryPolicy` ports;
- a validated two-Task default plan and deterministic participant-order
  assignment;
- dependency-aware execution with the accepted upstream `WorkerOutput` and
  Artifact metadata passed into each downstream executor request;
- real Agent execution through the existing `AgentService`, with Run IDs,
  usage, cancellation, strict output parsing, safe Artifact capture, and
  verification;
- bounded retry, reassignment, approval-wait, and stop decisions behind the
  recovery port, with stop remaining the default behavior;
- JSON-backed Session, Task, Attempt, Artifact, Event, and metrics evidence;
- a MOSAIC graph, timeline, Attempt, Run, Artifact, verification, and metrics
  workspace;
- shared test factories at
  `apps/server/src/multi-agent/test-support/factories.ts`.

The Fake Executor remains the safe default. Set
`COORDINATION_EXECUTOR=agent` and select at least one ready Agent to run real
workers.

## Primary file ownership

| Workstream | Foundation files | Recommended next work |
| --- | --- | --- |
| A: control plane | `contracts.ts`, `ports.ts`, `planner.ts`, `team-builder.ts`, `coordination-service.ts`, `coordination-store.ts`, `coordination-routes.ts` | Replace the default planner and participant-order builder, add capability scoring and a Collaboration Gate, then make ready Tasks truly parallel under budgets. |
| B: execution and reliability | `agent-executor-adapter.ts`, `artifact-store.ts`, `verifier.ts`, `failure-classifier.ts`, `recovery-policy.ts` | Add safe cross-workspace Artifact promotion, allowlisted command verification, timeouts, fault injection, and production recovery policies. |
| C: evidence and product | `event-store.ts`, `metrics.ts`, `apps/web/src/components/coordination/CoordinationWorkspace.tsx`, `apps/web/src/api.ts`, `apps/web/src/types.ts`, `scripts/verify-mosaic.mjs` | Add richer recovery and integration evidence, Artifact preview, evaluation comparisons, demo fixtures, accessibility, and recording polish. |

Developer A is the merge owner for `contracts.ts`, `ports.ts`, server
composition, and shared persistence types. B and C should propose the smallest
contract change before editing those files.

## Integration order

1. Merge A's contract or state-machine change.
2. Merge B's executor, verification, Artifact, or recovery implementation.
3. Merge C's API projection and UI evidence changes.
4. Let A complete integration wiring and run the combined checks.

Each workstream should keep commits small, report contract changes explicitly,
and use the shared factories instead of creating incompatible test objects.

## Run and validate

Run the local POC and open <http://localhost:3000>:

```bash
ARK_API_KEY=your-ark-api-key ARK_MODEL=ep-your-endpoint-id npm run poc
```

Validate before integration:

```bash
npm run check
```

With the application running, validate the MOSAIC API and browser path:

```bash
npm run verify:mosaic
```

For real Agent mode, set `COORDINATION_EXECUTOR=agent` and provide participant
IDs through the UI or `MOSAIC_AGENT_IDS` for the verification script.

## Intentional limits

- The default Planner still returns the deterministic two-Task foundation DAG.
- The default TeamBuilder uses participant order instead of capability scoring.
- Ready Tasks are executed serially even though concurrency budgets are stored.
- The default RecoveryPolicy stops after failure. Injected policies can retry,
  reassign, or wait for approval, but approval and resume APIs are not present.
- Accepted dependency evidence is supplied to downstream prompts, but file
  promotion between isolated Agent workspaces is not present.
- Command and test criteria do not yet execute allowlisted commands.
- Coordination remains single-process on the existing JSON store.

## Reference policy

Consult primary papers, official documentation, and focused source files only
when implementing the related module. Prioritize Magentic-One for orchestrator
ledger and recovery ideas, LangGraph and Google ADK for graph scheduling
semantics, and the existing Starter Kit for lifecycle and persistence behavior.
