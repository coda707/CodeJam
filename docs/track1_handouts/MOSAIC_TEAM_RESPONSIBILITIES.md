# MOSAIC Team Responsibilities and AI Work Instructions

> Read [MOSAIC_HANDOUT.md](./MOSAIC_HANDOUT.md) first. It is the shared project contract.  
> This document defines ownership, collaboration and AI-ready work packages for three developers.

## 1. Working model

Use **contract-first modular ownership with end-to-end acceptance**:

```text
Shared thin vertical skeleton
  -> A owns coordination/control
  -> B owns execution/reliability
  -> C owns evidence/product/demo
  -> integrate at least twice per day
```

Do not split only into frontend/backend/testing, and do not let several AI coding sessions rewrite the same core file independently.

## 2. Shared rules

- The handout, contracts and accepted API schemas are authoritative.
- Preserve existing Agent CRUD, lifecycle, Playground, Runner and persistence behavior.
- Every state-changing LLM output must be schema-validated.
- Every feature needs a positive case and a failure/denial/recovery case where applicable.
- Do not commit or display secrets.
- No one changes another owner's files without coordination.
- Small commits and early integration are preferred to a final large merge.
- Run focused tests before committing and `npm run check` before integration milestones.
- AI-generated code is accepted only when its owner can explain the state transitions, failure behavior and tests.

## 3. Shared first milestone

Before separating, all three developers build one thin path:

```text
UI creates Session
  -> API creates a fixed two-node DAG
  -> Fake executor completes both nodes
  -> events are persisted
  -> UI shows the graph and timeline
```

Freeze the first versions of:

- core IDs and status enums;
- Planner/Worker/Reviewer schemas;
- Session and Event APIs;
- ownership map below.

## 4. Developer A - Coordination Control Plane and Integrator

### Mission

Make MOSAIC decide, plan and coordinate correctly. A owns the canonical contracts and final integration decisions.

### Responsibilities

- Define Session, Task, Attempt, Artifact, Event and Budget contracts.
- Implement Session state transitions.
- Implement Collaboration Gate and its explanation.
- Validate Planner-generated DAGs, including cycles, limits and dependency references.
- Implement capability-based Team Builder.
- Implement sequential/parallel DAG scheduling, Task readiness and leases.
- Expose create/start/stop/query coordination routes.
- Coordinate persistence changes with the existing JSON Store.
- Integrate B and C modules and resolve shared-file changes.
- Keep the architecture and implementation aligned with the handout.

### Owned files

```text
apps/server/src/multi-agent/contracts.ts
apps/server/src/multi-agent/coordination-service.ts
apps/server/src/multi-agent/collaboration-gate.ts
apps/server/src/multi-agent/planner.ts
apps/server/src/multi-agent/team-builder.ts
apps/server/src/multi-agent/graph-scheduler.ts
apps/server/src/multi-agent/coordination-store.ts
apps/server/src/multi-agent/coordination-routes.ts
apps/server/src/multi-agent/index.ts
apps/server/src/app.ts                 # final merge owner
apps/server/src/types.ts               # final merge owner
```

### Inputs from others

- B: executor result, verification result and recovery request.
- C: event/metric query needs and UI API feedback.

### Outputs to others

- Stable TypeScript/Zod contracts.
- Scheduler commands such as `executeTask`, `cancelAttempt` and `reassignTask`.
- Session/Task state query APIs.
- Accepted event types and payload schemas.

### Acceptance criteria

- Valid DAGs execute respecting dependencies.
- Invalid/cyclic DAGs fail without partial execution.
- Ready Tasks are leased once and not duplicated.
- Different ready Tasks can execute concurrently.
- Stop reaches all active Tasks and Attempts.
- Session reaches a correct terminal state after success or unrecoverable failure.
- Unit tests cover state transitions, DAG validation and idempotency.

### Must not do

- Do not replace `AgentService` or invoke model providers directly.
- Do not embed frontend-specific presentation logic in the scheduler.
- Do not let Planner text directly mutate state without validation.

### AI-ready assignment

```text
Read MOSAIC_HANDOUT.md and MOSAIC_TEAM_RESPONSIBILITIES.md.
You are Developer A, owner of the Coordination Control Plane.

Implement only the files listed under Developer A ownership unless a shared-file
change is explicitly necessary. First inspect the existing Agent, Run and JsonStore
contracts. Preserve all baseline behavior.

Deliver:
1. Zod and TypeScript coordination contracts.
2. Session state machine and validated Task DAG.
3. sequential/parallel scheduler with atomic lease/idempotency behavior.
4. Collaboration Gate and capability-based Team Builder.
5. coordination API routes and unit tests.

Use injected interfaces for execution and events so Developers B and C can work
against fakes. Do not implement Runner internals or React UI. Report changed files,
test commands, assumptions and any requested contract changes.
```

