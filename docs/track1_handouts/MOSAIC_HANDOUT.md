# MOSAIC Project Handout

> **Project:** MOSAIC - Middleware for Orchestrated, Self-healing, Auditable and Intelligent Collaboration  
> **Track:** Agent Launchpad: Design and Build Lightweight Agent Middleware  
> **Starter Kit:** `CodeJam-main`  
> **Team execution guide:** [MOSAIC_TEAM_RESPONSIBILITIES.md](./MOSAIC_TEAM_RESPONSIBILITIES.md)

## 1. One-sentence definition

MOSAIC is a middleware layer that turns independent Codex Agents into an adaptive, verifiable and self-healing team: it decides when collaboration is useful, creates a task graph, selects Agents, coordinates execution, validates artifacts, recovers from failures and exposes the complete coordination trace.

## 2. Problem and value

The Starter Kit can run individual Agents but does not coordinate multiple Agents. Naive group chat is insufficient because it cannot guarantee correct ordering, prevent duplicate work, validate outputs, recover from a failed Agent or explain why a team succeeded or failed.

MOSAIC addresses this with five principles:

1. **Hybrid control:** LLMs plan and judge semantics; deterministic code owns state, limits and consistency.
2. **Adaptive collaboration:** simple work may use one Agent; decomposable or high-risk work uses an appropriate multi-Agent topology.
3. **Artifact-based collaboration:** Agents exchange typed artifacts, not only free-form chat.
4. **Verification before completion:** tests and acceptance criteria decide completion, not an Agent's claim.
5. **Failure-aware recovery:** classify the failure, then retry, reassign, re-plan, stop or request approval.

## 3. Source-of-truth order

1. Official Track 1 PDF and latest organizer instructions.
2. This handout and the team-responsibility document.
3. Existing Starter Kit behavior and tests.
4. Referenced frameworks and papers as design inspiration.

If sources conflict, preserve the official Track requirements and the working Starter Kit lifecycle.

## 4. Required outcome

The submission must demonstrate a real browser-to-backend-to-Agent path:

```text
User task
  -> collaboration decision
  -> task DAG
  -> multiple real Codex Agent Runs
  -> structured artifacts
  -> failure and recovery
  -> mechanical verification
  -> final result and coordination evidence
```

The existing Agent CRUD, lifecycle, Playground, persistence, Codex execution and local container path must continue to work.

## 5. Scope

### P0 - submission-critical

- Create and inspect a `CoordinationSession`.
- Generate and validate a structured task DAG.
- Coordinate at least three existing Agents.
- Support sequential and parallel dependencies.
- Persist Task, Attempt, Artifact and Event records.
- Execute real Agent Runs through the existing `AgentService`.
- Show Agent/Task/Run/Attempt relationships.
- Inject one controlled failure and recover through retry or reassignment.
- Verify at least one result using a real command/test.
- Display a task graph, event timeline and final verification result.
- Preserve the baseline and pass `npm run check`.

### P1 - strong differentiators

- Collaboration Gate: choose single Agent or multi-Agent topology with an explanation.
- Capability-based dynamic Agent selection.
- Time, token, turn and retry budgets.
- Structured failure classification and targeted recovery.
- Agent-isolated code changes delivered as patches/commits.
- Single-Agent vs static multi-Agent vs MOSAIC comparison.
- Redaction, event-size limits and explicit retention bounds.

### P2 - optional extensions

- Reviewer council and meta-reviewer.
- Handoff, review and dynamic-graph topologies.
- Human approval for high-risk actions.
- A2A/MCP adapters.
- Cross-process durable resume.
- Policy optimization from historical coordination traces.

## 6. Non-goals

- Replacing the Starter Kit UI, `AgentService`, Codex CLI or container Runtime.
- Adding a Python sidecar solely to use an existing framework.
- Building production OAuth, a general container scheduler or a commercial multi-tenant platform.
- Claiming that more Agents are always better.
- Treating a free-form group chat as sufficient coordination.

## 7. Architecture

