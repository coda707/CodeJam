# MOSAIC UI Structure

This document fixes the information architecture, component responsibilities,
state ownership, and backend data needs for the MOSAIC frontend. It does not fix
the final visual style.

## Product narrative

A reviewer should understand a Session in this order:

1. what was requested and whether the Session is active, blocked, or complete;
2. which Tasks exist, how they depend on one another, and who owns each Task;
3. what is happening on the selected Task;
4. why a failure occurred and how recovery changed the execution path;
5. which outputs were verified and what evidence supports the final result;
6. whether MOSAIC improved reliability, cost, or latency compared with a
   baseline.

This order is stable. Typography, colors, spacing, animation, and exact panel
placement remain open until the final visual pass.

## Page regions

| Priority | Region | Responsibility |
| --- | --- | --- |
| 1 | Workspace header | Identify MOSAIC, show Fake or Agent executor mode, and surface global errors without hiding backend state. |
| 2 | Session rail | Create a Session, select participants, list prior Sessions, and select the active Session. |
| 3 | Session command bar | Show the authoritative Session status, topology, participant count, budget summary, failure reason, and valid Start or Stop actions. |
| 4 | Task workspace | Render the dependency graph and a selected-Task inspector as the main focus of the page. |
| 5 | Recovery and approval | Explain the failed Attempt, failure class, selected recovery action, replacement Agent or retry link, and any required human decision. |
| 6 | Evidence workspace | Provide Attempts, Runs, Artifacts, verification evidence, and the Event timeline without mixing them into graph layout code. |
| 7 | Metrics summary | Show authoritative calls, Attempts, failures, recovery result, tokens, duration, and verified Artifact totals. |
| 8 | Evaluation comparison | Compare Single Agent, Static Team, and MOSAIC after the evaluation result format exists. |

On narrow screens, the Session rail may become a drawer and the Task inspector
may move below the graph. The information order must remain unchanged.

## Component boundaries

The current `CoordinationWorkspace.tsx` remains the entry point but should be
split incrementally without changing behavior first.

```text
CoordinationWorkspace
  SessionRail
    SessionCreateForm
    SessionList
  SessionDetail
    SessionCommandBar
    TaskWorkspace
      TaskGraph
      TaskInspector
    RecoveryPanel
    EvidenceWorkspace
      AttemptList
      ArtifactList
      EventTimeline
    MetricsSummary
```

| Component | Owns | Must not own |
| --- | --- | --- |
| `CoordinationWorkspace` | Query orchestration, polling lifecycle, selected Session ID, shared error routing, and mutation coordination. | Graph layout, evidence formatting, or locally invented execution status. |
| `SessionRail` | Creation and Session selection UI. | Session execution state transitions. |
| `SessionCommandBar` | Session summary and valid user actions supplied by the container. | Direct API calls or optimistic terminal status. |
| `TaskGraph` | Dependency layout, node selection, keyboard navigation, and visual status projection. | Fetching data, changing Task status, or recovery decisions. |
| `TaskInspector` | Selected Task instructions, criteria, Agent, Attempts, dependencies, and verified outputs. | Global Session controls. |
| `RecoveryPanel` | Failure-to-recovery narrative and approval controls when the backend supports them. | Inferring recovery success before an authoritative event or status exists. |
| `EvidenceWorkspace` | Navigation between Attempt, Artifact, and Event evidence. | Metrics calculation or server mutations. |
| `AttemptList` | Attempt, Run, Agent, usage, error, and retry or reassignment links. | Recovery policy decisions. |
| `ArtifactList` | Artifact metadata, verification status, preview, and download actions. | Reading arbitrary workspace paths. |
| `EventTimeline` | Ordered persisted events and correlation IDs. | Reconstructing missing events from UI state. |
| `MetricsSummary` | Presentation of the server metrics projection. | Recalculating authoritative metrics from partial browser data. |

Presentational components receive typed data and callbacks. API access remains in
the workspace container or dedicated coordination hooks so a later redesign does
not alter execution behavior.

## State ownership

Server-authoritative state:

- Session, Task, Attempt, Artifact, Event, and Metrics records;
- Agent and Run correlation;
- execution, verification, recovery, approval, and terminal status;
- budgets, usage, hashes, and verification outcomes.

Browser-owned state:

- selected Session and selected Task;
- active evidence tab;
- expanded rows and inspector visibility;
- form drafts, filters, and graph viewport;
- loading, request error, and stale-data indicators.

