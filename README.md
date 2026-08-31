# MOSAIC

MOSAIC (Middleware for Orchestrated, Self-healing, Auditable, Intelligent
Collaboration) is the team-designed middleware story for Track 1 "Agent
Launchpad". The Starter Kit runs **one** Agent per Playground turn; MOSAIC
coordinates **several** Agents through a shared, auditable plan.

**Problem.** A single Agent is not enough when a request decomposes into
independent work items, when a task fails and needs a bounded retry or a
different Agent, or when a human must approve a risky step. The platform had no
way to plan, assign, verify, and recover multi-Agent work.

**Design.** LLMs provide semantics (planning, judging); deterministic
TypeScript owns state, limits, leases, and recovery:

- **Collaboration Gate + Planner** choose a topology
  (`single` / `sequential` / `parallel` / `dag`) and emit a Zod-validated DAG.
- **Capability-based team builder** assigns each Task to the best-matching
  Agent by capability keywords, falling back to participant order.
- **Parallel graph scheduler** runs ready Tasks concurrently up to a budget,
  with atomic `pending → ready → leased` transitions (no double execution).
- **Mechanical verifier** checks WorkerOutput and, in Agent mode, allowlisted
  commands (`npm test`, `npm run build`, …) in the producer workspace.
- **Classification recovery** maps a failure class to a targeted action: retry
  transient/malformed failures, reassign timeouts and capability mismatches,
  spawn a **repair** Task for acceptance failures, **re-plan** the unfinished
  subgraph on no-progress, pause for **human approval** when opted in, or stop —
  all bounded by `maxAttemptsPerTask`.
- **Structured constraint workflows** accept a `workflow` field (ordered tasks,
  explicit `assignedAgentId`, and `turnTaking` round-robin) so the team builder
  never overrides a user's assignment.
- **Workflow authoring UI** lets users define Task keys, dependencies,
  capabilities, fixed Agent assignments, round-robin routing, result files, and
  allowlisted verification commands before creating a Session.
- **Safe artifact capture** writes files with path/symlink/size guards and
  sha256 content hashing.
- **Event + metrics projection** persists the whole chain for the timeline,
  DAG, and verification views.

## MOSAIC Architecture

See [the one-page MOSAIC architecture diagram](docs/MOSAIC_ARCHITECTURE.md)
for the coordination data flow, trust boundaries, verification point, and
recovery path.

### Demo without Ark (Fake executor)

No API key or container engine required — the Fake executor drives the full
control-plane path:

```bash
npm install
npm run dev                # server on :3000, web on :5173
# open http://localhost:5173 → MOSAIC → create a session → Start
```

In the New Session panel, select the participant Agents and choose **Add** under
Workflow to replace heuristic planning with an explicit execution contract.
Every authored Task includes a captured result file and an allowlisted command
(`npm test`, `npm run test|build|check`, `npx vitest run`, or `node --test`) so
Agent-mode completion has mechanical evidence. Enable **Round-robin routing**
to alternate Tasks in the displayed participant order. A fixed Task assignment
takes precedence over round-robin routing.

- `Build several independent modules` produces a **parallel** DAG.
- To watch a failure auto-recover (retry/reassign): restart with
  `COORDINATION_DEMO_FAULT=transient`, then run `node scripts/demo-recovery.mjs`.
- To watch self-healing (repair / replan): restart with
  `COORDINATION_DEMO_FAULT=test_failure` or `COORDINATION_DEMO_FAULT=no_progress`,
  then run `node scripts/demo-repair-replan.mjs repair` or `… replan`.
- To watch human approval: restart with `COORDINATION_DEMO_FAULT=test_failure`
  and `COORDINATION_TEST_FAILURE_ACTION=request_approval`, then run
  `node scripts/demo-approval.mjs` (or Approve/Reject from the UI).
- To compare strategies and export evidence, run `node scripts/evaluate.mjs`
  (or `node scripts/evaluate.mjs --fixture` for a schema-valid sample without a
  server).

### Demo with real Agents

```bash
cp .env.example .env        # fill ARK_API_KEY + ARK_MODEL, set COORDINATION_EXECUTOR=agent
npm run dev -w @launchpad/server
node scripts/integration-real-agents.mjs
```

### Known limitations

- Coordination is single-process on the shared JSON store (no cross-process resume).
- The default heuristic planner emits only `artifact`/`worker-output` criteria,
  so allowlisted command verification runs only when a plan requests a `command`.
