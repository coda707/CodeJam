import path from "node:path";
import { execFile } from "node:child_process";
import { AgentService } from "./agent-service.js";
import { createApp } from "./app.js";
import { loadConfig, writeCodexConfig } from "./config.js";
import { createRunner } from "./runner-factory.js";
import { JsonStore } from "./store.js";
import { WorkspaceManager } from "./workspace.js";
import { CoordinationService } from "./multi-agent/coordination-service.js";
import { CoordinationStore } from "./multi-agent/coordination-store.js";
import { JsonCoordinationEventSink } from "./multi-agent/event-store.js";
import { FakeCoordinationExecutor } from "./multi-agent/fake-executor.js";
import { AgentServiceCoordinationExecutor } from "./multi-agent/agent-executor-adapter.js";
import { FileCoordinationArtifactStore } from "./multi-agent/artifact-store.js";
import { MechanicalCoordinationVerifier } from "./multi-agent/verifier.js";
import { HeuristicCoordinationPlanner } from "./multi-agent/planner.js";
import { CapabilityTeamBuilder } from "./multi-agent/team-builder.js";
import {
  ClassificationRecoveryPolicy,
  StopCoordinationRecoveryPolicy,
} from "./multi-agent/recovery-policy.js";
import { FaultInjectingExecutor } from "./multi-agent/demo-faults.js";
import type { AgentService as AgentServiceType } from "./agent-service.js";
import type {
  CommandExecutionResult,
  CoordinationCommandRunner,
  CoordinationExecutor,
} from "./multi-agent/ports.js";

const config = loadConfig();
await writeCodexConfig(config);

const store = new JsonStore(path.join(config.dataDirectory, "launchpad.json"));
const workspaces = new WorkspaceManager(config.workspaceRoot);
const runner = createRunner(config);
const service = new AgentService(config, store, workspaces, runner);
await service.initialize();

const coordinationStore = new CoordinationStore(store);
let coordinationExecutor: CoordinationExecutor =
  config.coordinationExecutor === "agent"
    ? new AgentServiceCoordinationExecutor(service)
    : new FakeCoordinationExecutor();
if (config.coordinationDemoFault !== "off") {
  const demoFault = {
    transient: {
      taskTitleMatch: "Implement",
      failureClass: "transient_provider_error" as const,
      error: "Simulated transient provider error for the recovery demo",
    },
    timeout: {
      taskTitleMatch: "Deliver",
      failureClass: "timeout" as const,
      error: "Simulated Agent timeout for the recovery demo",
    },
    test_failure: {
      taskTitleMatch: "Verify",
      failureClass: "test_failure" as const,
      error: "Simulated acceptance-test failure for the approval demo",
    },
    capability: {
      taskTitleMatch: "Implement",
      failureClass: "agent_capability_mismatch" as const,
      error: "Simulated capability mismatch for the reassignment demo",
    },
    no_progress: {
      taskTitleMatch: "Research",
      failureClass: "no_progress" as const,
      error: "Simulated no-progress failure for the replan demo",
    },
  }[config.coordinationDemoFault];
  coordinationExecutor = new FaultInjectingExecutor(coordinationExecutor, demoFault);
}

const workspaceCommandRunner: CoordinationCommandRunner = {
  run(command: string, agentId: string, timeoutMs = 30_000): Promise<CommandExecutionResult> {
    const workspacePath = (service as AgentServiceType).getAgent(agentId).workspacePath;
    const [bin, ...args] = command.trim().split(/\s+/);
    return new Promise((resolve) => {
      execFile(bin!, args, {
        cwd: workspacePath,
        timeout: timeoutMs,
        maxBuffer: 1_024 * 1_024,
        windowsHide: true,
      }, (error, stdout, stderr) => {
        const code = (error as NodeJS.ErrnoException).code;
        const exitCode = error == null ? 0 : typeof code === "number" ? code : -1;
        resolve({
          exitCode,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      });
    });
  },
};

const coordinationService = new CoordinationService(
  coordinationStore,
  coordinationExecutor,
  new JsonCoordinationEventSink(coordinationStore),
  {
    artifacts: new FileCoordinationArtifactStore(
      config.coordinationArtifactRoot,
      coordinationStore,
      (agentId) => service.getAgent(agentId).workspacePath,
    ),
    verifier: new MechanicalCoordinationVerifier(
      config.coordinationExecutor === "agent"
        ? { commandRunner: workspaceCommandRunner }
        : {},
    ),
    planner: new HeuristicCoordinationPlanner(),
    teamBuilder: new CapabilityTeamBuilder(),
    recoveryPolicy:
      config.coordinationRecovery === "off"
        ? new StopCoordinationRecoveryPolicy()
        : new ClassificationRecoveryPolicy({
            testFailureAction: config.coordinationTestFailureAction,
          }),
    catalog: {
      resolve: (ids) =>
        ids.map((id) => {
          const agent = service.getAgent(id);
          return {
            id: agent.id,
            name: agent.name,
            description: agent.description,
            instructions: agent.instructions,
            status: agent.status,
          };
        }),
    },
  },
);
await coordinationService.initialize();

const app = await createApp(config, service, coordinationService);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.host, port: config.port });
