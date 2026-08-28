# MOSAIC：自适应、可验证、自愈的多 Agent 协调中间件

英文：

> **Middleware for Orchestrated, Self-healing, Auditable and Intelligent Collaboration**

它解决的核心问题是：

> 多 Agent 的难点不在于“让多个模型说话”，而在于如何决定是否需要协作、选择谁参与、怎样分工、怎样共享成果、怎样验证、失败后怎样恢复，以及怎样解释整个过程。

这是一个比“Agent 群聊”更完整、更贴合 Track 1、也更容易体现技术创新的故事。

---

## 一、方案核心思想

MOSAIC 将多个现有 Codex Agent 组织成可靠的软件工程团队：

```text
用户任务
   ↓
Collaboration Gate
判断使用单 Agent 还是多 Agent
   ↓
Planner 生成结构化任务 DAG
   ↓
Team Builder 动态选择 Agent
   ↓
Graph Scheduler 并行/顺序调度
   ↓
Agent 在隔离工作区执行
   ↓
Artifact Broker 收集中间产物
   ↓
Verifier 机械验证 + Agent 评审
   ↓
失败归因与针对性恢复
   ↓
Integrator 合并通过验证的成果
   ↓
最终结果 + Coordination Trace
```

它融合的不是多个框架的表面 API，而是多个开源项目和论文里最强的机制。

## 二、融合哪些研究成果

