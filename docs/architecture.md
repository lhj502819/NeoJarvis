# Jarvis v0.1 — 产品 & 技术架构设计

---

## 1. 产品定位

Jarvis 是你的**私人 AI 管家**。你给他任何事，他负责搞定；搞不定的来问你，你做最终决策。

核心价值：**你只需要说"我要什么"，不需要关心怎么做。**

---

## 2. 三层管理架构

```
┌─────────────────────────────────────────────────┐
│  你（决策者）                                     │
│  下达指令 · 做决策 · 确认方向                      │
└────────────────────────┬────────────────────────┘
                         │ A2A Protocol
                         ↕
┌─────────────────────────────────────────────────┐
│  Jarvis（管理者）                                 │
│  理解意图 · 规划方案 · 调度团队 · 协调 · 汇报     │
│                                                   │
│  A2A Server（面向你）+ A2A Client（面向团队）      │
│  + LLM 大脑（推理决策）+ 任务管理 + 团队管理       │
└────────────────────────┬────────────────────────┘
                         │ A2A Protocol
            ┌────────────┼────────────┐
            ↕            ↕            ↕
┌────────────────────────────────────────────────┐
│  团队成员（执行者）— 动态的、可成长的              │
│  每个成员 = A2A Server + LLM + 工具 + 领域知识   │
│  由 Jarvis 按需创建 / 积累 / 销毁                │
└────────────────────────────────────────────────┘
```

---

## 3. 核心概念

### 3.1 Agent Recipe（能力配方）

一个 Agent 的"模板"——定义了一个角色是谁、能做什么、知道什么。

```typescript
interface AgentRecipe {
  id: string
  name: string                      // 角色名
  description: string               // 擅长什么、负责什么
  systemPrompt: string              // 行为人格和规则
  tools: string[]                   // 拥有的工具能力
  model: string                     // 使用的 LLM 模型
  context: Record<string, unknown>  // 领域知识（开放容器，放什么由 Jarvis 决定）
  persistent: boolean               // 是否常驻（false=临时，任务完成销毁）
  usageCount: number                // 被使用次数
  createdBy: 'builtin' | 'jarvis'   // 来源
  createdAt: string
  lastUsedAt: string
}
```

### 3.2 团队成长模型

```
新任务进来
  → Jarvis 分析: 需要什么能力？
  → 查配方库: 有合适的角色吗？
     ├─ 有 → 实例化该角色执行
     └─ 没有 → Jarvis 设计新配方 → 创建临时角色执行
              → 执行完 → Jarvis 判断：以后还会用吗？
                 ├─ 会 → 保留为常驻成员（persistent: true）
                 └─ 不会 → 销毁
```

团队从几个内置角色起步，随使用积累成长。越用越懂你需要什么。

### 3.3 任务（Task）

一个你交给 Jarvis 的事情。

```typescript
interface Task {
  id: string
  name: string                    // Jarvis 归纳的任务名
  description: string             // 你的原始需求
  status: TaskStatus
  plan?: string                   // Jarvis 的执行方案
  subtasks: SubTask[]
  result?: string                 // 最终结果
  error?: string
  createdAt: string
  updatedAt: string
}

type TaskStatus =
  | 'created'       // 刚创建
  | 'planning'      // Jarvis 在规划
  | 'confirming'    // 等你确认方案
  | 'executing'     // 执行中
  | 'blocked'       // 卡住了，需要你决策
  | 'completed'     // 完成
  | 'failed'        // 失败
  | 'cancelled'     // 取消
```

### 3.4 子任务（SubTask）

Jarvis 把任务拆解后派给某个团队成员的具体工作。

```typescript
interface SubTask {
  id: string
  taskId: string                  // 所属主任务
  name: string
  description: string             // 具体要做什么
  assignee: string                // 派给哪个角色（recipe id）
  status: SubTaskStatus
  progress?: string               // 最新进度
  result?: string
  error?: string
  blockedReason?: string          // 为什么卡住
  dependsOn?: string[]            // 依赖哪些子任务先完成
  createdAt: string
  updatedAt: string
}

type SubTaskStatus =
  | 'pending'           // 等待执行（可能有依赖未完成）
  | 'running'           // 执行中
  | 'input-required'    // 需要 Jarvis/用户 提供输入
  | 'completed'         // 完成
  | 'failed'            // 失败
  | 'cancelled'         // 取消
```

---

## 4. 核心流程

### 4.1 完整任务生命周期