## 5. Developer B - Agent Execution, Artifacts, Verification and Recovery

### Mission

Make planned work execute through real Codex Agents, produce trustworthy artifacts and recover from failures.

### Responsibilities

- Adapt Task Nodes to the existing `AgentService` Run path.
- Provide a completion signal or bounded wait for Agent Runs.
- Support multiple Agents executing independent Tasks concurrently.
- Convert worker output/files into bounded, hashed Artifact records.
- Implement schema and mechanical verification.
- Classify timeouts, provider errors, malformed output, test failures, capability mismatch and no-progress failures.
- Implement bounded retry, reassignment and repair-task behavior.
- Propagate cancellation and clean up active Runs.
- Implement explicit one-shot demo fault injection.
- Add backend unit/integration tests using FakeRunner and at least one real-path manual check.
- If code collaboration is included, isolate Agent work and promote only verified patches.

### Owned files

```text
apps/server/src/multi-agent/agent-executor-adapter.ts
apps/server/src/multi-agent/artifact-store.ts
apps/server/src/multi-agent/verifier.ts
apps/server/src/multi-agent/failure-classifier.ts
apps/server/src/multi-agent/recovery-manager.ts
apps/server/src/multi-agent/demo-faults.ts
apps/server/src/multi-agent/integration-manager.ts
apps/server/src/multi-agent/*execution*.test.ts
apps/server/src/agent-service.ts          # B proposes; A reviews/merges
apps/server/src/types.ts                  # contract changes through A
```

### Inputs from others

- A: validated Task, selected Agent, Attempt ID, budgets and scheduler commands.
- C: event sink and evidence needed for UI/demo.

### Outputs to others

- Attempt lifecycle events.
- Worker/Artifact records.
- Verification result with cited evidence.
- Classified failure and recommended recovery action.
- Final Run/Attempt status and usage.

### Acceptance criteria

- A ready Task launches a real existing Agent without bypassing `AgentService`.
- Run completion is correlated to Session, Task, Attempt and Agent IDs.
- Timeout cancels the underlying Run.
- Retry never exceeds policy limits and links Attempts.
- Reassignment chooses a different valid Agent.
- Invalid Artifacts cannot unlock dependent Tasks.
- A real verifier command determines pass/fail.
- Failure/cancellation leaves no Agent permanently busy.
- Tests cover success, timeout, malformed output, verification failure and reassignment.

### Must not do

- Do not create a second independent Agent platform or Python orchestration service.
- Do not mark work verified from an Agent's natural-language claim.
- Do not implement unbounded retry or hidden fault injection.

### AI-ready assignment

```text
Read MOSAIC_HANDOUT.md and MOSAIC_TEAM_RESPONSIBILITIES.md.
You are Developer B, owner of Agent Execution and Reliability.

Use the existing AgentService and AgentRunner path. Implement only Developer B's
owned files and propose shared contract changes to Developer A rather than changing
them independently.

Deliver:
1. Task-to-Agent execution adapter with completion/cancellation handling.
2. bounded Artifact storage and hashing.
3. schema plus mechanical verification.
4. failure classification and targeted retry/reassign/repair behavior.
5. deterministic one-shot demo fault injection.
6. FakeRunner-based tests for positive and recovery paths.

Every transition must emit the event contract supplied by A/C. Preserve existing
single-Agent behavior. Report changed files, test evidence, failure semantics and
any assumptions about AgentService internals.
```

## 6. Developer C - Evidence Plane, Frontend, Evaluation and Recorded Demo

### Mission

Make the coordination process observable, measurable and understandable, and turn the verified system into a clear three-minute recorded story.

### Responsibilities

- Implement bounded Event storage/projection using A's Event contract.
- Compute Session metrics: calls, usage, latency, failed Attempts and recovery result.
- Expose events, artifacts and metrics query routes in coordination with A.
- Implement Session creation/selection in the React UI.
- Implement DAG, timeline, Attempt relationship, evidence and metrics views.
- Show terminal status and a working stop control.
- Build deterministic demo fixtures and seed instructions without faking execution.
- Implement the single/static/MOSAIC evaluation harness and prepare comparison data.
- Produce README material, one-page architecture and limitation summary.
- Script, record, narrate, caption, edit and validate the three-minute video.
- Keep an uncut recording of the real Session used in the final edit.

### Owned files

