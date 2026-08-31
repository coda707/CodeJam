# Devpost Submission Copy

Ready-to-paste text for the Devpost submission. Contains no secrets.

## Elevator pitch

MOSAIC is middleware that turns a handful of independent, unreliable AI agents
into an adaptive, verifiable, self-healing engineering team: it decides when
collaboration is actually worth it, plans the work as a DAG, assigns each task
to the best Agent, verifies every result mechanically, and recovers
automatically when something fails — leaving a full audit trail of who did what
and why.

## About the project

### What inspired us

The Starter Kit runs one Codex Agent per Playground turn. That works until a
request decomposes into independent pieces of work, a step fails and needs a
bounded retry, or a human has to approve a risky step — at which point a single
Agent is no longer enough. We also noticed that "many agents talking" is not the
same as "many agents working": recent research (Nature Machine Intelligence,
2026) shows multi-Agent collaboration does not always pay off, because
coordination cost and error propagation can eat the gains. That reframed the
problem for us — not "how do we get agents to chat", but "when is collaboration
worth it, who should do what, how do we verify the result, and what happens when
it fails".

### How we built it

MOSAIC sits on top of the existing AgentService and Codex Runner — we never
bypass the platform. Our core decision was to split responsibility: LLMs own the
open-ended judgment (planning, reviewing), while deterministic TypeScript owns
state, limits, leases, and recovery. The pipeline runs a Collaboration Gate
(single vs. multi-Agent, plus topology), a Planner that emits a Zod-validated
DAG, a capability-based Team Builder, a graph Scheduler with atomic leases (no
double execution), a mechanical Verifier that checks outputs and allowlisted
commands such as `npm test`, and a Classification Recovery policy that maps each
failure class to a targeted action — retry, reassign, spawn a repair task,
re-plan the unfinished subgraph, or pause for human approval. We also added
structured constraint workflows (explicit ordering, assignment, and turn-taking)
and safe artifact capture with SHA-256 hashing.

### Challenges we faced

The hard parts were about trust and correctness, not scale. First, isolation:
coordination Runs were silently polluting the Playground's `codexThreadId` and
transcript, so we introduced a `purpose` field to keep coordinated work from
leaking into a human's conversation. Second, recovery that cannot loop: a
repair or re-plan must respect an attempt budget and mark the original task
`superseded` (not `failed`) so it cannot be recovered forever. Third,
verification you can trust: we refuse to mark work "done" from an Agent's
natural-language claim — an acceptance criterion must be a real command exit
code or a hashed artifact. Finally, re-planning without re-doing work: a
no-progress failure re-derives only the unfinished subgraph, so succeeded tasks
are never re-run.

### What we learned

Deterministic code should own state, not the LLM. Bounded, classified recovery
beats unbounded retry. And the difference between "several agents chatting" and
"a verifiable team" is the acceptance criteria plus the audit trail — the
timeline that lets a human see who did what and why.

### Built with

React, TypeScript, Fastify, Zod, Vitest, Codex CLI, the Volcengine Ark Responses
API, and Docker / Colima / Podman for local execution.