```
你                      Jarvis                          团队成员
│                         │                               │
│── "我要 XXX" ──────────→│                               │
│                         │                               │
│                         │── [LLM 推理: 理解意图]         │
│                         │── [创建 Task: status=planning] │
│                         │── [分析需要什么角色]            │
│                         │── [匹配/创建 Agent Recipe]     │
│                         │── [拆解子任务 + 排依赖]        │
│                         │                               │
│←── "Sir, 我的方案是..." │                               │
│    "确认执行吗?"         │                               │
│                         │── [Task: status=confirming]    │
│                         │                               │
│── "好的" ──────────────→│                               │
│                         │── [Task: status=executing]     │
│                         │── [实例化角色]                  │
│                         │── [派发子任务] ────────────────→│
│                         │   (A2A sendSubscribe)          │── [执行中]
│                         │                               │
│                         │←── [进度更新] ─────────────────│
│                         │    (SSE streaming)             │
│                         │                               │
│                         │←── [遇到问题] ─────────────────│
│                         │    (input-required)            │
│                         │                               │
│                         │── [LLM 判断: 我能解决吗?]      │
│                         │                               │
│                  ┌──────┴──────┐                        │
│                  │ 能解决       │ 不能解决               │
│                  ↓             ↓                        │
│           [给团队成员指示]  [来问你]                      │
│                  │             │                        │
│                  │    ←────────│                        │
│── [你的决策] ───→│────→[转达] ──────────────────────────→│
│                         │                               │
│                         │←── [任务完成] ─────────────────│
│                         │    (completed + artifacts)     │
│                         │                               │
│                         │── [LLM: 整理结果/汇总]         │
│                         │── [Task: status=completed]     │
│                         │                               │
│←── "Sir, 搞定了..." ───│                               │
│                         │                               │
│                         │── [评估: 这个角色要保留吗?]     │
│                         │   (persistent true/false)      │
```

### 4.2 查询进展

```
你                      Jarvis
│                         │
│── "进展怎么样?" ───────→│
│                         │── [查任务管理器]
│                         │── [A2A tasks/get 查子任务状态]
│                         │── [LLM 整理成人话]
│←── "Sir, 目前..." ─────│
```

### 4.3 中途调整

```
你                      Jarvis                          团队成员
│                         │                               │
│── "方向变了，改成 Y" ──→│                               │
│                         │── [LLM: 理解变更]              │
│                         │── [判断: 取消/调整哪些子任务]    │
│                         │── [A2A tasks/cancel] ─────────→│ (取消)
│                         │── [重新规划]                    │
│                         │── [派发新任务] ────────────────→│ (新的)
│←── "已调整..." ────────│                               │
```

---

## 5. Jarvis 的决策逻辑

Jarvis 收到消息后，由 LLM 大脑判断意图并决策：

| 意图 | Jarvis 行为 |
|------|-------------|
| 新任务 | 创建 Task → 规划 → 确认(视复杂度) → 执行 |
| 简单问题 | 直接回答，不创建任务 |
| 查进展 | 汇报当前任务状态 |
| 补充信息 | 转达给对应子任务的执行者 |
| 调整/取消 | 修改任务计划，通知相关执行者 |
| 确认方案 | 开始执行 |

### 什么时候要问你确认？

| 情况 | 行为 |
|------|------|
| 简单明确的事 | 自动执行 |
| 复杂/模糊的事 | 先出方案问你 |
| 有风险或不可逆的事 | 必须确认 |
| 第一次做某类事 | 问你确认（积累信任后可自动） |

---

## 6. 通信协议

### 6.1 A2A Protocol 在本系统中的应用

| 通信方向 | 角色 | 方法 |
|---------|------|------|
| 你 → Jarvis | Client → Server | `sendMessage` / `sendSubscribe` |
| Jarvis → 你 | Server → Client | SSE 流式 / 状态变更推送 |
| Jarvis → 团队成员 | Client → Server | `sendMessage` / `sendSubscribe` |
| 团队成员 → Jarvis | Server → Client | SSE 进度 / `input-required` 状态 |
| Jarvis 查询成员状态 | Client → Server | `tasks/get` |
| Jarvis 取消成员任务 | Client → Server | `tasks/cancel` |

### 6.2 Agent Card（能力声明）

每个 Agent（包括 Jarvis）都有 Agent Card，声明自己的能力：

```typescript
interface AgentCard {
  name: string
  description: string
  skills: Skill[]                // 能做什么
  capabilities: {
    streaming: boolean           // 支持流式
    pushNotifications: boolean   // 支持推送
  }
  defaultInputModes: string[]
  defaultOutputModes: string[]
}
```

---

## 7. 任务状态机

### 7.1 主任务状态流转

```
created ──→ planning ──→ confirming ──→ executing ──→ completed
                              │              │
                              │              ├──→ blocked ──→ executing (收到输入)
                              │              │
                              │              └──→ failed ──→ planning (重试)
                              │
                              └──→ executing (简单任务跳过确认)

任何状态 ──→ cancelled (用户取消)
```

### 7.2 子任务状态流转

```
pending ──→ running ──→ completed
                    ├──→ input-required ──→ running (收到回复)
                    ├──→ failed
                    └──→ cancelled
```

### 7.3 子任务依赖

子任务之间可以有依赖关系：

