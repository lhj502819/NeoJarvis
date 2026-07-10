# 对话页执行监控栏 设计

> 状态:已批准,待转 writing-plans
> 日期:2026-07-10

## 背景与问题

用户想在对话时看到 Jarvis 派出的小弟(sub-agent)的实时执行详情。最初设想是"对话流里的内联可展开卡片",但在 brainstorm 中被推翻——**内联卡片与"边聊边盯进度"的需求根本冲突**:任务是长时间、持续更新的,而对话流不断往下滚。用户派任务后继续跟 Jarvis 探讨,卡片就被顶上去了;想看实时进度还得往回翻,而它还在变。

**核心诉求**(用户明确):边聊边盯进度,位置固定。

因此改为:对话页两栏布局,右侧一个**常驻执行监控栏**(不随对话滚动),想深入看某个小弟的完整轨迹时点击**放大成遮罩层 modal**。

## 现状(探查结论)

- 小弟执行时,`client.ts` 的 `onProgress`(每回合触发,含回合数/步数/工具)→ `action-dispatcher.ts` 的回调里**只** `updateSubTask` 存库(看板消费),**没有 broadcast 到前端**。
- 逐回合轨迹已存在 `jarvis_subtask_turns` 表(看板重设计时建的),看板 `GET /api/task/:taskId` 已能返回 `turnsBySubtask`。
- 对话页(`ChatView`)当前是**全宽单栏**,只有 `ChatPanel`,无侧栏。`AgentsSidebar` 组件存在但未挂载到对话页。
- SSE:`broadcast(type, content, userId)` 只发 `{type, content, timestamp}`;前端 `useSSE` 累积事件但**只保留最近 50 条**(`prev.slice(-50)`);`applyLiveEvent` 已有 `progress`/`delta`/`response`/`artifact` 分支;现有 `artifact` 事件用「JSON 塞进 content,前端 JSON.parse」的模式。
- `GET /api/agents`(`listAllRunningTasks`)已返回当前在跑的小弟列表。

**结论**:执行数据库里已有,缺的是「广播到对话页 + 常驻栏渲染 + 放大 modal」。

## 目标

1. 对话页改两栏,右侧新增常驻执行监控栏,实时显示在跑/刚完成的小弟。
2. 新增 `subtask` SSE 事件,把小弟执行状态广播到前端(复用 artifact 的 JSON-in-content 模式,不改 broadcast 签名)。
3. 点击监控项或对话流锚点 → 遮罩层 modal 放大看逐回合完整轨迹(复用看板 `/api/task/:taskId` 拿轨迹)。
4. 对话流里派单处只留轻量锚点,不承载持续更新的详情。

## 非目标

- **多副本 fan-out 执行**(同一任务派 N 个小弟副本并行 + 汇总)——这是新的执行编排引擎,改数据模型/派单/汇总逻辑,与本次「展示层」不是一个层面。设计稿保留了该模式的 UI(`execution-card.html` 的"多副本"视图)作为未来参考,但本次不实现。
- 不改小弟执行逻辑、不改 `jarvis_subtask_turns` 表结构。
- 不做移动端窄屏适配(对话页本就桌面为主);窄屏下监控栏可后续迭代成抽屉。

---

## 决策记录(来自 brainstorm)

| 决策点 | 选择 |
|---|---|
| 展示位置 | 对话页两栏,右侧常驻监控栏(**推翻内联卡片**) |
| 放大形态 | 点击弹出**遮罩层 modal** |
| 空闲时 | **整栏收起**(对话区占满宽),有小弟开工才滑出 |
| 完成后 | 标绿/红**短暂保留(~30s)后淡出** |
| 数据源 | 复用 `jarvis_subtask_turns` + 新增 `subtask` 广播事件 |
| 本次范围 | 只做展示层;多副本 fan-out 另开 |

---

## 架构与数据流

```
小弟执行(client.ts onProgress,每回合)
   ↓
action-dispatcher onProgress 回调:
   ① updateSubTask(存库,不变)
   ② broadcast('subtask', JSON.stringify(payload), userId)  ← 新增
   小弟完成/失败时:broadcast('subtask', {status:done/failed,...})  ← 新增
   ↓
前端 useSSE 收到 → MonitorPanel 维护 Map<subtaskId, MonitorItem>
   ↓
右侧常驻栏渲染在跑/刚完成的小弟;done/failed 项 ~30s 后从 Map 移除
   ↓
点击某项 → 放大 modal → fetch GET /api/task/:taskId 拿完整 turnsBySubtask → 展示该 subtask 逐回合轨迹
```