```text
React UI
  |  create/stop session, graph, timeline, artifacts, metrics
  v
Fastify Coordination Routes
  v
MultiAgentCoordinator
  |-- CollaborationGate
  |-- Planner + DAG Validator
  |-- TeamBuilder
  |-- GraphScheduler
  |-- BudgetManager
  |-- RecoveryManager
  |-- Verifier
  `-- IntegrationManager
  |
  |-- Coordination Store (metadata and state)
  |-- Event Store / Metrics Projection
  `-- Artifact Store (files, patches and reports)
  v
Existing AgentService
  v
Existing AgentRunner implementations
  v
Codex CLI + Ark + isolated Agent workspaces
```

### Mandatory architectural decisions

- Implement the coordinator in TypeScript inside the existing Fastify server.
- Keep the current Agent execution path; the coordinator calls it as a worker adapter.
- Store coordination metadata through the existing serialized JSON persistence for the POC.
- Store large artifacts on disk and only metadata/hash/path in JSON.
- Validate all LLM control outputs with Zod before changing system state.
- Use deterministic state transitions, leases/idempotency and termination limits.
- Never accept `"done"` from an Agent without checking its acceptance criteria.

## 8. Suggested server structure

```text
apps/server/src/multi-agent/
├── contracts.ts
├── coordination-service.ts
├── collaboration-gate.ts
├── planner.ts
├── team-builder.ts
├── graph-scheduler.ts
├── coordination-store.ts
├── coordination-routes.ts
├── agent-executor-adapter.ts
├── artifact-store.ts
├── verifier.ts
├── failure-classifier.ts
├── recovery-manager.ts
├── demo-faults.ts
├── event-store.ts
├── metrics-projector.ts
└── trace-routes.ts
```

The precise filenames may change, but module ownership and contracts must remain clear.

## 9. Core contracts

### CoordinationSession

```ts
type SessionStatus =
  | "planning"
  | "forming_team"
  | "executing"
  | "verifying"
  | "recovering"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

interface CoordinationSession {
  id: string;
  userTask: string;
  status: SessionStatus;
  topology: "single" | "sequential" | "parallel" | "manager_worker" | "review" | "dag";
  participantAgentIds: string[];
  rootTraceId: string;
  budget: CoordinationBudget;
  createdAt: string;
  completedAt?: string;
}
```

### TaskNode and Attempt

```ts
interface TaskNode {
  id: string;
  sessionId: string;
  title: string;
  instructions: string;
  dependencies: string[];
  requiredCapabilities: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  status: "pending" | "ready" | "leased" | "running" | "verifying" |
          "succeeded" | "failed" | "blocked" | "superseded";
  assignedAgentId?: string;
  attemptCount: number;
}

interface TaskAttempt {
  id: string;
  taskId: string;
  agentId: string;
  runId?: string;
  status: "created" | "running" | "succeeded" | "failed" |
          "timed_out" | "cancelled" | "reassigned";
  retryOfAttemptId?: string;
  startedAt?: string;
  completedAt?: string;
  errorClass?: FailureClass;
}
```

### Artifact and Event

```ts
interface CoordinationArtifact {
  id: string;
  sessionId: string;
  taskId: string;
  producerAgentId: string;
  type: "plan" | "report" | "patch" | "commit" | "test_report" |
        "review" | "failure_report" | "final_result";
  path?: string;
  contentHash: string;
  verificationStatus: "unverified" | "accepted" | "rejected";
}

interface CoordinationEvent {
  id: string;
  sessionId: string;
  taskId?: string;
  attemptId?: string;
  agentId?: string;
  runId?: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
```

### Required structured LLM outputs

- Planner output: task nodes, dependencies, capabilities, acceptance criteria and suggested topology.
- Worker output: summary, produced artifact paths, evidence and unresolved issues.
- Reviewer output: pass/fail, cited evidence and required fixes.
- All schemas must reject unknown control fields and bound text/array sizes.

## 10. Execution algorithm