| MOSAIC 能力 | 借鉴来源 | 借鉴内容 |
|---|---|---|
| 中央协调器 | [Magentic-One](https://arxiv.org/abs/2411.04468) | Orchestrator、任务账本、进度检查、失败后重新规划 |
| 动态组队 | [DyLAN](https://arxiv.org/abs/2310.02170) | 根据任务和 Agent 贡献动态选择团队 |
| 自适应编排 | [Evolving Orchestration](https://arxiv.org/abs/2505.19591) | Puppeteer 式动态选择 Agent 和调用顺序 |
| SOP 与结构化产物 | [MetaGPT](https://arxiv.org/abs/2308.00352) | 用标准工作流和 Artifact 减少自由聊天导致的错误传播 |
| 软件团队协作 | [ChatDev](https://arxiv.org/abs/2307.07924) | Planner、Developer、Tester 等角色和对话链 |
| 状态图 | [LangGraph.js](https://github.com/langchain-ai/langgraphjs)、[Google ADK TS](https://github.com/google/adk-js) | Sequential、Parallel、Loop、Handoff、条件边、暂停恢复 |
| 并行候选聚合 | [Mixture-of-Agents](https://arxiv.org/abs/2406.04692) | 多个 Worker 独立输出，再由 Aggregator 汇总 |
| 独立审查 | [MARS](https://openreview.net/forum?id=UWRfA2eWKE) | Reviewer 互不影响，Meta-reviewer 汇总，减少无效讨论 |
| 拓扑优化 | [MacNet](https://arxiv.org/abs/2406.07155) | Chain、Tree、DAG、小世界等通信拓扑 |
| 失败归因 | [Who & When](https://proceedings.mlr.press/v267/zhang25cq.html) | 找出导致失败的 Agent 和具体步骤 |
| 自愈恢复 | [Self-Healing Agentic Orchestrators](https://arxiv.org/abs/2606.01416) | 故障分类、预算化恢复、验证恢复结果、避免盲目重试 |
| 协作评测 | [MultiAgentBench](https://aclanthology.org/2025.acl-long.421/) | 不只看最终答案，还评测协调质量、里程碑和拓扑 |
| Agent 互操作 | [A2A Protocol](https://a2a-protocol.org/latest/) | Agent 发现、任务委派、消息和 Artifact 交换 |
| 工具互操作 | MCP | Agent 到工具/资源的标准化访问 |
| 前端事件 | [AG-UI](https://github.com/ag-ui-protocol/ag-ui) | 多 Agent 事件、状态和工具进度向前端同步 |

---

## 三、最重要的创新：不是所有任务都强行多 Agent

2026 年的一项系统性研究发现，随着单 Agent 能力增强，多 Agent 协作不一定始终带来收益；在部分任务中，协调成本和错误传播可能抵消协作优势。[Nature Machine Intelligence](https://www.nature.com/articles/s42256-026-01268-y)

因此 MOSAIC 的第一步应该是 `Collaboration Gate`。

它判断：

```text
这个任务是否真的值得多 Agent？
应该使用几个 Agent？
使用哪种协作拓扑？
```

可以计算：

```text
collaborationScore =
    taskDecomposability
  + specialistDiversityNeed
  + verificationNeed
  + uncertainty
  + parallelismPotential
  + riskLevel
  - estimatedCoordinationCost
```

输出：

```ts
interface CollaborationDecision {
  mode:
    | "single"
    | "sequential"
    | "parallel"
    | "manager_worker"
    | "review_council"
    | "dynamic_graph";

  reason: string;
  selectedAgentIds: string[];
  estimatedCost: number;
  requiredVerification: string[];
}
```

简单任务走单 Agent，复杂任务才组队。

这不会削弱“多 Agent 为主”的定位，反而能证明：

> 你们做的不是一个盲目增加 Agent 数量的框架，而是能智能控制协作收益和成本的中间件。

---

## 四、完整系统架构

```text
┌─────────────────────────────────────────────────────────────┐
│                         React UI                            │
│ Agent Graph / Timeline / Artifacts / Metrics / Intervention│
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                  MultiAgentCoordinator                     │
│                                                             │
│  CollaborationGate    Planner        DynamicTeamBuilder     │
│  GraphScheduler       BudgetManager  RecoveryManager        │
│  FailureAttributor    Verifier       IntegrationManager     │
└───────────┬───────────────────┬─────────────────────┬───────┘
            │                   │                     │
┌───────────▼──────┐  ┌────────▼─────────┐  ┌────────▼────────┐
│ Coordination DB │  │ Shared Blackboard │  │ Artifact Store  │
│ Session/Task    │  │ Facts/Decisions   │  │ Patch/Commit    │
│ Attempt/Event   │  │ Claims/Locks      │  │ Test Reports    │
└─────────────────┘  └───────────────────┘  └─────────────────┘
            │
┌───────────▼─────────────────────────────────────────────────┐
│                 Existing AgentService                       │
└───────────┬─────────────────────────────────────────────────┘
            │
     ┌──────┼──────────┬──────────┬──────────┐
     ▼      ▼          ▼          ▼          ▼
  Planner Backend   Frontend    Tester    Reviewer
  Agent   Agent      Agent       Agent      Agent
     │      │          │          │          │
     └──────┴──────────┴──────────┴──────────┘
            Existing CodexRunner / ContainerCodexRunner
```

关键点是：

- 原有 `AgentService` 和 Runner 继续负责单个 Agent；
- MOSAIC 位于其上方，负责多个 Agent 的协调；
- 不绕开现有 Codex CLI、Ark、工作区和容器路径；
- 所有协调行为都是真实后端行为。

---

## 五、核心数据模型

### 1. CoordinationSession

```ts
interface CoordinationSession {
  id: string;
  userTask: string;

  status:
    | "planning"
    | "forming_team"
    | "executing"
    | "verifying"
    | "integrating"
    | "recovering"
    | "waiting_approval"
    | "completed"
    | "failed"
    | "cancelled";

  topology: CoordinationTopology;
  participantAgentIds: string[];

  rootTraceId: string;
  budget: CoordinationBudget;
  createdAt: string;
  completedAt?: string;
}
```

### 2. TaskGraph

```ts
interface TaskNode {
  id: string;
  sessionId: string;

  title: string;
  description: string;
  requiredCapabilities: string[];
  dependencies: string[];

  status:
    | "pending"
    | "ready"
    | "leased"
    | "running"
    | "verifying"
    | "succeeded"
    | "failed"
    | "blocked"
    | "superseded";

  assignedAgentId?: string;
  leaseExpiresAt?: string;
  attemptCount: number;

  inputArtifactIds: string[];
  outputArtifactIds: string[];

  acceptanceCriteria: AcceptanceCriterion[];
}
```

### 3. AgentCapabilityProfile

```ts
interface AgentCapabilityProfile {
  agentId: string;

  capabilities: Array<{
    name: string;
    confidence: number;
  }>;

  successRate: number;
  averageLatencyMs: number;
  averageTokens: number;
  recentFailureRate: number;
  currentLoad: number;

  allowedTools: string[];
}
```

### 4. CoordinationEvent

```ts
interface CoordinationEvent {
  id: string;
  sessionId: string;
  taskId?: string;
  agentId?: string;
  runId?: string;

  type:
    | "session.started"
    | "plan.created"
    | "agent.selected"
    | "task.claimed"
    | "agent.started"
    | "artifact.created"
    | "verification.failed"
    | "task.retried"
    | "task.reassigned"
    | "plan.revised"
    | "artifact.accepted"
    | "integration.completed"
    | "session.completed";

  payload: Record<string, unknown>;
  createdAt: string;
}
```

### 5. Artifact

Agent 之间不应该主要通过自由聊天交换信息，而应该交换结构化 Artifact：

```ts
interface CoordinationArtifact {
  id: string;
  sessionId: string;
  taskId: string;
  producerAgentId: string;

  type:
    | "task_plan"
    | "research_report"
    | "architecture_spec"
    | "git_patch"
    | "git_commit"
    | "test_report"
    | "review_decision"
    | "failure_report"
    | "final_result";

  schemaVersion: number;
  content: unknown;
  contentHash: string;

  verificationStatus:
    | "unverified"
    | "accepted"
    | "rejected";
}
```

这是 MetaGPT 的 SOP 思路和分布式系统 Artifact 思路的结合。

---

## 六、混合式协调器：LLM 决策 + 确定性控制

不要让 LLM 控制所有状态变化。

最佳设计是：

| 工作 | 负责人 |
|---|---|
| 理解任务、提出分解方案 | Planner Agent |
| 生成任务 DAG | Planner Agent 输出结构化 JSON |
| 校验 DAG 是否无环 | 确定性后端代码 |
| Agent 能力匹配 | 评分算法 |
| 最终选择 Agent | Scheduler |
| 领取任务和防重复 | 数据库事务/Lease |
| 是否通过测试 | 真实命令退出码 |
| 是否超时 | 后端计时器 |
| 是否允许重试 | Recovery Policy |
| 是否合并代码 | 测试和 Review Contract |
| 是否完成 | 确定性 Acceptance Criteria |
| 语义质量评审 | Reviewer Agents |

原则是：

> LLM 负责开放式判断，后端负责状态、约束、权限、预算和一致性。

这是比纯 CrewAI/群聊更强的技术设计。

---

## 七、动态团队选择

建议的 Agent 评分：

```text
agentScore =
    0.35 × capabilityMatch
  + 0.20 × historicalSuccessRate
  + 0.15 × taskSimilarity
  + 0.10 × availability
  + 0.10 × toolCompatibility
  + 0.10 × diversityContribution
  - costPenalty
  - recentFailurePenalty
```

任务不同，团队不同：

```text
简单文档修改
→ 单 Agent

前后端独立修改
→ Frontend + Backend 并行

复杂 Bug
→ Investigator → Developer → Tester

安全敏感修改
→ Developer + Security Reviewer + Integrator

需求不明确
→ Planner + 两个独立方案 Agent + Meta Reviewer
```

不要固定每次都调用 Planner、Backend、Frontend、Tester、Reviewer。动态组队本身就是方案的重要创新。

---

## 八、自适应拓扑

MOSAIC 不应该只有一种 Round-robin。

| 拓扑 | 适用任务 |
|---|---|
| Single | 简单、确定、不可分解 |
| Sequential | 明确流水线，如设计→开发→测试 |
| Parallel | 独立子任务，如前后端并行 |
| Manager-Worker | 需要持续计划和重新分配 |
| Handoff | 当前 Agent 根据内容转给专家 |
| Review Council | 高风险或语义判断任务 |
| DAG | 有复杂依赖关系的工程任务 |
| Mixture-of-Agents | 需要多个候选答案和聚合 |
| Recovery Graph | 某节点失败后重试、替换或重规划 |

Planner 输出的是任务 DAG；Scheduler 可以根据运行情况修改未执行部分。

已经完成且验证通过的节点不重复执行。

---

## 九、自愈系统

失败不能统一处理成“再问一次模型”。

先分类：

```ts
type FailureClass =
  | "transient_provider_error"
  | "timeout"
  | "malformed_output"
  | "tool_error"
  | "test_failure"
  | "dependency_failure"
  | "agent_capability_mismatch"
  | "conflicting_artifact"
  | "budget_exceeded"
  | "no_progress"
  | "unsafe_action";
```

然后采取针对性恢复：

| 错误 | 恢复行为 |
|---|---|
| API 429/临时失败 | 同 Agent 退避重试 |
| 超时 | 取消 Run，缩小任务或改派 |
| JSON 不符合 Schema | 请求同 Agent 修正格式，不重新做任务 |
| 测试失败 | 把 Test Report 反馈给原 Worker |
| 连续失败 | 改派能力相近 Agent |
| Agent 不适合 | 更新能力评分并重新选人 |
| 两个 Artifact 冲突 | 创建专门 Conflict Resolution Task |
| 无进展 | 触发重新规划 |
| 预算超限 | 降低团队规模、停止或请求批准 |
| 高风险操作 | 暂停并进入 Human Approval |

2026 年自愈编排研究的核心启示也是：恢复应基于故障分类和验证，而不是只有通用重试。[Self-Healing Agentic Orchestrators](https://arxiv.org/abs/2606.01416)

---

## 十、代码协作：隔离分支 + 验证后合并

如果主 Demo 做软件开发，建议不要让多个 Agent 同时写一个目录。

使用：

```text
Canonical Session Repository
       |
       ├── Agent A 独立 clone/branch
       ├── Agent B 独立 clone/branch
       └── Agent C 独立 clone/branch
```

流程：

1. Coordinator 记录当前 `baseCommit`。
2. 每个 Task Attempt 获得独立 clone 或分支。
3. Agent 在自己的 Workspace 修改和提交。
4. Agent 返回 Commit ID、Patch、测试结果。
5. 控制平面在干净 Integration Workspace 中应用 Patch。
6. 重新运行机械测试。
7. Reviewer 审核语义和架构。
8. 通过后才进入 canonical branch。
9. 冲突时生成新的 Conflict Resolution Task。

Agent 永远不能直接修改 canonical branch。

这样同时解决：

- 并发写入；
- Agent 互相覆盖；
- 回滚；
- 失败隔离；
- Artifact 归属；
- 可重现性；
- 审计。

---

## 十一、验证系统

最佳设计是三层验证：

### 第一层：结构验证

- Zod Schema；
- 必填字段；
- DAG 无环；
- Artifact Hash；
- Agent/Task ID 关联；
- Patch Base Commit 正确。

### 第二层：机械验证

- `npm run check`；
- 单元测试；
- TypeScript 编译；
- Lint；
- 文件存在性；
- Git diff；
- 安全扫描；
- 命令退出码。

### 第三层：语义验证

多个 Reviewer 独立评审：

```text
Correctness Reviewer
Security Reviewer
Architecture Reviewer
```

最后由 Meta Reviewer 聚合。

Reviewer 不能互相看到对方的初始意见，避免从众；Meta Reviewer 必须引用：

- 测试结果；
- Patch；
- Acceptance Criteria；
- 具体证据。

机械测试优先于 LLM Judge。

---

## 十二、从协调 Trace 学习策略

每次执行都产生完整的 Orchestration Trace：

```text
任务特征
选择了哪些 Agent
采用什么拓扑
每个 Agent 的输出
Token 和耗时
失败类型
恢复动作
最终是否成功
```

可以定义奖励：

```text
reward =
    100 × taskSuccess
  + 20 × verificationPass
  + 10 × recoverySuccess
  - 0.001 × tokens
  - 0.0001 × latencyMs
  - 5 × unnecessaryAgentCalls
  - 10 × failedAttempts
```

然后实现两级策略：

1. 默认使用可解释规则；
2. 根据历史 Trace 用 Contextual Bandit 或离线策略优化调整：
   - 是否启用多 Agent；
   - 选择几个 Agent；
   - 选择什么拓扑；
   - 是否需要 Review Council；
   - 失败后重试还是改派。

2026 年已有研究开始把 orchestration trace 建模为包含 spawn、delegate、communicate、tool use、aggregate 和 stop 的时序交互图，并用于优化多 Agent 编排策略。[RL through Orchestration Traces](https://arxiv.org/abs/2605.02801)

不建议直接从一开始做复杂 RL。最强且实际的方案是：

> 规则保证正确，历史数据优化效率。

---

## 十三、前端应该展示什么

不要做普通群聊页面。

应该展示：

### Coordination Graph

```text
             ┌─ Backend Agent ─ Tests ─┐
Planner ─────┤                         ├─ Integrator
             └─ Frontend Agent ─ Review┘
```

节点颜色：

- 灰色：pending
- 蓝色：running
- 绿色：verified
- 红色：failed
- 黄色：recovering
- 紫色：reassigned

### Timeline

```text
10:00:01 Session created
10:00:03 Planner created 5 task nodes
10:00:04 Backend Agent selected
10:00:04 Frontend Agent selected
10:00:30 Backend attempt timed out
10:00:31 Task reassigned to Agent C
10:01:06 Patch produced
10:01:12 Tests failed
10:01:14 Repair task created
10:01:40 Tests passed
10:01:45 Integration completed
```

### 证据面板

- Agent 和角色；
- Task/Run/Attempt ID；
- 输入输出 Artifact；
- Git diff；
- 测试结果；
- Token、耗时和调用次数；
- 失败原因；
- 为什么选择这个 Agent；
- 为什么采取这项恢复；
- 当前预算；
- 最终 Acceptance Criteria。

---

## 十四、最佳 Demo 场景

不要把“10 到 1 倒数”作为最终主 Demo。它可以保留为基础协调测试。

主 Demo 建议做：

> 多 Agent 自动完成一个包含后端、前端、测试和安全要求的真实代码任务。

例如：

```text
为 Starter Kit 增加 Run 历史搜索功能：

1. 后端支持按 Agent、状态和时间筛选 Runs；
2. 前端增加筛选和分页；
3. 对查询参数进行校验；
4. 增加单元测试；
5. 不得暴露敏感 Prompt；
6. npm run check 必须通过。
```

运行过程：

1. Collaboration Gate 判断需要多 Agent。
2. Planner 生成 DAG。
3. Backend 与 Frontend Agent 并行。
4. Test Agent 准备验证。
5. 故意让 Backend Agent 第一次超时或产生错误。
6. Recovery Manager 分类失败并改派。
7. Security Reviewer 发现一个敏感字段泄露或缺少校验。
8. 创建 Repair Task。
9. Integrator 在干净分支合并。
10. `npm run check` 真实通过。
11. UI 显示完整 Graph、Timeline、Artifact 和失败恢复。

三分钟里评委能看到：

- 真实多 Agent；
- 动态分工；
- 并行；
- 失败；
- 定向恢复；
- 机械验证；
- 最终合并；
- 全过程可解释。

---

## 十五、如何证明多 Agent 确实有价值

必须准备以下对照：

| 系统 | 说明 |
|---|---|
| Single Agent | 一个 Agent 完成全部任务 |
| Static MAS | 固定角色、固定顺序、无动态恢复 |
| MOSAIC | 动态组队、DAG、验证、自愈、预算 |

指标：

```text
Task success rate
Test pass rate
Acceptance criteria coverage
Recovery success rate
Duplicate work rate
Failed attempt count
Total tokens
Wall-clock latency
Coordination overhead
Failure localization accuracy
Human intervention count
```

再做消融：

```text
MOSAIC without dynamic selection
MOSAIC without verifier
MOSAIC without recovery
MOSAIC without shared blackboard
MOSAIC without budget control
```

这会让你们的项目从“功能 Demo”提升成：

> 有设计、有对照、有实验、有证据的工程研究项目。

---

## 十六、与评分标准的对应

| Track 1 标准 | MOSAIC 的证据 |
|---|---|
| End-to-end behavior 40% | 浏览器提交任务，后端规划，多个真实 Codex Agent 执行，验证、恢复、合并 |
| Technical design 25% | 混合式协调、动态组队、状态 DAG、Artifact Contract、隔离分支、事件溯源 |
| Verification 20% | 故障注入、机械测试、重试/改派、失败归因、消融实验 |
| Demo 15% | 可视化 Graph 和 Timeline，三分钟展示失败恢复和最终通过 |

通用标准方面：

| 通用标准 | MOSAIC 优势 |
|---|---|
| Technical Execution | 分布式系统式状态、事务、Lease、Artifact、验证和恢复 |
| Innovation | 自适应决定是否协作、动态拓扑、自愈、从 Trace 学习 |
| Impact | 可用于真实软件工程、运维、研究、审核等协作任务 |
| Feasibility | 复用现有 AgentService、Codex Runner、容器和 Workspace |
| Presentation | 任务图、Agent 选择、失败和恢复过程非常直观 |

## 最终建议

你们最应该做的不是：

```text
多个 Agent 在群聊中轮流发言
```

而是：

> **一个会判断何时需要协作、动态组织 Agent、以结构化 Artifact 交付工作、机械验证成果、从失败中自动恢复，并完整记录协调因果链的 Agent Coordination Middleware。**

如果只能用一句话介绍项目：

> **MOSAIC turns independent, unreliable AI agents into an adaptive, verifiable, and self-healing engineering team.**

这是我认为结合题目、Starter Kit、现有开源生态、最新论文和评分标准后，技术上最强、故事最完整、最有竞争力的方案。