```
子任务A (pending) ─ depends_on ─→ 子任务B (running)
     │
     └─ B 完成后，A 自动变 running
```

---

## 8. 模块设计

```
src/
├── index.ts                    # 入口
│
├── jarvis/                     # Jarvis 核心
│   ├── agent.ts                # 主类: A2A Server + Client + 调度
│   ├── brain.ts                # LLM 推理（理解意图、规划、决策）
│   └── prompt.ts               # System Prompt
│
├── task/                       # 任务管理
│   ├── manager.ts              # 任务 CRUD + 状态流转
│   ├── scheduler.ts            # 子任务依赖编排 + 调度
│   └── store.ts                # 持久化
│
├── team/                       # 团队管理
│   ├── registry.ts             # Agent Recipe 库（增删改查）
│   ├── factory.ts              # Agent 实例化工厂（从 Recipe 创建运行实例）
│   └── evaluator.ts            # 使用后评估（决定是否保留）
│
├── a2a/                        # A2A 通信
│   ├── server.ts               # Jarvis 的 Server（接收用户/外部消息）
│   ├── client.ts               # Jarvis 的 Client（与团队成员通信）
│   └── agent-server.ts         # 通用的团队成员 Server 模板
│
├── interface/                  # 交互层
│   └── cli.ts                  # CLI 交互（v0.1）
│
└── shared/
    ├── types.ts                # 所有类型定义
    ├── config.ts               # 配置
    └── logger.ts               # 日志
```

---

## 9. 技术栈

| 组件 | 技术 | 用途 |
|------|------|------|
| 语言 | TypeScript | 全栈 |
| 运行时 | Node.js 22 | 服务端 |
| A2A 通信 | @a2a-js/sdk | Agent 间标准协议 |
| LLM 推理 | @anthropic-ai/claude-agent-sdk | Agent 内部的大脑和工具能力 |
| HTTP | Express | A2A Server 承载 |
| 持久化 | JSON 文件 (v0.1) | 任务/配方/会话存储 |
| CLI | readline | 用户交互 |
| 运行 | tsx | 零配置运行 TS |

---

## 10. 进程模型（v0.1）

v0.1 所有组件在**同一进程**，通过本地 HTTP 端口通信：

```
进程内:
├── Jarvis A2A Server     (localhost:3000)  ← 你连这里
├── Jarvis A2A Client     (内部模块，向下派活)
├── Jarvis Brain          (Claude Agent SDK 推理)
├── 任务管理器            (内存 + JSON 持久化)
├── 团队成员实例 1        (localhost:3001)   ← Jarvis 连这里
├── 团队成员实例 2        (localhost:3002)
└── ...
```

未来可拆分为独立进程/容器，架构不变。

---

## 11. v0.1 范围

### 做

- Jarvis 作为 A2A Server 接收你的消息
- Jarvis LLM 大脑理解意图、规划方案、做决策
- 任务状态机 + 子任务依赖编排 + 持久化
- Agent Recipe 管理（内置几个 + Jarvis 可动态创建）
- A2A 协议派发任务给团队成员
- SSE 流式接收团队成员进度
- 团队成员 input-required → Jarvis 判断 → 必要时问你
- CLI 交互

### 不做

- 多端接入
- EverOS 记忆系统
- 并行执行多个子任务（先串行，v0.2 加并行）
- Agent Recipe 自动评估和保留（v0.1 手动或简单规则）
- 复杂容错/重试

---

## 12. 验证场景

### 场景 1: 常规任务

```
你: 帮我查一下最近有什么好看的科幻电影
Jarvis: [理解: 简单查询任务]
        [匹配/创建: 信息检索角色]
        [自动执行，不需确认]
        ...
Jarvis: Sir, 最近口碑较好的科幻电影有：[结果]
```

### 场景 2: 复杂任务 + 确认

```
你: 帮我做一份 Q3 的技术规划，涉及用户系统和交易系统两个方向
Jarvis: 明白，Sir。这个任务比较复杂，我的方案是：
        1. 先梳理两个系统当前的技术债和瓶颈
        2. 结合业务方向制定优化计划
        3. 输出一份结构化的规划文档
        我需要创建两个角色分别负责两个系统的梳理。确认这个方向？
你: 好的
Jarvis: [创建两个临时角色] [串行执行] ...
```

### 场景 3: 执行中遇到问题

```
Jarvis: Sir, 在梳理交易系统时遇到一个问题——
        团队成员反馈：无法访问 /trade-service 的代码仓库，需要权限。
        请问我应该用什么路径访问，或者您有其他指示？
你: 路径是 ~/work/trade-service
Jarvis: 收到，已转达，继续执行。
```

### 场景 4: 查进展

```
你: 刚才的规划做得怎么样了？
Jarvis: 当前进展：
        - 用户系统梳理 [已完成]
        - 交易系统梳理 [进行中，约 70%]
        预计 5 分钟后全部完成，届时我来给您汇总。
```
