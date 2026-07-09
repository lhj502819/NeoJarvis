# 看板（Dashboard）重设计 — 指挥中心 + 执行详情钻取

日期：2026-07-09
状态：设计已确认，待写实现计划

## Context

当前看板（`web/src/pages/DashboardPage.tsx`，419 行单文件 + `DashboardPage.css` 415 行）存在四类问题，用户明确要求全面重做：

1. **好看/质感**：大量内联样式散落各处，信息密度失衡，缺科技感
2. **信息架构**：team/running/history 挤在一个窄侧栏 tab，该突出的没突出
3. **缺核心能力**：没有全局概览统计；无法钻取查看**每个任务、每个小弟的执行详情**（耗时等元信息）
4. **定位不清**：概览、实时监控、历史档案三种场景都需要，但当前结构没有清晰承载

目标：把看板重做成一个**指挥中心**——左侧导航切换的多页应用，支持「概览 → 列表 → 详情」的钻取模型，并补齐后端元信息埋点，让详情页能展示完整执行数据。

## 布局与信息架构

**骨架**：左侧窄导航栏 + 右侧全宽内容页（放弃当前双栏侧栏结构）。导航切页用**页面内 state**，不用 hash 路由（看板是单一入口，内部切页不必污染 URL）。

**3 个页面**：

| 页面 | 内容 | 钻取 |
|------|------|------|
| **概览** | 全局统计条（在跑/今日完成/团队规模/今日消息数）+ 在跑小弟一览 + Jarvis 状态卡 + 实时动态流 | — |
| **任务** | 进行中 + 历史合并的任务列表（可排序/搜索） | 点任意任务 → 任务详情 |
| **团队** | 沉淀的专家小弟 + 内置小弟 | 点任意小弟 → 小弟档案 |

「历史」并入任务页（历史任务就是已完成的任务，不再单开）；「状态 & 动态」并入概览页。导航精简为 3 项。

## 前端文件拆分

当前单文件是主要债务。拆分为：

```
web/src/pages/dashboard/
├── DashboardPage.tsx        // 外壳：左导航 + 按 state 路由到 3 个页面
├── OverviewPage.tsx         // 概览页
├── TasksPage.tsx            // 任务列表 + 任务详情（列表↔详情用 state 切换）
├── TeamPage.tsx             // 团队列表 + 小弟档案
├── components/
│   ├── StatCard.tsx         // 顶部统计卡片
│   ├── TaskDetail.tsx       // 任务详情（核心新组件）
│   ├── AgentProfile.tsx     // 小弟档案
│   ├── ActivityFeed.tsx     // 实时动态（从现有迁移）
│   └── JarvisState.tsx      // 状态卡（从现有迁移）
└── dashboard.css            // 收敛当前散落的内联样式
```

每个文件职责单一：页面组件只管布局与数据拉取，展示卡片抽成 components。

## 后端数据层（五项元信息全补 + 详情 API）

### 新建表 `jarvis_subtask_turns`（完整执行轨迹的载体）

```
id | subtask_id | turn_index | text | started_at | ended_at | created_at
```

`client.ts` 的 `dispatchToAgent` 执行循环里，每个 `assistant` message 落一条。这张表同时支撑「每回合耗时」和「完整轨迹」两个需求。

**膨胀控制**：按 subtask 数量上限做 trim（复用现有 `MAX_CONVERSATIONS` 那种策略），避免无限增长。

### 给 `jarvis_subtasks` 加 5 个字段

```
started_at    -- 小弟真正开工时刻（registerRunningTask 时写）→ 算「纯执行耗时」，排队等待不计入
turn_count    -- 总回合数
retry_count   -- 重试次数
tokens_input  -- 输入 token
tokens_output -- 输出 token
```

### 采集点（都在 `src/a2a/client.ts` `dispatchToAgent` 已有循环里）

- **开工**：`registerRunningTask` 时写 `started_at`
- **每回合**：`assistant` message → 插 `jarvis_subtask_turns` 一行（记 text + 起止时刻）
- **重试**：现有 retry 分支里 `retry_count++`
- **完成**：`result` message → 读 SDK `usage` 写 token、写 `turn_count`

### 新增详情 API

```
GET /api/task/:taskId
→ 任务全量：任务本身 + 子任务列表（含各自的 turns 轨迹、元信息）
          + 中途沟通对话 + 产物
```

**中途沟通零后端改动**：复用现有 `bus.getConversation(taskId)`。经真实数据核实，`jarvis_agent_messages` 表已存双向对话（小弟发的 + Jarvis 回的），`thread_id` 即 taskId，`sender`/`receiver` 区分方向，`parts` 里 `[progress]`/`[deliverable]`/`[question]` 前缀标类型。沟通记录挂在**任务级**展示（要精确到子任务可靠 sender 里的 subtaskId 对应）。

## 任务详情页内容

- **顶部元信息卡片行**：总耗时、纯执行耗时、子任务数、执行回合、token 消耗、领域
- **子任务执行树**：每个子任务的小弟名、cwd、状态、耗时；可展开看**完整回合轨迹**（jarvis_subtask_turns）
- **中途沟通**：小弟↔Jarvis 的请示/汇报/交付对话（双向）
- **产物 & 结果**：artifact + Jarvis 汇报全文

## 小弟档案页内容

- 擅长领域、是否沉淀专家、使用次数、最后使用时间
- 执行过的任务列表（从 `jarvis_claude_sessions` 按 recipeId 查）

## 视觉与数据刷新

**视觉**：复用全局 design token（`web/src/index.css` 的 `--bg`/`--accent`/`--bg-elevated` 等），散落内联样式收进 `dashboard.css`。深色科技感——统计卡片细边框+微光，状态色带区分（running 蓝 / completed 绿 / failed 红）。

**分级刷新**：
- 列表页轮询收敛：概览 3s、任务 3s、团队 10s
- 详情页：点开拉一次 `/api/task/:taskId`；**仅进行中任务**挂 2s 轮询，**已完成任务不轮询**（轨迹是死数据）
- 实时动态：继续用现有 `/events` SSE

**空态/加载态**：每页明确空态；详情页加载给骨架屏。

## 不动的东西

- 聊天页（ChatView）、A2A bus/client 基础通信机制
- EverOS 记忆、任务调度器、agent 转正逻辑
- 全局 design token 定义

## 验证

**后端**：
```bash
npx tsc --noEmit          # 类型检查
npx vitest run            # 现有测试不回归
```
- 派一个多子任务任务，执行完后查库：`jarvis_subtask_turns` 有逐回合记录，`jarvis_subtasks` 的 started_at/turn_count/token/retry 已填
- `GET /api/task/:taskId` 返回完整结构（子任务 + turns + 沟通 + 产物）

**前端**（浏览器实测）：
1. 三个导航页切换正常，各自空态正确
2. 概览页统计数字准确
3. 任务页点任意任务 → 详情页展示元信息卡片、子任务树、可展开轨迹、中途沟通对话
4. 进行中任务详情随执行实时刷新；完成任务详情不再轮询
5. 团队页点小弟 → 档案页展示领域/次数/历史任务
