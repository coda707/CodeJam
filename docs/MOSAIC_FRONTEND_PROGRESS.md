# MOSAIC Frontend Progress

## Current state

The frontend foundation is implemented and ready for the remaining Developer C
work. It consumes the coordination APIs as the authoritative source of Session,
Task, Attempt, Artifact, Event, and Metrics state.

Implemented frontend work:

- Session creation, participant selection, Session history, Start, and Stop.
- Responsive Task graph with exact dependency links and Task selection.
- Task inspection with instructions, criteria, Agent and Attempt identifiers,
  dependencies, WorkerOutput, and Artifact metadata.
- Attempt and Artifact evidence, persisted Event timeline, and Metrics summary.
- Loading, empty, mutation-error, active, and terminal Session presentation.
- Stale-data preservation with explicit Session-list and detail refresh recovery.
- Recovery evidence linking the failed Task, Attempt, failure class, decision,
  reason, and replacement Agent when recorded.
- A three-stage failure, decision, and outcome chain linked by persisted Attempt
  and Event identifiers.
- Human approval and rejection controls backed by the accepted Session APIs.
- Human-readable Timeline descriptions with the original Event type retained
  as an audit label.
- Copy actions for Session, Agent, Task, Attempt, Run, Artifact, and hash values.
- Responsive layouts from wide desktop to 320 px mobile screens.
- Dialog semantics, keyboard focus, selected-state semantics, reduced-motion
  support, long-content handling, and readable evidence typography.
- Isolated Agent creation and settings form state.

Primary frontend files:

- `apps/web/src/App.tsx`
- `apps/web/src/components/coordination/`
- `apps/web/src/api.ts`
- `apps/web/src/types.ts`
- `apps/web/src/styles.css`

## Validation completed

- Full workspace typecheck, tests, and production build pass in WSL.
- The deterministic Fake Executor acceptance flow passes.
- Browser acceptance covers Agent and MOSAIC empty, planning, executing,
  completed, unavailable-runtime, responsive, keyboard, long-content, approval,
  rejection, and recovery states.
- Approval continuation, rejection termination, and clipboard copy behavior pass
  against the real local API path.
- The browser console is clean during the accepted flows.

## Remaining Developer C work

Work that can continue before the other workstreams:

- Single Agent, Static Team, and MOSAIC evaluation result format and comparison UI.
- Deterministic demo fixtures, critical-flow browser tests, and recording material.
- Final demonstration-focused visual refinement.

Work that requires accepted contracts or evidence from Developers A and B:

- Real repair-Task relationships when the backend records them.
- Safe Artifact preview or download.
- Final real-executor comparison data and recorded multi-Agent Session.