**为什么 MonitorPanel 自持状态 Map,而非回放 events**:`useSSE` 只留最近 50 条事件,长任务的早期事件会被挤掉。MonitorPanel 必须以 subtaskId 为键累积「最新状态」,每来一个 `subtask` 事件就更新对应项,而不是重放事件流。挂载时先用 `GET /api/agents` 拉当前在跑的作为初始集。

### subtask 事件 payload

```typescript
// broadcast('subtask', JSON.stringify(payload), userId) 的 payload:
interface SubtaskEventPayload {
  subtaskId: string
  taskId: string
  agentName: string        // 小弟名(recipe.name 或临时工描述名)
  taskName: string         // 子任务名/描述,监控项副标题
  status: 'running' | 'done' | 'failed'
  turnCount: number        // 当前回合数
  currentAction?: string   // 当前动作预览(running 时)
  currentTool?: string     // 当前/最近调用的工具名(running 时)
  elapsedMs?: number       // 已耗时(可选,前端也能自己算)
}
```

---

## 组件设计

### 后端(改动小)

**`src/jarvis/action-dispatcher.ts`** — 在 `executeSubTask` 里:
- `onProgress` 回调现有 `updateSubTask(...)` 之后,新增一句 `broadcast('subtask', JSON.stringify({subtaskId, taskId, agentName, taskName, status:'running', turnCount, currentAction, currentTool}), userId)`。回合数/工具从 `onProgress` 的入参解析,或让 `client.ts` 的 `onProgress` 改为传结构化对象(见下)。
- `handleSubTaskComplete` / `handleSubTaskFailed` 时,`broadcast('subtask', {status:'done'|'failed', ...}, userId)`。

**`src/a2a/client.ts`** — `onProgress` 当前传的是拼好的字符串(`回合 N | 已执行 N 步\n...`)。为让 dispatcher 能拿到结构化字段(turnCount、currentTool),把 `DispatchContext.onProgress` 的签名从 `(progress: string) => void` 扩展为 `(progress: { text: string; turnCount: number; currentTool?: string; currentAction?: string }) => void`。改动两处调用点:回合进度处(client.ts:250,传完整结构)+ 重试提示处(client.ts:187,只填 text、turnCount 用当前值)。dispatcher 的回调同步改。
- **兼容**:`updateSubTask` 的 progress 字段仍存 `text`(看板不受影响)。

**`broadcast` 不改签名**——`subtask` 走 JSON-in-content,与 artifact 一致。

### 前端(主要工作量)

**`web/src/App.tsx`** — `ChatView` 改两栏:
```
<div className="chat-body">          // flex 两栏
  <ChatPanel .../>                    // 左,flex:1
  <MonitorPanel .../>                 // 右,320px;空闲时组件返回 null(整栏收起)
</div>
```

**`web/src/components/MonitorPanel.tsx`**(新建)——常驻监控栏:
- 自持 `Map<subtaskId, MonitorItem>` state。
- 挂载时 `fetchJSON('/api/agents')` 拉当前在跑集作初始。
- 订阅 `/events`(复用 `useSSE` 或从 App 传入 events),每个 `subtask` 事件 upsert 对应项。
- `status: done/failed` 的项打标(绿/红),启一个 30s 定时器后从 Map 删除(淡出动画)。
- Map 为空 → 组件返回 `null`(整栏不渲染,对话区占满)。
- 每项渲染:状态点 + 名字 + 状态标签 + 任务副标题 + `回合 N · 耗时 · 当前工具` + 脉冲进度条。点击 → 打开 modal。
- 耗时前端本地 tick(setInterval 1s)自增,避免依赖后端每秒广播。

**`web/src/components/ExecutionModal.tsx`**(新建)——放大遮罩层:
- 入参 `{ taskId, subtaskId, onClose }`。
- 打开时 `fetchJSON('/api/task/' + taskId)`(复用看板已有接口)→ 取 `turnsBySubtask[subtaskId]` → 渲染逐回合轨迹 + 顶部统计条(回合/工具调用/token/耗时,从 `task.subtasks` 找到该 subtask 的元信息)。
- running 时 2s 轮询刷新(与看板 TaskDetail 一致);done/failed 不轮询。
- Esc 键 / 点遮罩空白处关闭。