1. Create a Session and correlation IDs.
2. Collaboration Gate estimates decomposability, specialization, risk, parallelism and coordination cost.
3. Planner returns a typed DAG; deterministic code validates IDs, dependencies, limits and acyclicity.
4. Team Builder scores available Agents by capability, reliability, load and expected cost.
5. Scheduler marks dependency-free nodes ready and leases them atomically.
6. Executor Adapter calls the existing `AgentService` and waits for Run completion.
7. Worker results become hashed Artifacts; events are appended for every material transition.
8. Verifier checks schema and mechanical acceptance criteria before optional semantic review.
9. Failure Classifier selects retry, reassign, re-plan, stop or approval under the remaining budget.
10. Verified nodes unlock dependent nodes; final integration runs global acceptance tests.
11. Session completes only when every required node is verified and the final contract passes.

## 11. Reliability rules

- An Attempt has one Agent and at most one active Run.
- A Task may have multiple Attempts, linked by `retryOfAttemptId`.
- A lease prevents duplicate execution and expires after a bounded interval.
- Completed verified work is not repeated during re-planning.
- Every loop has `maxTurns`, `maxAttempts`, deadline and no-progress limits.
- Cancellation must propagate Session -> Task -> Attempt -> Agent Run.
- After failure/cancellation, no Agent may remain permanently busy.
- Controlled demo faults must be explicit, one-shot and recorded as fault injection.

### Failure policy

| Failure class | Default action |
| --- | --- |
| Transient provider error | bounded backoff retry |
| Timeout | cancel, then retry once or reassign |
| Malformed structured output | request format repair without repeating completed work |
| Test/acceptance failure | create repair task with evidence |
| Capability mismatch | penalize assignment and reassign |
| Conflicting artifacts | create conflict-resolution task |
| No progress | re-plan unfinished subgraph |
| Budget exceeded | stop or request approval |
| Unsafe action | deny, cancel and record decision |

## 12. Persistence and safety

- Extend the existing database with sessions, tasks, attempts, artifacts and bounded events.
- Cap events per Session and payload size; do not store raw token streams.
- Redact Ark keys, bearer tokens and configured secret patterns before persistence or UI display.
- Store artifacts below a Session-specific root; resolve and verify all paths before file operations.
- For code collaboration, Agents modify isolated copies/branches. Only the trusted control plane promotes verified patches into the canonical workspace.
- Preserve existing container and output limits; they are baseline safeguards, not the project's central claim.

## 13. API contract

```text
POST /api/coordination/sessions
GET  /api/coordination/sessions/:id
POST /api/coordination/sessions/:id/start
POST /api/coordination/sessions/:id/stop
GET  /api/coordination/sessions/:id/tasks
GET  /api/coordination/sessions/:id/events
GET  /api/coordination/sessions/:id/artifacts
GET  /api/coordination/sessions/:id/metrics
```

Polling is acceptable for the POC. Reuse the existing frontend pattern rather than requiring WebSocket support.

## 14. UI requirements

- Session creation with task and participant selection or automatic selection.
- Collaboration decision and explanation.
- DAG with Agent, Task and status.
- Timeline showing planning, assignment, execution, verification and recovery.
- Attempt relationship: original failure, retry/reassignment and final result.
- Artifact/test evidence panel.
- Metrics: total Agent calls, tokens, duration, failed attempts and recovery result.
- Stop control and clear terminal state.

## 15. Verification and evaluation

### Automated tests

- DAG validation and cycle rejection.
- Atomic lease/idempotency and no duplicate Task execution.
- Sequential and parallel dependency behavior.
- Run/Attempt/Agent correlation.
- Timeout cancellation, retry limit and reassignment.
- Malformed Artifact rejection.
- Mechanical verifier pass/fail behavior.
- Secret redaction and payload bounds.
- Session stop and final-state cleanup.
- Original Agent lifecycle and Playground regression tests.

### Comparative evaluation

Compare:

1. one Agent;
2. fixed/static multi-Agent flow;
3. MOSAIC.

