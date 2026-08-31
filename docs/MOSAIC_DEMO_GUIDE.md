# MOSAIC Demo Guide

A storyboard and recording checklist for the Track 1 demo. It maps each
MOSAIC capability to a concrete, re-runnable action and to the evidence the
recording must capture.

Every "real Agent" step requires a running server in Agent mode
(`COORDINATION_EXECUTOR=agent`) with `ARK_API_KEY` and `ARK_MODEL` set. Every
self-healing step runs against the **Fake** executor, so it needs no API key and
is deterministic.

---

## Storyboard

The narrative order proves isolation first, then the constraint workflow, then
the self-healing claims, then the measured comparison.

### Beat 0 — Baseline (playground)

**Claim:** the Starter Kit runs one Agent per Playground turn.

1. Create one Agent ("Generalist").
2. Send a Playground message: *"Create a TypeScript hello-world CLI, add a test, and run it."*
3. Show the reply and the Agent's `codexThreadId`.

**Camera:** the Playground transcript and the Agent run list.

---

### Beat 1 — Isolation (Developer B)

**Claim:** a MOSAIC coordination Run never contaminates the same Agent's
Playground thread or transcript.

1. Keep the Agent from Beat 0 (or create a fresh one).
2. Run `node scripts/isolation-acceptance.mjs`.

**Camera:** the script's assertions — transcript still empty after coordination,
`codexThreadId` still `null`, then the Playground greeting produces exactly the
greeting + reply and a fresh thread, with no Worker prompt leakage.

---

### Beat 2 — Constraint workflow (Developer A)

**Claim:** a structured `workflow` with `turnTaking` runs "two Agents alternating
1→10", then a `verify` Task checks the sequence mechanically.

1. Run `node scripts/demo-counting-workflow.mjs`.

For an interactive demonstration, open MOSAIC, select two participant Agents,
choose **Add** under Workflow, create the ordered count Tasks, and enable
**Round-robin routing**. The participant list order is the routing order. Each
Task must name a result file and an allowlisted verification command; a fixed
Agent selection on a Task overrides round-robin routing.

**Camera:** the attempts table (count Tasks alternate Agent A/B), the captured
`count.txt` artifact with its SHA-256, and the `verify` Task passing
`node --test count.test.mjs`.

---

### Beat 3 — Self-healing: repair

**Claim:** an acceptance failure spawns a repair Task, supersedes the failing
Task, and rewires downstream dependencies.

1. Restart with `COORDINATION_DEMO_FAULT=test_failure`.
2. Run `node scripts/demo-repair-replan.mjs repair`.

**Camera:** the timeline showing `recovery.decided(repair)` →
`task.repair_created`, the failing "Verify …" Task marked `superseded`, and the
"Verify … (repair)" Task `succeeded`.

---

### Beat 4 — Self-healing: replan

**Claim:** a no-progress failure re-plans the unfinished subgraph without
re-running succeeded work.

1. Restart with `COORDINATION_DEMO_FAULT=no_progress`.
2. Run `node scripts/demo-repair-replan.mjs replan`.

**Camera:** the timeline showing `recovery.decided(replan)` → `plan.revised`,
the superseded stale Tasks, and the session reaching `completed`.

---

### Beat 5 — Human approval (optional)

**Claim:** when opted in, an acceptance failure pauses for a human decision
instead of self-healing.

1. Restart with `COORDINATION_DEMO_FAULT=test_failure` and
   `COORDINATION_TEST_FAILURE_ACTION=request_approval`.
2. Run `node scripts/demo-approval.mjs` and Approve from the UI.

**Camera:** the session pausing at `waiting_approval`, then completing after
approval.

---

### Beat 6 — Comparative evaluation

**Claim:** MOSAIC is measured against Single Agent and Static Team, with a
controlled ablation.

1. Generate the dataset (`node scripts/evaluate.mjs --out evaluation/result.json`,
   or `--fixture` for a no-server sample).
2. Open the evaluation view and import the JSON.

**Camera:** the three strategy cards (success rate, acceptance coverage, recovery
success, coordination overhead) and the Ablations section.

---

## Recording checklist

Use this as a pre-flight and per-take list. Cross off each item as captured.

### Pre-flight

- [ ] `.env` has real `ARK_API_KEY` + `ARK_MODEL` (no placeholders) and
      `COORDINATION_EXECUTOR=agent`.
- [ ] No secret appears in any terminal, log, UI, or the recording. Ark keys and
      bearer tokens are redacted before display.
- [ ] Server + web running (`npm run dev`); web at `:5173`, API at `:3000`.
- [ ] Terminal font large enough to read on the recording; no other windows with
      credentials visible.

### Isolation (Beat 1)

- [ ] Transcript empty after coordination.
- [ ] `codexThreadId` `null` after coordination, non-null after the greeting.
- [ ] Greeting transcript shows only user + assistant (no Worker prompt).

### Constraint workflow (Beat 2)

- [ ] Attempts alternate across exactly two Agents in sequence order.
- [ ] `verify` Task passes `node --test count.test.mjs`.
- [ ] `count.txt` artifact captured with a SHA-256.
- [ ] Workflow summary shows the expected Task count and Round robin before the
      Session is created.

### Self-healing (Beats 3–4)

- [ ] `recovery.decided(repair)` + `task.repair_created` events visible.
- [ ] Failing Task `superseded`, repair Task `succeeded`, session `completed`.
- [ ] `recovery.decided(replan)` + `plan.revised` events visible.
- [ ] No succeeded work re-run on replan.

### Evaluation (Beat 6)

- [ ] Dataset imports without a validation error.
- [ ] Three strategy cards populated; ablation run listed separately.
- [ ] Fixture data labeled "Fixture data" (never presented as real evidence).

---

## Script quick reference

| Script | Requires | Demonstrates |
| --- | --- | --- |
| `scripts/integration-real-agents.mjs` | Agent mode + Ark | Full coordination path with real Agents |
| `scripts/demo-counting-workflow.mjs` | Agent mode + Ark | Structured workflow + `turnTaking` + command verification |
| `scripts/isolation-acceptance.mjs` | Agent mode + Ark | Playground/coordination isolation |
| `scripts/demo-recovery.mjs` | `DEMO_FAULT=transient` | Retry / reassign recovery |
| `scripts/demo-repair-replan.mjs` | `DEMO_FAULT=test_failure` or `no_progress` | Repair + replan self-healing |
| `scripts/demo-approval.mjs` | `DEMO_FAULT=test_failure` + `TEST_FAILURE_ACTION=request_approval` | Human approval |
| `scripts/evaluate.mjs` | Agent mode + Ark (or `--fixture`) | Strategy comparison + ablation dataset |
| `scripts/verify-count.js` | (standalone) | Manual sequence check outside the verifier |
