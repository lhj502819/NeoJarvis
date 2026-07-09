# Jarvis 代码健康度重构设计

## 背景

Jarvis v0.1 骨架已跑通，但快速迭代留下了明显的代码健康问题：God Module、循环依赖、零测试、隐式全局状态。本次重构目标是**在不改变产品行为的前提下**，让代码可维护、可测试、可独立理解。

## 问题清单

| 优先级 | 问题 | 文件 | 影响 |
|--------|------|------|------|
| P0 | brain.ts 承担 5 个职责（570 行） | src/jarvis/brain.ts | 改一处波及全局，无法单独测试 |
| P0 | 零自动化测试 | — | 任何重构都是裸奔 |
| P1 | agent.ts 混合路由 + 基础设施（335 行） | src/jarvis/agent.ts | 找端点靠全文搜索 |
| P1 | brain.ts ↔ agent.ts 循环依赖 | brain import broadcast, agent import think | 架构坏味道，阻碍提取 |
| P1 | 5+ 个隐式全局 Map 散落各文件 | 见下表 | 无法 mock，集成测试不可写 |
| P2 | 大量 `as any` 类型逃逸 | rawLlmCall, DB row mappers | 运行时错误无编译期保护 |
| P2 | 无 DB migration 系统 | src/shared/db.ts | 加字段只能手写 ALTER |
| P3 | prompt.ts 是 200 行纯字符串 | src/jarvis/prompt.ts | 无法部分测试或复用 |

全局状态分布：

| 文件 | 全局 | 用途 |
|------|------|------|
| brain.ts | brainLocks, taskAbortControllers | 并发锁 + 取消 |
| agent.ts | sseClients[] | SSE 广播 |
| orchestrator.ts | sessions Map | 用户会话状态机 |
| client.ts | activeQueries Map | agent 查询句柄 |
| tools.ts | pendingArtifacts Map | 制品暂存 |
| bus.ts | MessageBus singleton | agent 通信 |

## 设计

### 1. brain.ts 拆分

拆为 4 个文件，每个单一职责：

```
src/jarvis/
  llm.ts              — rawLlmCall, llmCall, brainLocks (~80 行)
  action-dispatcher.ts — parseAction + executeAction + action handlers (~250 行)
  conversation.ts     — addToBuffer, saveConversation, getRecentConversation (~80 行)
  brain.ts            — think() 编排：组装 prompt → llm → dispatcher (~100 行)
```

**依赖方向（单向）：**
```
brain.ts → llm.ts
brain.ts → conversation.ts
brain.ts → action-dispatcher.ts
action-dispatcher.ts → task/manager, a2a/client, team/registry
```

### 2. 循环依赖消除

**当前循环**：agent.ts exports `broadcast` → brain.ts imports `broadcast`；agent.ts imports `think` from brain.ts。

**解决**：提取 `src/jarvis/sse.ts`：
```typescript
// src/jarvis/sse.ts
export interface SSEClient { id: string; userId: string; res: Response }
const sseClients: SSEClient[] = []
export function addSSEClient(id: string, userId: string, res: Response): void
export function removeSSEClient(id: string): void
export function broadcast(type: string, content: string, userId?: string): void
```

agent.ts 和 brain.ts（通过 llm.ts）都 import sse.ts，不再互相 import。

### 3. agent.ts 路由拆分

```
src/jarvis/
  server.ts           — Express app 创建、中间件链、app.listen、组装 routers
  routes/
    chat.ts           — POST /chat（SSE 流式）
    tasks.ts          — GET /tasks, GET /api/chat/status
    conversation.ts   — GET /api/conversation
    credentials.ts    — GET/POST/PUT/DELETE /api/credentials
    agents.ts         — GET /api/agents, GET /api/team, POST /api/agents/:id/*
    events.ts         — GET /events（长连接 SSE）
    mcp.ts            — GET/POST/DELETE /api/mcp-servers
```

每个文件 export 一个 `express.Router`，server.ts `app.use()` 组装。

### 4. 测试基建

**工具链**：vitest（与 TypeScript + ESM 原生兼容，零配置）

**目录结构**：
```
tests/
  unit/
    parseAction.test.ts
    orchestrator.test.ts
    promotion.test.ts
  integration/
    chat-flow.test.ts
```

**Phase 1 测试（高杠杆，拆分过程中写）**：

1. `parseAction.test.ts` — 验证 JSON 解析各种格式：fenced code block、裸 JSON、多余文本包裹、畸形 JSON
2. `orchestrator.test.ts` — 状态机路径覆盖：idle→buffer→think、连发合并、interrupt、disconnect 取消
3. `promotion.test.ts` — clusterByDomain 聚类逻辑、满 3 次触发、不重复创建

**测试隔离**：orchestrator 和 promotion 的 DB 依赖通过参数注入替换为 in-memory stub。

### 5. 全局状态收拢（渐进式）

定义 `AppContext` 接口，逐步替换模块级全局变量：

```typescript
// src/shared/context.ts
export interface AppContext {
  sseClients: SSEClient[]
  sessions: Map<string, UserSession>
  activeQueries: Map<string, Query>
  pendingArtifacts: Map<string, PendingArtifact>
  bus: MessageBus
}

export function createAppContext(): AppContext
```

**迁移策略**：不一步到位。每拆一个模块时，把它依赖的全局状态改为参数传入。旧模块暂时保留全局导出（向后兼容），逐步迁移完后删除。

## 执行顺序

```
Phase 1: 测试基建 + parseAction 测试
         （先有测试保护，再动手拆）
Phase 2: 提取 sse.ts，消除循环依赖
Phase 3: brain.ts 拆分为 4 文件
         （每拆一步跑测试确认不回归）
Phase 4: agent.ts → server.ts + routes/
Phase 5: 全局状态渐进收拢
```

每个 Phase 独立可交付、可 commit。Phase 之间不存在"做到一半不能用"的中间态。

## 不动的东西

- 产品行为、用户可见 API 不变
- 数据库 schema 不变
- 前端目录结构不变（web/ 已独立）
- A2A 协议端点不变
- prompt.ts 和 DB migration 留到后续迭代

## 验证标准

- `npx tsc --noEmit` 通过
- `npx vitest run` Phase 1 测试全绿
- 手动 /chat 发消息，行为与重构前一致
- `git log --oneline` 每个 Phase 一个 commit，message 清晰