- `manual_review` criteria are not yet semantically reviewed by an LLM.
- Artifacts are captured only when an Agent actually reports `artifactPaths`.
- Re-plan (on `no_progress`) re-derives a plan from `userTask`; it does not
  replay the original `workflow` shape, so a structured workflow that hits
  no-progress is re-planned heuristically rather than reconstructed task-for-task.
- Playground isolation is forward-only: runs from before the `purpose` field
  existed are treated as Playground and are not rewritten.

### Future work

Given more time we would:

- Replay the original `workflow` shape on re-plan instead of re-deriving it
  heuristically, so constrained workflows recover task-for-task.
- Add semantic (LLM-judge) review for `manual_review` acceptance criteria, with
  mechanical checks always taking priority.
- Persist coordination sessions across process restarts (the store is currently
  single-process).
- Expose the full coordination trace through a machine-readable query/export API.
- Run the evaluation harness against real Ark executions, not only the fixture
  sample.

## Validation

```bash
npm run check
terraform fmt -check -recursive deploy/volcengine
docker compose config
```

With the application running, verify the MOSAIC browser/API path with
`npm run verify:mosaic`. Agent executor mode also requires
`MOSAIC_AGENT_IDS=id1,id2`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [MOSAIC architecture (one page)](docs/MOSAIC_ARCHITECTURE.md)
- [Local POC](docs/LOCAL_POC.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Team

Built by three developers with a backend / frontend / evidence split.

| Member | Focus | Contribution |
| --- | --- | --- |
| Zhou Zihan | Backend | Coordination control plane (session/task/event contracts, DAG validation, scheduler), Agent execution and Playground isolation, artifact capture and mechanical verification, failure classification and repair/re-plan recovery. |
| Dai Chuxin | Frontend | React coordination UI — session creation, DAG/timeline/attempt views, recovery and evidence panels, isolated Playground rendering. |
| Xperiamol | Evaluation & demo | Single/static/MOSAIC evaluation harness, demo scripts and fixtures, documentation and architecture diagram, demo recording. |

## License

[MIT](LICENSE)

------

# Volc Agent Launchpad

A minimal Agent platform for three-day middleware hackathons. It provides Agent
CRUD, a browser Playground, persistent workspaces, and Codex CLI backed by the
Volcengine Ark Responses API.

Run it locally with Docker, Colima, or rootless Podman, or deploy it to
Volcengine ECS.

> [!WARNING]
> This is a single-user proof of concept. It intentionally has no identity,
> tracing, audit, or hardened sandbox middleware. Do not use production data or
> credentials. See [SECURITY.md](SECURITY.md).

## Screenshots

### Agent Playground

![Agent Playground showing lifecycle controls, starter prompts, and the Codex Runtime](docs/assets/playground.jpg)

### Create an Agent

![Create Agent form with name, description, and workspace instructions](docs/assets/create-agent.jpg)

## Features

- React and TypeScript Web UI
- Agent create, edit, start, stop, delete, and multi-turn chat
- Fastify control plane with asynchronous Run state
- Persistent Agent workspaces and Codex sessions
- Disposable Docker, Colima, or Podman container for each local turn
- Docker and Terraform deployment paths for Volcengine ECS

## Requirements

- Node.js 22+
- npm 10+
- Docker, Colima, or Podman
- A Volcengine Ark API key and endpoint that supports the Responses API

Codex CLI is included in the Runtime image and is not required on the host.

## Local browser SOP

### 1. Check the local tools

Install Node.js 22+ and one supported container engine, then verify them:

```bash
node --version
npm --version
docker --version        # Docker Desktop, Docker Engine, or Colima
podman --version        # Use this instead when running Podman
```

Only one container engine is required. Codex CLI is already included in the
Runtime image.

### 2. Clone the repository

```bash
git clone <repository-url> volc-agent-launchpad
cd volc-agent-launchpad
```

Skip this step when already working from the repository root.

### 3. Start the POC

```bash
ARK_API_KEY=your-ark-api-key \
ARK_MODEL=ep-your-endpoint-id \
npm run poc
```

The first run installs Node.js dependencies and builds the Runtime image. The
script automatically selects Docker, Colima, or Podman.

### 4. Open the browser

Visit <http://localhost:3000>, or open it from the terminal:

```bash
open http://localhost:3000       # macOS
xdg-open http://localhost:3000   # Linux desktop
```

In the Web UI:

1. Select **Create Agent**.
2. Enter a name, description, and workspace instructions.
3. Select **Create Agent** again.
4. Enter a task in the Playground, for example:

   ```text
   Create a TypeScript hello-world CLI, add a test, and run it.
   ```

The Agent can write files, run commands, and continue the same Codex session in
later messages.

### 5. Stop and resume

Press `Ctrl+C` in the startup terminal. The script removes temporary Runtime
containers but keeps Agent workspaces and conversations.

- macOS state: `~/.volc-agent-launchpad/`
- Linux state: `.local/`
- Custom location: set `LOCAL_POC_DATA_ROOT`

Run the same `npm run poc` command to continue later.

### Select a specific container engine

Force Podman when multiple engines are installed:

```bash
CONTAINER_ENGINE=podman \
ARK_API_KEY=your-ark-api-key \
ARK_MODEL=ep-your-endpoint-id \
npm run poc
```

Colima uses `CONTAINER_ENGINE=docker` because it exposes the Docker CLI.

For a clean Linux host, follow the
[rootless Podman setup](docs/LOCAL_POC.md#rootless-podman-on-linux).

## Docker Compose

Create and edit the configuration:

```bash
./scripts/bootstrap-local.sh
```

Required values in `.env`:

```dotenv
ARK_API_KEY=your-ark-api-key
ARK_MODEL=ep-your-endpoint-id
APP_AUTH_TOKEN=replace-with-at-least-24-random-characters
```

Start the application:

```bash
docker compose up --build
```

Open <http://localhost:3000>. Stop it without deleting Agent data:

```bash
docker compose down
```

## Development

```bash
npm install
cp .env.example .env
npm install --global @openai/codex@0.111.0
npm run dev
```

- Web UI: <http://localhost:5173>
- API: <http://localhost:3000>

Use local paths in `.env` when running outside Docker:

```dotenv
APP_DATA_DIR=.data
AGENT_WORKSPACE_ROOT=workspaces
CODEX_HOME=codex-home
```

## Deployment

- [Existing Linux ECS with Docker](docs/DEPLOYMENT.md#existing-linux-ecs)
- [Complete Volcengine environment with Terraform](docs/DEPLOYMENT.md#terraform-deployment)
- [Local Docker, Colima, and Podman details](docs/LOCAL_POC.md)

The existing-ECS script deploys from the current source tree:

```bash
cp .env.example .env.production
./scripts/deploy-existing-ecs.sh .env.production
```

The Terraform path provisions VPC, subnet, security group, ECS, and EIP:

```bash
cp deploy/volcengine/terraform.tfvars.example \
  deploy/volcengine/terraform.tfvars
./scripts/deploy-volcengine.sh
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ARK_API_KEY` | Required | Ark model API key. |
| `ARK_MODEL` | Required | Responses-capable endpoint or model ID. |
| `ARK_BASE_URL` | Beijing v3 endpoint | Ark OpenAI-compatible API URL. |
| `APP_AUTH_TOKEN` | Empty on loopback | Shared demo token; use 24+ random characters remotely. |
| `RUNTIME_PROVIDER` | `local-process` | `container` for disposable local Runtime containers. |
| `COORDINATION_EXECUTOR` | `fake` | `agent` to execute MOSAIC Tasks through existing Agents. |
| `COORDINATION_RECOVERY` | `on` | `off` to stop on the first failure (used for the `without_recovery` ablation). |
| `COORDINATION_TEST_FAILURE_ACTION` | `repair` | `request_approval` to pause on an acceptance failure instead of repairing. |
| `COORDINATION_DEMO_FAULT` | `off` | `transient` / `timeout` / `test_failure` / `capability` / `no_progress` for one-shot demo faults. |
| `COORDINATION_ARTIFACT_ROOT` | Below `APP_DATA_DIR` | Session-scoped captured Artifact files. |
| `CODEX_SANDBOX_MODE` | `workspace-write` | Codex inner sandbox mode. |
| `CODEX_TIMEOUT_MS` | `600000` | Maximum duration of one turn. |
| `LOCAL_POC_DATA_ROOT` | Platform-specific | Local metadata, workspace, and session directory. |

See [.env.example](.env.example) for all Runtime and resource-limit options.