```text
apps/server/src/multi-agent/event-store.ts
apps/server/src/multi-agent/metrics-projector.ts
apps/server/src/multi-agent/trace-routes.ts
apps/web/src/components/coordination/*
apps/web/src/api.ts
apps/web/src/types.ts
apps/web/src/App.tsx
apps/web/src/styles.css
docs/ or submission documentation related to MOSAIC
demo fixtures, scripts and video assets
```

### Inputs from others

- A: stable Session/Task/Event contracts and query APIs.
- B: Attempt, Artifact, verification and recovery evidence.

### Outputs to others

- Event sink/store interface usable before the full UI exists.
- Graph/timeline/metric views.
- Evaluation results and demo-readiness feedback.
- Final storyboard, narration, recording checklist and video.

### Acceptance criteria

- UI uses real API data and does not infer authoritative state locally.
- A viewer can identify each Agent, Task, Attempt and Run.
- The original failed Attempt and recovery Attempt are visibly linked.
- Timeline explains why recovery occurred.
- Test evidence and final result are inspectable.
- Metrics are derived from stored events, not hard-coded.
- The final video is below three minutes, contains one real multi-Agent Session and exposes no secret.
- The video includes problem, architecture, real execution, controlled failure, recovery, verification and value.

### Must not do

- Do not hide backend failures by changing only UI state.
- Do not use static demo data as if it were a real execution.
- Do not postpone the first recording until the final afternoon.

### AI-ready assignment

```text
Read MOSAIC_HANDOUT.md and MOSAIC_TEAM_RESPONSIBILITIES.md.
You are Developer C, owner of the Evidence Plane, UI, Evaluation and Demo.

Implement only Developer C's owned files. Consume the accepted contracts; request
changes from Developer A instead of inventing incompatible status or event types.

Deliver:
1. bounded event storage and metrics projection.
2. query routes for events, artifacts and metrics.
3. React Session creation, DAG, timeline, recovery linkage and evidence views.
4. single/static/MOSAIC evaluation harness and result format.
5. reproducible demo fixtures, storyboard and three-minute recording checklist.

The UI must display real backend data. Use fixture data only while APIs are under
development and remove or clearly label it before submission. Report changed files,
API expectations, visual acceptance evidence and demo risks.
```

## 7. Shared-file and Git policy

Suggested branches:

```text
feat/coordination-core       # A
feat/execution-recovery      # B
feat/evidence-demo           # C
```

| Shared file | Merge owner | Contributor process |
| --- | --- | --- |
| `apps/server/src/types.ts` | A | B/C propose minimal diff or contract request |
| `apps/server/src/app.ts` | A | C supplies route plugin; A registers it |
| `apps/server/src/agent-service.ts` | B, reviewed by A | A does not edit concurrently |
| `apps/web/src/App.tsx` | C | A/B consume UI via API, no direct edits |
| package manifests | A | owner requesting dependency explains need/license |

Integrate at least at midday and end of day. Before merge:

1. rebase/update from integration branch;
2. run owned tests;
3. state contract changes explicitly;
4. merge small coherent commits;
5. run combined server tests after merge.

## 8. Three-day coordination schedule

### Day 1

- All: run baseline and build the thin Fake-executor vertical path.
- A: contracts, Session, DAG and basic Scheduler.
- B: Fake/real executor adapter prototype and completion signal.
- C: Event Store, graph/timeline shell and first storyboard.
- Exit: browser -> Session -> fixed DAG -> fake execution -> real event UI.

### Day 2

- A: Planner validation, dynamic selection, parallel scheduling and budgets.
- B: real Agents, Artifact verification, fault injection and recovery.
- C: real API integration, recovery UI, metrics and first full recording.
- Exit: real multi-Agent Session with a recoverable controlled failure.

### Day 3

- Morning: feature freeze, negative tests, cleanup, redaction, regression and five complete demo runs.
- Afternoon: bug fixes only; final recording/editing, architecture/README review and submission validation.
- Exit: `npm run check`, reproducible demo, final edited and uncut videos.

## 9. Cross-review

- A reviews B for execution-contract and state-machine correctness.
- B reviews C for whether displayed evidence matches real execution.
- C reviews A for whether API/events make the coordination story understandable.
- All three review the final video and must be able to explain the complete architecture.

## 10. Team-wide definition of done

- A new reviewer can follow setup instructions and run the platform.
- The baseline still works.
- A real Session coordinates at least three Agents.
- One failure is injected, classified, recovered and visible.
- Artifacts are mechanically verified.
- All required IDs and relationships are inspectable.
- Core positive and negative tests pass.
- No secret or private information appears in code, logs, UI or video.
- The three-minute recording tells one coherent end-to-end story.