**对话流锚点** — 现有 `create_task` action 已在对话里输出"正在后台执行"。改成一个可点击的锚点元素(点击 = 打开对应 subtask 的 modal)。锚点数据:action-dispatcher 派单时,Jarvis 回复里已带任务信息;前端 message 可选加 `dispatchRef?: { taskId, subtaskId, agentName }` 字段承载锚点。**简化**:若锚点实现复杂,MVP 可先只做监控栏点击进 modal,对话流锚点退化为纯文本(不可点),后续迭代。

**样式** — 复用全局 token(`web/src/index.css`)。监控栏/modal 的类名收进新的 `MonitorPanel.css` 或复用 `dashboard.css` 的模式。设计稿 `designs/agent-execution-card/monitor-panel.html` 是视觉参考。

---

## 数据流示例

**派单 → 监控**:
```
用户"调研清迈攻略" → Jarvis create_task → executeSubTask 派差旅出行专家
  → 每回合 broadcast('subtask', {subtaskId, status:running, turnCount:14, currentTool:'semble', ...})
  → MonitorPanel upsert → 右栏出现"差旅出行专家 · 清迈攻略 · 回合14 · semble",脉冲条动
用户继续跟 Jarvis 聊别的 → 对话流滚动,右栏不动,进度持续更新
```

**放大**:
```
点右栏该项 → ExecutionModal 打开 → GET /api/task/{taskId} → 展示该 subtask 全部回合轨迹
running 中 → 2s 轮询,回合递增;完成 → 停止轮询
Esc / 点遮罩 → 关闭
```

**完成淡出**:
```
小弟完成 → broadcast('subtask', {status:done, turnCount:18, ...})
  → MonitorPanel 该项标绿"已完成",启 30s 定时器
  → 30s 后从 Map 删除,淡出;若这是最后一项,整栏收起
结果全文仍在对话流里 Jarvis 的汇报消息中(不变)
```

## 错误处理

- `broadcast('subtask', ...)` 失败不影响执行(broadcast 内部对已断开 client 安全)。
- MonitorPanel 的 `/api/agents` 初始拉取失败 → 从空 Map 起,靠后续 live 事件填充(`.catch` 静默)。
- ExecutionModal 的 `/api/task/:taskId` 失败 → modal 内显示"加载失败",不崩。
- subtask 事件 JSON.parse 失败 → 跳过该事件(与 artifact 分支的 try/catch 一致)。

## 测试策略

**单元测试**:
- `subtask` 事件 payload 的构造:给定回合数据,`action-dispatcher` 产出正确的 payload 结构(可抽一个纯函数 `buildSubtaskEvent()` 测)。
- MonitorPanel 的状态归约:给定一串 subtask 事件,Map 正确 upsert;done 事件触发移除逻辑(用假定时器测 30s 淡出)。

**端到端(浏览器)**:
- 派一个多回合任务 → 右栏出现监控项,回合数随执行递增,当前工具更新。
- 派单期间继续发对话消息 → 对话流滚动,右栏位置不动、持续更新。
- 点监控项 → modal 弹出,显示逐回合轨迹;running 时 2s 刷新;Esc 关闭。
- 小弟完成 → 标绿,~30s 后淡出;最后一项走后整栏收起。
- 空闲(无在跑)进入对话页 → 右栏不显示,对话区占满宽。
- 多个小弟并行 → 右栏多项并列,各自独立更新。

## 实施顺序建议(供 writing-plans 参考)

1. **后端广播**:扩展 `DispatchContext.onProgress` 为结构化对象;client.ts 两处调用点改造;action-dispatcher 加 `broadcast('subtask', ...)`(running/done/failed)。附单测 `buildSubtaskEvent`。
2. **前端事件消费**:`SSEEvent` 已够用(type=subtask,content=JSON);在 hooks 或 MonitorPanel 里解析。
3. **MonitorPanel 组件**:状态 Map + `/api/agents` 初始化 + live upsert + 30s 淡出 + 空态收起 + 本地耗时 tick。单测状态归约。
4. **两栏布局**:App.tsx ChatView 改造 + MonitorPanel.css。
5. **ExecutionModal**:复用 `/api/task/:taskId`,轨迹 + 统计 + 2s 轮询 + Esc/遮罩关闭。
6. **对话流锚点**(可选/MVP 可降级):message 加 `dispatchRef`,点击开 modal。
7. **端到端验证 + 收尾**。