The browser may derive labels, counts for display, lookup maps, graph positions,
and accessible descriptions. It must not infer successful execution, recovery,
or verification when the backend has not recorded it.

## Session state behavior

| Status | Primary presentation | Allowed action |
| --- | --- | --- |
| `planning` | Plan created and ready to start. | Start. |
| `forming_team` | Team selection in progress. | Stop. |
| `executing` | Active Tasks and Agent ownership. | Stop. |
| `verifying` | Output awaiting mechanical or semantic verification. | Stop. |
| `recovering` | Failed Attempt and recovery decision in progress. | Stop. |
| `waiting_approval` | Blocking reason and requested decision. | Approve or reject after the API exists. |
| `completed` | Final verified result and terminal evidence. | No execution mutation. |
| `failed` | Failure reason and last recovery evidence. | No execution mutation until an explicit restart contract exists. |
| `cancelled` | Cancellation reason and preserved evidence. | No execution mutation. |

Empty, initial loading, refresh failure, mutation failure, and stale polling
states must be distinct. A request failure must not replace the last known
authoritative Session status.

## Available data contract

The frontend can already query:

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

These records are sufficient for the Session rail, command bar, general DAG,
Task inspector, Attempt links, metadata-only Artifact list, Event timeline, and
Metrics summary.

## Cross-workstream data requests

These are capability requests, not approved endpoint names. Developer A remains
the merge owner for shared contracts and routes.

| Priority | Needed capability | Provider | Frontend use |
| --- | --- | --- | --- |
| P0 | Stable typed payloads for planning, Agent selection, verification, recovery, reassignment, retry, and integration events. | A with B evidence requirements | Human-readable Timeline and RecoveryPanel without parsing arbitrary payloads. |
| P0 | Approval and rejection mutations plus the resulting Session transition. | A | Real controls for `waiting_approval`. |
| P0 | Safe Artifact content metadata and preview or download access. | B with A route registration | Inspect verified evidence without exposing workspace paths. |
| P0 | `WorkerOutput` in the frontend Attempt type and response contract. | A contract, consumed by C | Show verified upstream and final outputs in TaskInspector. |
| P1 | Recovery outcome, replaced Agent, repair Task, and failure attribution evidence. | B | Explain why recovery occurred and whether it succeeded. |
| P1 | Integration result and final-result Artifact correlation. | B | Identify the final deliverable and its verification evidence. |
| P1 | Stable evaluation result format for Single Agent, Static Team, and MOSAIC. | C, reviewed by A and B | Build the comparison view from real runs. |

Until a capability is accepted, the UI should show an explicit unavailable or
metadata-only state. It must not simulate the missing backend action.

## Refresh and interaction rules

- Continue polling while the Session is forming a team, executing, verifying,
  or recovering. A later event stream may replace polling without changing view
  components.
- Keep the last successful snapshot visible during a refresh error and show that
  it may be stale.
- Disable duplicate mutations while a request is in flight.
- Preserve the selected Task when refreshed data still contains it; otherwise
  select the first failed, active, or incomplete Task before a succeeded Task.
- Selecting a graph node updates TaskInspector and filters relevant evidence;
  it does not change backend state.
- Every Agent, Task, Attempt, Run, Artifact, and recovery link must expose its
  full identifier through accessible text or a copy action.

## Frontend implementation order

1. Split `CoordinationWorkspace.tsx` along these boundaries with no intentional
   visual change.
2. Add general dependency-graph selection and TaskInspector using current APIs.
3. Add typed recovery and evidence projections that degrade explicitly when a
   requested backend capability is absent.
4. Add Artifact preview or download and approval controls only after their APIs
   are accepted.
5. Add component, state, and critical-flow tests.
6. Add the real evaluation comparison.
7. Perform the final visual redesign, responsive pass, accessibility audit, and
   recorded-demo polish.

## Acceptance checklist

- Real API data drives every execution and evidence view.
- A reviewer can identify each Agent, Task, Attempt, Run, and Artifact.
- General DAG dependencies remain understandable beyond the two-Task default.
- A failed Attempt is visibly linked to retry, reassignment, repair, approval,
  or stop evidence.
- Verification evidence and the final result are inspectable.
- Loading, stale, error, empty, active, approval, and terminal states are clear.
- Keyboard and screen-reader users can select graph nodes and inspect details.
- The visual layer can be replaced without moving API calls into view
  components or changing server-authoritative state rules.
