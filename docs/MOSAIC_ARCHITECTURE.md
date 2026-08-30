# MOSAIC Architecture — one page

**MOSAIC** — Middleware for Orchestrated, Self-healing, Auditable, Intelligent
Collaboration. The team-designed middleware for Track 1 "Agent Launchpad".

The Starter Kit runs **one** Agent per Playground turn. MOSAIC adds the missing
coordination boundary: it plans multi-Agent work as a validated DAG, assigns
Tasks to the best-matching Agents, executes ready Tasks in parallel, verifies
each result, and recovers from failure through bounded retry, reassignment, or
human approval — while persisting the full evidence chain.

## Layered architecture

```mermaid
flowchart TB
    subgraph UX["Experience Layer — React Web UI"]
        UX_AGENT["Agent CRUD · lifecycle · Playground"]
        UX_MOSAIC["MOSAIC workspace — DAG · timeline · recovery · approval"]
    end

    subgraph API["Control Plane — Fastify"]
        API_AGENT["Agent + Playground routes"]
        API_COORD["Coordination routes<br/>create / start / stop / approve / reject"]
    end

    subgraph MID["Coordination Middleware — CoordinationService"]
        GATE["CollaborationGate<br/>single · sequential · parallel · dag"]
        PLAN["Planner → Zod-validated DAG"]
        TEAM["CapabilityTeamBuilder<br/>capability scoring → assignment"]
        SCHED["Graph scheduler<br/>parallel waves · atomic leases"]
        VERIF["MechanicalVerifier<br/>artifact + allowlisted command"]
        RECOV["ClassificationRecoveryPolicy<br/>retry · reassign · approve · stop"]
        ART["FileArtifactStore<br/>sha256 · path/symlink/size guards"]
    end

    subgraph EXEC["Execution & Runtime"]
        EXECUTOR["Executor<br/>Fake (default) | AgentService (real) | fault-injected"]
        RUNTIME["AgentService → Codex CLI<br/>local-process | container"]
    end

    subgraph DATA["Data Layer"]
        STORE["JSON store<br/>sessions · tasks · attempts · artifacts · events"]
    end

    UX_AGENT --> API_AGENT
    UX_MOSAIC --> API_COORD
    API_AGENT --> RUNTIME
    API_COORD --> MID
    MID --> EXECUTOR
    EXECUTOR --> RUNTIME
    RUNTIME --> ARK["Volcengine Ark Responses API"]
    MID --> STORE
    EXECUTOR --> STORE
```

The left column (Experience → Control Plane → Middleware → Data) is the trusted,
deterministic TypeScript path. The Agent Runtime and Ark model sit on the right
and are treated as untrusted: every result they produce is re-validated at the
middleware boundary before it changes state.

## Session data flow

```mermaid
sequenceDiagram
    actor User
    participant UI as MOSAIC UI
    participant SVC as CoordinationService
    participant PLAN as Planner + Gate
    participant TEAM as CapabilityTeamBuilder
    participant EXEC as Executor (Fake / Agent)
    participant VER as Verifier + ArtifactStore
    participant REC as RecoveryPolicy
    participant STORE as JSON store

    User->>UI: create session (userTask + Agents)
    UI->>SVC: POST /coordination/sessions
    SVC->>PLAN: plan(userTask)
    PLAN-->>SVC: validated DAG + topology
    SVC->>TEAM: select(candidates)
    TEAM-->>SVC: per-Task Agent assignment
    SVC->>STORE: session + tasks + session.created / plan.created / agent.selected

    User->>UI: Start
    UI->>SVC: POST /start
    SVC->>SVC: launchExecution
    loop while ready Tasks remain
        SVC->>EXEC: executeTask (parallel, ≤ maxConcurrentTasks)
        EXEC-->>SVC: result (succeeded | failed + failureClass)
        alt succeeded
            SVC->>VER: capture artifacts + verify
            VER-->>SVC: accepted / rejected
            SVC->>STORE: task.succeeded + verification.passed + artifacts
        else failed
            SVC->>REC: decide(failedAttempt)
            alt retry / reassign
                REC-->>SVC: retry or nextAgentId
                SVC->>STORE: task.retried / task.reassigned
            else request_approval
                SVC->>STORE: status = waiting_approval
                User->>SVC: approve / reject
            else stop
                SVC->>STORE: session.failed
            end
        end
    end
    SVC->>STORE: session.completed
```

## Trust boundaries & enforcement points

LLMs only propose semantics; deterministic code owns state, limits, leases, and
recovery.

| Boundary | What crosses it | Enforcement |
| --- | --- | --- |
| Model → control plane | Plan, assignment, recovery proposals | Zod schemas + `validatePlannerOutput` / `validateTeamBuilderOutput` / `validateRecoveryDecision` |
| Concurrency | Ready-Task leases | Atomic `pending → ready → leased` store transitions (409 on conflict); `maxConcurrentTasks` budget |
| Agent workspace → coordination store | Artifact files | `FileArtifactStore`: `realpath` + symlink/file check, path-escape rejection, per-file/attempt size caps, sha256 hash |
| Coordination → host | Commands in `command` criteria | `MechanicalVerifier` allowlist regexes (`npm test`, `npm run build`, …) + exit-code gate; no runner ⇒ rejected |
| Failure → recovery | `failureClass` | `classifyExecutionFailure` → `ClassificationRecoveryPolicy`: retry / reassign-to-different-Agent / `request_approval` / stop, bounded by `maxAttemptsPerTask` |
| Budgets | Tasks, attempts, events | `maxTasks`, `maxConcurrentTasks`, `maxAttemptsPerTask`, `maxEvents` enforced in `CoordinationService` / `CoordinationStore` |

## Evidence & instrumentation

Every transition is recorded as a typed `CoordinationEvent`
(`session.*`, `task.*`, `attempt.*`, `verification.*`, `recovery.decided`,
`task.retried`, `task.reassigned`, `session.approved`, `session.rejected`, …)
and projected into metrics (`totalAttempts`, `failedAttempts`, `retryAttempts`,
`recoveredTasks`, `acceptedArtifacts`, `recoveryStatus`). The MOSAIC workspace
renders the DAG, event timeline, per-Task evidence, and recovery/approval panel
from these records — never from fabricated execution state.

## Known limitations

- Single-process: coordination shares the baseline JSON store (no cross-process resume).
- The current heuristic Planner generates generic topology templates and does not
  yet compile exact user-specified ordering, fixed Agent assignments, or
  turn-taking protocols into a DAG. The documented two-Agent alternating-count
  acceptance scenario therefore requires control-plane work before it is usable.
- The heuristic planner emits only `artifact`/`worker-output` criteria; allowlisted
  command verification runs only when a plan explicitly requests a `command` criterion.
- `manual_review` criteria are not yet semantically reviewed by an LLM.
- Artifacts are captured only when an Agent actually reports `artifactPaths`.