Record task success, acceptance-test pass rate, total tokens, latency, Agent calls, duplicate work, failed Attempts, recovery success and human interventions. Include at least one ablation such as disabling recovery or dynamic selection.

## 16. Recorded three-minute demo

Use one real Session ID throughout the edited video. Waiting time may be accelerated, but execution evidence must remain real.

Suggested sequence:

| Time | Content |
| --- | --- |
| 0:00-0:18 | problem: independent Agents are not reliable collaboration |
| 0:18-0:35 | MOSAIC architecture |
| 0:35-0:58 | submit real task; show collaboration decision and DAG |
| 0:58-1:25 | multiple Agents execute in parallel/sequentially |
| 1:25-1:57 | controlled timeout/invalid artifact and automatic recovery |
| 1:57-2:25 | test failure, repair and real verification |
| 2:25-2:45 | completed graph, artifacts and passing checks |
| 2:45-3:00 | single/static/MOSAIC comparison and value |

Keep an uncut recording as evidence. Never show secrets, personal notifications or static mock results presented as execution.

## 17. Scoring alignment

| Track criterion | MOSAIC evidence |
| --- | --- |
| End-to-end middleware behavior - 40% | browser -> coordinator -> real Agents -> artifacts -> verification -> recovery |
| Technical design and integration - 25% | hybrid control, DAG, typed artifacts, adaptive team, focused reuse of Starter Kit |
| Verification and robustness - 20% | fault injection, deterministic tests, retry/reassign, cleanup, redaction and comparison |
| Demo and reproducibility - 15% | one-command baseline, clear graph/timeline, repeatable three-minute recording and documented limits |

## 18. Reference shortlist

### Frameworks and protocols

- [Microsoft Agent Framework](https://github.com/microsoft/agent-framework): graph workflows, checkpointing, HITL and observability.
- [Google ADK TypeScript](https://github.com/google/adk-js): sequential, parallel, loop, routing and A2A patterns.
- [LangGraph.js](https://github.com/langchain-ai/langgraphjs): durable graph/state-machine patterns.
- [Mastra](https://github.com/mastra-ai/mastra): TypeScript workflows, supervisor Agents and observability.
- [AutoGen](https://github.com/microsoft/autogen): actor/event runtime and Magentic-One reference; use as design inspiration because the project is in maintenance mode.
- [MetaGPT](https://github.com/FoundationAgents/MetaGPT): SOP and artifact-oriented Agent collaboration.
- [ChatDev](https://github.com/OpenBMB/ChatDev): software-team roles and structured collaboration.
- [MultiAgentBench/MARBLE](https://github.com/ulab-uiuc/MARBLE): multi-Agent coordination evaluation.
- [A2A Protocol](https://a2a-protocol.org/latest/): optional cross-Agent interoperability.

### Papers

- [Magentic-One](https://arxiv.org/abs/2411.04468): orchestrator ledger, planning and recovery.
- [MetaGPT](https://arxiv.org/abs/2308.00352): SOP-based multi-Agent collaboration.
- [DyLAN](https://arxiv.org/abs/2310.02170): dynamic Agent team selection.
- [Evolving Orchestration](https://arxiv.org/abs/2505.19591): adaptive central orchestration.
- [MacNet](https://arxiv.org/abs/2406.07155): graph topology for Agent communication.
- [MARS](https://openreview.net/forum?id=UWRfA2eWKE): efficient independent review and meta-review.
- [Who & When](https://proceedings.mlr.press/v267/zhang25cq.html): multi-Agent failure attribution.
- [MultiAgentBench](https://aclanthology.org/2025.acl-long.421/): process-aware collaboration evaluation.
- [Self-Healing Agentic Orchestrators](https://arxiv.org/abs/2606.01416): failure-aware, budgeted and verification-guided recovery.

## 19. Definition of done

MOSAIC is done when a reviewer can start the baseline, create a Session from the browser, observe three real Agents complete a task graph, see one controlled failure recover automatically, inspect the evidence, verify the final result mechanically, stop or control the Session, and reproduce the same behavior from the documentation with no exposed secret.

