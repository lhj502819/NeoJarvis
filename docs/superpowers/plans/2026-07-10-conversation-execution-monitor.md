# 对话页执行监控栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让对话页在小弟执行时,不刷屏、位置固定地看到实时进度——两栏布局 + 右侧常驻执行监控栏 + 点击放大 modal 看逐回合轨迹。

**Architecture:** 后端在派单执行循环(action-dispatcher)里新增 `broadcast('subtask', JSON.stringify(payload), userId)`,复用 artifact 的 JSON-in-content 模式,不改 broadcast 签名。`DispatchContext.onProgress` 从 `(string) => void` 扩为结构化对象(带 turnCount/currentTool/currentAction),让 dispatcher 能取出结构化字段广播。前端 ChatView 改两栏:左 ChatPanel 不变,右侧新增 MonitorPanel,自持 `Map<subtaskId, MonitorItem>`,挂载时 `GET /api/agents` 初始化、后续靠 SSE `subtask` 事件 upsert,done/failed 项 ~30s 后从 Map 删除并淡出;Map 空则组件返回 null(整栏收起,对话区占满)。点击监控项弹 ExecutionModal 遮罩层,复用看板已有的 `GET /api/task/:taskId` 拿逐回合轨迹。

**Tech Stack:** TypeScript (ESM)、Express、React、vitest。

## Global Constraints

- ESM 导入路径必须带 `.js` 后缀(如 `import { x } from './y.js'`)。
- 时间戳用 ISO 字符串(`new Date().toISOString()`)。
- 后端类型检查零报错:`npx tsc --noEmit`;前端:`cd web && npx tsc -b`。
- 现有单测不得回归:`npx vitest run`。
- **不改 `broadcast(type, content, userId)` 签名**——`subtask` 事件走 JSON-in-content 模式,与现有 `artifact` 事件一致。
- **不改 `jarvis_subtask_turns` 表结构、不改小弟执行逻辑**——数据源全部复用现有。
- 前端复用全局 design token(`web/src/index.css` 的 `--bg-elevated`/`--accent`/`--green` 等),禁止散落内联样式(收进对应 CSS 文件)。
- 监控栏空闲(Map 为空)时组件返回 `null`,不占位。
- 完成/失败项在监控栏保留 ~30s 后从 Map 删除并淡出。

---

## File Structure

**后端(修改):**
- `src/a2a/client.ts` — `DispatchContext.onProgress` 签名扩为结构化;两处 `onProgress` 调用点(回合进度处 line 250、重试提示处 line 187)传结构化对象
- `src/jarvis/action-dispatcher.ts` — `executeSubTask` 的 onProgress 回调新增 `broadcast('subtask', ...)`;`handleSubTaskComplete/Failed` 处新增 `broadcast('subtask', done/failed, ...)`
- `src/jarvis/subtask-event.ts` — 新建,导出 `buildSubtaskEvent()` 纯函数(供 dispatcher 用,便于单测)

**前端(新建/修改):**
```
web/src/components/
├── MonitorPanel.tsx        // 新建:常驻栏,状态 Map + upsert + 淡出
├── MonitorPanel.css        // 新建
├── ExecutionModal.tsx      // 新建:遮罩层 modal + 轨迹渲染 + 2s 轮询
└── ExecutionModal.css      // 新建
web/src/api/hooks.ts        // 修改:SubtaskEvent 类型;不需要新 hook
web/src/App.tsx             // 修改:ChatView 改两栏,挂载 MonitorPanel
```

**测试(新建):**
- `tests/unit/subtask-event.test.ts` — `buildSubtaskEvent` 单测
- `web/src/components/MonitorPanel.test.tsx` — MonitorPanel 状态归约单测(用 vitest + React Testing Library 若已装;若前端无测试栈,则跳过并靠端到端覆盖)

---

## Task 1: 后端 — subtask 事件 payload 构造(纯函数 + 单测)

**Files:**
- Create: `src/jarvis/subtask-event.ts`
- Test: `tests/unit/subtask-event.test.ts` (Create)

**Interfaces:**
- Produces:
  ```typescript
  export interface SubtaskEventPayload {
    subtaskId: string
    taskId: string
    agentName: string
    taskName: string
    status: 'running' | 'done' | 'failed'
    turnCount: number
    currentAction?: string
    currentTool?: string
    elapsedMs?: number
    error?: string  // status=failed 时
  }
  export function buildSubtaskEvent(input: {
    subtaskId: string
    taskId: string
    agentName: string
    taskName: string
    status: 'running' | 'done' | 'failed'
    turnCount: number
    currentAction?: string
    currentTool?: string
    startedAt?: number
    error?: string
  }): SubtaskEventPayload
  ```

- [ ] **Step 1: Write the failing test**

新建 `tests/unit/subtask-event.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildSubtaskEvent } from '../../src/jarvis/subtask-event.js'

describe('buildSubtaskEvent', () => {
  it('running 事件带 turnCount 与 currentTool', () => {
    const evt = buildSubtaskEvent({
      subtaskId: 'st-1', taskId: 't-1',
      agentName: '差旅出行专家', taskName: '清迈攻略',
      status: 'running', turnCount: 14,
      currentAction: '正在核对交通费用', currentTool: 'semble',
    })
    expect(evt).toEqual({
      subtaskId: 'st-1', taskId: 't-1',
      agentName: '差旅出行专家', taskName: '清迈攻略',
      status: 'running', turnCount: 14,
      currentAction: '正在核对交通费用', currentTool: 'semble',
    })
  })

  it('done 事件不带 currentTool/currentAction', () => {
    const evt = buildSubtaskEvent({
      subtaskId: 'st-1', taskId: 't-1',
      agentName: 'X专家', taskName: 't',
      status: 'done', turnCount: 18,
    })
    expect(evt.status).toBe('done')
    expect(evt.turnCount).toBe(18)
    expect(evt.currentTool).toBeUndefined()
    expect(evt.currentAction).toBeUndefined()
  })

  it('failed 事件带 error', () => {
    const evt = buildSubtaskEvent({
      subtaskId: 'st-1', taskId: 't-1',
      agentName: 'X专家', taskName: 't',
      status: 'failed', turnCount: 3, error: 'API 500',
    })
    expect(evt.status).toBe('failed')
    expect(evt.error).toBe('API 500')
  })

  it('startedAt 存在则计算 elapsedMs(≥0)', () => {
    const past = Date.now() - 5000
    const evt = buildSubtaskEvent({
      subtaskId: 'st-1', taskId: 't-1',
      agentName: 'X', taskName: 't',
      status: 'running', turnCount: 1, startedAt: past,
    })
    expect(evt.elapsedMs).toBeGreaterThanOrEqual(4000)
    expect(evt.elapsedMs).toBeLessThan(60000)
  })

  it('startedAt 未提供则 elapsedMs 为 undefined', () => {
    const evt = buildSubtaskEvent({
      subtaskId: 'st-1', taskId: 't-1',
      agentName: 'X', taskName: 't',
      status: 'running', turnCount: 1,
    })
    expect(evt.elapsedMs).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/subtask-event.test.ts`
Expected: FAIL — `Cannot find module '../../src/jarvis/subtask-event.js'`

- [ ] **Step 3: 实现 subtask-event.ts**

新建 `src/jarvis/subtask-event.ts`:

```typescript
export interface SubtaskEventPayload {
  subtaskId: string
  taskId: string
  agentName: string
  taskName: string
  status: 'running' | 'done' | 'failed'
  turnCount: number
  currentAction?: string
  currentTool?: string
  elapsedMs?: number
  error?: string
}

export function buildSubtaskEvent(input: {
  subtaskId: string
  taskId: string
  agentName: string
  taskName: string
  status: 'running' | 'done' | 'failed'
  turnCount: number
  currentAction?: string
  currentTool?: string
  startedAt?: number
  error?: string
}): SubtaskEventPayload {
  const payload: SubtaskEventPayload = {
    subtaskId: input.subtaskId,
    taskId: input.taskId,
    agentName: input.agentName,
    taskName: input.taskName,
    status: input.status,
    turnCount: input.turnCount,
  }
  if (input.currentAction !== undefined) payload.currentAction = input.currentAction
  if (input.currentTool !== undefined) payload.currentTool = input.currentTool
  if (input.startedAt !== undefined) payload.elapsedMs = Math.max(0, Date.now() - input.startedAt)
  if (input.error !== undefined) payload.error = input.error
  return payload
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/subtask-event.test.ts`
Expected: PASS(5 用例)

- [ ] **Step 5: tsc + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 无输出;全过(既有 + 5 新)

- [ ] **Step 6: Commit**

```bash
git add src/jarvis/subtask-event.ts tests/unit/subtask-event.test.ts
git commit -m "feat(monitor): subtask 事件 payload 构造函数(纯函数)"
```

---

## Task 2: client.ts — onProgress 扩为结构化对象

**Files:**
- Modify: `src/a2a/client.ts` (`DispatchContext` line 31-40;line 187 和 line 248-251 两处调用)

**Interfaces:**
- Consumes: 无
- Produces:
  - 新的 `onProgress` 签名:`(progress: { text: string; turnCount: number; currentTool?: string; currentAction?: string }) => void`

- [ ] **Step 1: 改 DispatchContext.onProgress 签名**

`src/a2a/client.ts` 的 `DispatchContext`(line 31-40)里,把:

```typescript
  onProgress?: (progress: string) => void
```

改为:

```typescript
  onProgress?: (progress: { text: string; turnCount: number; currentTool?: string; currentAction?: string }) => void
```

- [ ] **Step 2: 改回合进度处调用(line 248-251)**

原代码:

```typescript
          if (context?.onProgress) {
            const recent = progressLog.slice(-5).join('\n')
            context.onProgress(`回合 ${turnCount} | 已执行 ${progressLog.length} 步\n${recent}`)
          }
```

改为:

```typescript
          if (context?.onProgress) {
            const recent = progressLog.slice(-5).join('\n')
            const text = `回合 ${turnCount} | 已执行 ${progressLog.length} 步\n${recent}`
            // 从最新 progressLog 里抓最后一条工具/文本作 currentAction/currentTool
            const lastLog = progressLog[progressLog.length - 1] || ''
            const toolMatch = lastLog.match(/🔧 (\S+)/)
            context.onProgress({
              text,
              turnCount,
              currentTool: toolMatch ? toolMatch[1] : undefined,
              currentAction: lastLog.replace(/^\[\d+\] /, '').slice(0, 80),
            })
          }
```

- [ ] **Step 3: 改重试提示处调用(line 187)**

原代码:

```typescript
      context?.onProgress?.(`⚠️ API 错误，第 ${attempt} 次重试中...`)
```

改为(重试时用当前 `turnCount`,可能为 0):

```typescript
      context?.onProgress?.({
        text: `⚠️ API 错误，第 ${attempt} 次重试中...`,
        turnCount: 0,
      })
```

- [ ] **Step 4: tsc 会在 action-dispatcher 报错**

Run: `npx tsc --noEmit`
Expected: FAIL — `src/jarvis/action-dispatcher.ts` 里 `onProgress: (progress) => { updateSubTask(..., { progress }).catch(...) }` 的 progress 现在是对象,不能直接塞 progress 字段(字符串)。**这是预期的,Task 3 修复。**

- [ ] **Step 5: Commit**

```bash
git add src/a2a/client.ts
git commit -m "feat(monitor): onProgress 扩为结构化对象(text/turnCount/currentTool/currentAction)"
```

---

## Task 3: action-dispatcher.ts — 消费结构化 onProgress + 广播 subtask 事件

**Files:**
- Modify: `src/jarvis/action-dispatcher.ts` (import + `executeSubTask` 的 onProgress 回调 line 83-85;`handleSubTaskComplete/Failed` 调用后新增 broadcast)

**Interfaces:**
- Consumes:
  - `buildSubtaskEvent` (Task 1)
  - client.ts 新签名 (Task 2)
  - 现有 `broadcast(type, content, userId)`
- Produces: subtask SSE 事件的 running / done / failed 三种广播

- [ ] **Step 1: 补 import**

`src/jarvis/action-dispatcher.ts` 顶部 import 区,现有 `broadcast` 已 import(from `./sse.js`)。补:

```typescript
import { buildSubtaskEvent } from './subtask-event.js'
import { getRecipe } from '../team/registry.js'
```

(getRecipe 可能已 import — 检查现有 import 行,若已存在则不重复。)

- [ ] **Step 2: 改造 executeSubTask 的 onProgress 回调**

现有 line 83-85:

```typescript
      onProgress: (progress) => {
        updateSubTask(userId, taskId, subtaskId, { progress }).catch(() => {})
      },
```

改为(接收结构化对象,存库仍存 text,同时 broadcast):

```typescript
      onProgress: (progress) => {
        updateSubTask(userId, taskId, subtaskId, { progress: progress.text }).catch(() => {})
        const payload = buildSubtaskEvent({
          subtaskId, taskId,
          agentName: recipe?.name || assignee,
          taskName: description.slice(0, 60),
          status: 'running',
          turnCount: progress.turnCount,
          currentAction: progress.currentAction,
          currentTool: progress.currentTool,
          startedAt: startedAtMs,
        })
        broadcast('subtask', JSON.stringify(payload), userId)
      },
```

**注意**:上述代码引用 `recipe` 和 `startedAtMs`,需在 `executeSubTask` 函数体顶部提供:
- `recipe` 已由 line 67 `const recipe = await getRecipe(userId, assignee)` 提供,直接用。
- `startedAtMs`:在 `registerRunningTask(...)` 那行(line 73)之后加一行:
  ```typescript
  const startedAtMs = Date.now()
  ```

- [ ] **Step 3: 在 handleSubTaskComplete 后广播 done**

现有 `action-dispatcher.ts` 处理并行结果的循环(line 142-155):

```typescript
      for (let i = 0; i < runnables.length; i++) {
        const r = results[i]
        if (r.status === 'fulfilled') {
          await handleSubTaskComplete(userId, taskId, runnables[i].id, r.value)
          completed++
          broadcast('progress', `✅ [${completed}/${subtasks.length}] ${runnables[i].name} — 完成`, userId)
          await onTaskCompleted(userId)
        } else {
          const errMsg = r.reason?.message || 'unknown'
          if (errMsg.includes('取消')) continue
          await handleSubTaskFailed(userId, taskId, runnables[i].id, errMsg)
          broadcast('progress', `❌ ${runnables[i].name} — 失败`, userId)
        }
      }
```

改为(每个分支多一句 `broadcast('subtask', done/failed, ...)`,不改现有 progress 广播):

```typescript
      for (let i = 0; i < runnables.length; i++) {
        const r = results[i]
        const st = runnables[i]
        // 拿 agent 名(有 recipe 用 recipe.name,否则用 assignee)
        const recipe = await getRecipe(userId, st.assignee)
        const agentName = recipe?.name || st.assignee
        if (r.status === 'fulfilled') {
          await handleSubTaskComplete(userId, taskId, st.id, r.value)
          completed++
          broadcast('progress', `✅ [${completed}/${subtasks.length}] ${st.name} — 完成`, userId)
          broadcast('subtask', JSON.stringify(buildSubtaskEvent({
            subtaskId: st.id, taskId,
            agentName, taskName: st.name,
            status: 'done', turnCount: 0,  // turnCount 前端已从 running 事件累积到最终值,此处不需要精确
          })), userId)
          await onTaskCompleted(userId)
        } else {
          const errMsg = r.reason?.message || 'unknown'
          if (errMsg.includes('取消')) continue
          await handleSubTaskFailed(userId, taskId, st.id, errMsg)
          broadcast('progress', `❌ ${st.name} — 失败`, userId)
          broadcast('subtask', JSON.stringify(buildSubtaskEvent({
            subtaskId: st.id, taskId,
            agentName, taskName: st.name,
            status: 'failed', turnCount: 0, error: errMsg,
          })), userId)
        }
      }
```

- [ ] **Step 4: tsc 检查**

Run: `npx tsc --noEmit`
Expected: 无输出(Task 2 的悬空错误消失)

- [ ] **Step 5: 全量测试不回归**

Run: `npx vitest run`
Expected: 全过

- [ ] **Step 6: Commit**

```bash
git add src/jarvis/action-dispatcher.ts
git commit -m "feat(monitor): action-dispatcher 广播 subtask 事件(running/done/failed)"
```

---

## Task 4: 前端 — SubtaskEvent 类型 + hook 消费

**Files:**
- Modify: `web/src/api/hooks.ts` (加 `SubtaskEvent` 类型 export;`applyLiveEvent` 里 subtask 分支交给外部消费者不处理)

**Interfaces:**
- Produces:
  - `interface SubtaskEvent { subtaskId, taskId, agentName, taskName, status, turnCount, currentAction?, currentTool?, elapsedMs?, error? }`
  - `parseSubtaskEvent(content: string): SubtaskEvent | null`(容错解析)

- [ ] **Step 1: 加类型与解析函数**

在 `web/src/api/hooks.ts` 的 `SSEEvent` 接口(line 249-253)之后加:

```typescript
export interface SubtaskEvent {
  subtaskId: string
  taskId: string
  agentName: string
  taskName: string
  status: 'running' | 'done' | 'failed'
  turnCount: number
  currentAction?: string
  currentTool?: string
  elapsedMs?: number
  error?: string
}

export function parseSubtaskEvent(content: string): SubtaskEvent | null {
  try {
    const obj = JSON.parse(content)
    if (typeof obj?.subtaskId !== 'string') return null
    if (typeof obj?.taskId !== 'string') return null
    if (obj.status !== 'running' && obj.status !== 'done' && obj.status !== 'failed') return null
    return obj as SubtaskEvent
  } catch { return null }
}
```

- [ ] **Step 2: applyLiveEvent 不处理 subtask 事件**

`applyLiveEvent` 现有 switch 分支只覆盖 `progress/delta/response/artifact`。`subtask` 事件让 MonitorPanel 自己订阅 `useSSE` 消费,无需在此改。**本任务只加类型,不改 applyLiveEvent**。

- [ ] **Step 3: 前端类型检查**

Run: `cd web && npx tsc -b`
Expected: 无输出

- [ ] **Step 4: Commit**

```bash
git add web/src/api/hooks.ts
git commit -m "feat(monitor): 前端 SubtaskEvent 类型 + parseSubtaskEvent"
```

---

## Task 5: MonitorPanel 组件 — 状态 Map + 空态收起 + 淡出

**Files:**
- Create: `web/src/components/MonitorPanel.tsx`
- Create: `web/src/components/MonitorPanel.css`

**Interfaces:**
- Consumes: `SubtaskEvent` / `parseSubtaskEvent` (Task 4);现有 `useSSE`;`fetchJSON`;`GET /api/agents`(返回 `RunningTask[]` 包含 `subtaskId, taskId, recipeId, description, startedAt`)
- Produces:
  - `<MonitorPanel onOpen={(taskId, subtaskId) => void} />` — 空 Map 时返回 null
  - `interface MonitorItem { subtaskId, taskId, agentName, taskName, status, turnCount, currentTool?, startedAtMs, doneAtMs?, error? }`

- [ ] **Step 1: 建 CSS**

新建 `web/src/components/MonitorPanel.css`(复用 index.css 的 token):

```css
.monitor {
  width: 320px; flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: var(--bg-elevated);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.monitor-head {
  flex-shrink: 0; padding: 14px 16px;
  border-bottom: 1px solid var(--border-light);
  display: flex; align-items: center; gap: 8px;
}
.monitor-title { font-size: 13px; font-weight: 600; }
.monitor-badge {
  font-family: var(--font-mono); font-size: 11px;
  color: var(--accent-hover); background: var(--accent-light);
  padding: 1px 8px; border-radius: var(--radius-full);
}
.monitor-list { flex: 1; overflow-y: auto; padding: 10px; }

.mon-item {
  background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 11px 12px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.15s, opacity 0.6s;
}
.mon-item:hover { border-color: var(--accent); }
.mon-item[data-state="running"] { border-color: rgba(99,102,241,0.3); }
.mon-item.fading { opacity: 0; }

.mon-row1 { display: flex; align-items: center; gap: 8px; }
.mon-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
[data-state="running"] .mon-dot { background: var(--accent); animation: mon-pulse 1.6s infinite; }
[data-state="done"] .mon-dot { background: var(--green); }
[data-state="failed"] .mon-dot { background: var(--red); }
@keyframes mon-pulse {
  0% { box-shadow: 0 0 0 0 rgba(99,102,241,0.5); }
  70% { box-shadow: 0 0 0 5px rgba(99,102,241,0); }
  100% { box-shadow: 0 0 0 0 rgba(99,102,241,0); }
}
.mon-name { font-size: 13px; font-weight: 600; }
.mon-spacer { flex: 1; }
.mon-status { font-size: 11px; font-weight: 500; padding: 1px 7px; border-radius: var(--radius-sm); }
[data-state="running"] .mon-status { color: var(--accent-hover); background: var(--accent-light); }
[data-state="done"] .mon-status { color: var(--green); background: var(--green-bg); }
[data-state="failed"] .mon-status { color: var(--red); background: var(--red-bg); }
.mon-task { font-size: 12px; color: var(--text-muted); margin: 6px 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mon-meter { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; }
.mon-tool { font-family: var(--font-mono); font-size: 10px; color: var(--accent-hover); background: var(--accent-light); padding: 0 5px; border-radius: var(--radius-sm); }

.mon-pulse-bar { height: 3px; background: var(--bg-subtle); border-radius: var(--radius-full); margin-top: 8px; overflow: hidden; position: relative; }
.mon-pulse-bar::after {
  content: ""; position: absolute; top: 0; left: 0; height: 100%; width: 40%;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  animation: mon-slide 1.8s ease-in-out infinite;
}
.mon-item[data-state="done"] .mon-pulse-bar,
.mon-item[data-state="failed"] .mon-pulse-bar { display: none; }
@keyframes mon-slide { 0% { left: -40%; } 100% { left: 100%; } }
```

- [ ] **Step 2: 建 MonitorPanel.tsx**

新建 `web/src/components/MonitorPanel.tsx`:

```tsx
import { useEffect, useState, useRef, useCallback } from 'react'
import { fetchJSON } from '../api/client'
import { useSSE, parseSubtaskEvent, type SubtaskEvent } from '../api/hooks'
import './MonitorPanel.css'

interface MonitorItem {
  subtaskId: string
  taskId: string
  agentName: string
  taskName: string
  status: 'running' | 'done' | 'failed'
  turnCount: number
  currentTool?: string
  startedAtMs: number
  doneAtMs?: number
  error?: string
}

interface RunningTaskInit {
  subtaskId: string
  taskId: string
  recipeId: string
  description: string
  startedAt: number
  name?: string
}

const FADE_MS = 30_000  // done/failed 保留 30s 后淡出

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export function MonitorPanel({ onOpen }: { onOpen: (taskId: string, subtaskId: string) => void }) {
  const [items, setItems] = useState<Map<string, MonitorItem>>(new Map())
  const [fading, setFading] = useState<Set<string>>(new Set())
  const [tick, setTick] = useState(0)  // 每秒重渲染,驱动 elapsed 更新
  const { events } = useSSE('/events')
  const processedRef = useRef(0)

  // 初始拉在跑列表
  useEffect(() => {
    fetchJSON<RunningTaskInit[]>('/api/agents').then(list => {
      const map = new Map<string, MonitorItem>()
      for (const r of list) {
        map.set(r.subtaskId, {
          subtaskId: r.subtaskId, taskId: r.taskId,
          agentName: r.name || r.recipeId,
          taskName: r.description.slice(0, 60),
          status: 'running', turnCount: 0,
          startedAtMs: r.startedAt,
        })
      }
      setItems(map)
    }).catch(() => {})
  }, [])

  // 消费 SSE subtask 事件
  useEffect(() => {
    for (let i = processedRef.current; i < events.length; i++) {
      const evt = events[i]
      if (evt.type !== 'subtask') continue
      const p = parseSubtaskEvent(evt.content)
      if (!p) continue
      setItems(prev => {
        const next = new Map(prev)
        const existing = next.get(p.subtaskId)
        next.set(p.subtaskId, {
          subtaskId: p.subtaskId, taskId: p.taskId,
          agentName: p.agentName, taskName: p.taskName,
          status: p.status, turnCount: p.turnCount,
          currentTool: p.currentTool,
          startedAtMs: existing?.startedAtMs || (Date.now() - (p.elapsedMs || 0)),
          doneAtMs: p.status !== 'running' ? Date.now() : undefined,
          error: p.error,
        })
        return next
      })
    }
    processedRef.current = events.length
  }, [events])

  // done/failed 项 30s 后淡出并删除
  useEffect(() => {
    const timers: number[] = []
    for (const [id, item] of items) {
      if (item.status === 'running') continue
      if (fading.has(id)) continue
      const fadeAt = (item.doneAtMs || Date.now()) + FADE_MS - 600
      const removeAt = (item.doneAtMs || Date.now()) + FADE_MS
      const now = Date.now()
      timers.push(window.setTimeout(() => setFading(s => new Set(s).add(id)), Math.max(0, fadeAt - now)))
      timers.push(window.setTimeout(() => {
        setItems(prev => { const n = new Map(prev); n.delete(id); return n })
        setFading(prev => { const n = new Set(prev); n.delete(id); return n })
      }, Math.max(0, removeAt - now)))
    }
    return () => { for (const t of timers) clearTimeout(t) }
  }, [items, fading])

  // 每秒 tick 驱动 elapsed 显示
  useEffect(() => {
    const timer = window.setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  // 空 Map -> 整栏收起
  if (items.size === 0) return null

  const list = Array.from(items.values()).sort((a, b) => {
    // running 排前,同状态按开始时间倒序(新的在上)
    if (a.status === 'running' && b.status !== 'running') return -1
    if (b.status === 'running' && a.status !== 'running') return 1
    return b.startedAtMs - a.startedAtMs
  })
  const runningCount = list.filter(x => x.status === 'running').length

  return (
    <aside className="monitor">
      <div className="monitor-head">
        <span className="monitor-title">执行中</span>
        {runningCount > 0 && <span className="monitor-badge">{runningCount}</span>}
      </div>
      <div className="monitor-list">
        {list.map(item => {
          const elapsed = item.status === 'running'
            ? Date.now() - item.startedAtMs
            : (item.doneAtMs || Date.now()) - item.startedAtMs
          return (
            <div
              key={item.subtaskId}
              className={`mon-item${fading.has(item.subtaskId) ? ' fading' : ''}`}
              data-state={item.status}
              onClick={() => onOpen(item.taskId, item.subtaskId)}
            >
              <div className="mon-row1">
                <span className="mon-dot"></span>
                <span className="mon-name">{item.agentName}</span>
                <span className="mon-spacer"></span>
                <span className="mon-status">
                  {item.status === 'running' ? '执行中' : item.status === 'done' ? '已完成' : '执行失败'}
                </span>
              </div>
              <div className="mon-task" title={item.taskName}>{item.taskName}</div>
              <div className="mon-meter">
                回合 <b>{item.turnCount}</b> · {fmtElapsed(elapsed)}
                {item.currentTool && <><span>·</span><span className="mon-tool">{item.currentTool}</span></>}
              </div>
              {item.status === 'running' && <div className="mon-pulse-bar"></div>}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
```

**注意 tick**:每秒 setState 触发重渲染以让 `Date.now() - startedAtMs` 更新;`tick` 变量本身不用,但 setState 是驱动。

- [ ] **Step 3: 前端类型检查**

Run: `cd web && npx tsc -b`
Expected: 无输出

- [ ] **Step 4: Commit**

```bash
git add web/src/components/MonitorPanel.tsx web/src/components/MonitorPanel.css
git commit -m "feat(monitor): MonitorPanel 组件(状态 Map + 淡出 + 空态收起)"
```

---

## Task 6: ExecutionModal 组件 — 遮罩层放大 + 逐回合轨迹

**Files:**
- Create: `web/src/components/ExecutionModal.tsx`
- Create: `web/src/components/ExecutionModal.css`

**Interfaces:**
- Consumes: `GET /api/task/:taskId` (返回 `TaskDetail` 含 `task.subtasks[]` 和 `turnsBySubtask[subtaskId]`,已有);`fetchJSON`
- Produces:
  - `<ExecutionModal taskId={string} subtaskId={string} onClose={() => void} />`

- [ ] **Step 1: 建 CSS**

新建 `web/src/components/ExecutionModal.css`:

```css
.exm-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 50;
  backdrop-filter: blur(2px);
}
.exm {
  width: min(720px, 92vw); max-height: 84vh;
  background: var(--bg-elevated); border: 1px solid var(--border);
  border-radius: 14px; overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 60px rgba(0,0,0,0.5);
}
.exm-head { display: flex; align-items: center; gap: 10px; padding: 16px 18px; border-bottom: 1px solid var(--border-light); }
.exm-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.exm[data-state="running"] .exm-dot { background: var(--accent); animation: mon-pulse 1.6s infinite; }
.exm[data-state="done"] .exm-dot { background: var(--green); }
.exm[data-state="failed"] .exm-dot { background: var(--red); }
.exm-title { font-size: 15px; font-weight: 600; }
.exm-status { font-size: 11px; font-weight: 500; padding: 1px 7px; border-radius: var(--radius-sm); }
.exm[data-state="running"] .exm-status { color: var(--accent-hover); background: var(--accent-light); }
.exm[data-state="done"] .exm-status { color: var(--green); background: var(--green-bg); }
.exm[data-state="failed"] .exm-status { color: var(--red); background: var(--red-bg); }
.exm-close {
  width: 28px; height: 28px; border-radius: var(--radius-sm); border: none;
  background: transparent; color: var(--text-muted); cursor: pointer; font-size: 18px;
  margin-left: auto;
}
.exm-close:hover { background: var(--bg-hover); color: var(--text); }
.exm-stats { display: flex; gap: 18px; padding: 12px 18px; border-bottom: 1px solid var(--border-light); font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); }
.exm-stats b { color: var(--text); }
.exm-body { flex: 1; overflow-y: auto; padding: 8px 0; }
.exm-error {
  margin: 10px 18px; padding: 10px 12px;
  background: var(--red-bg); color: var(--red);
  border-radius: var(--radius-sm); font-size: 12.5px;
}
.exm-turn { display: grid; grid-template-columns: 40px 1fr; gap: 10px; padding: 9px 18px; align-items: start; }
.exm-turn:hover { background: var(--bg-subtle); }
.exm-turn-idx { font-family: var(--font-mono); font-size: 12px; color: var(--accent); text-align: right; padding-top: 1px; }
.exm-turn-text { font-size: 13.5px; color: var(--text-secondary); line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.exm-empty { padding: 40px; text-align: center; color: var(--text-muted); font-size: 13px; }
.exm-loading { padding: 40px; text-align: center; color: var(--text-muted); font-size: 13px; }
```

- [ ] **Step 2: 建 ExecutionModal.tsx**

新建 `web/src/components/ExecutionModal.tsx`:

```tsx
import { useEffect, useState, useRef } from 'react'
import { fetchJSON } from '../api/client'
import './ExecutionModal.css'

interface SubTaskLite {
  id: string
  name: string
  assignee: string
  status: string
  error?: string
  turnCount?: number
  retryCount?: number
  tokensInput?: number
  tokensOutput?: number
  startedAt?: string
}
interface TurnLite {
  id: string
  subtaskId: string
  turnIndex: number
  text: string
  startedAt: string
  endedAt?: string
}
interface TaskDetail {
  task: { id: string; name: string; status: string; subtasks: SubTaskLite[] }
  turnsBySubtask: Record<string, TurnLite[]>
}

function fmtDuration(startIso?: string, endIso?: string): string {
  if (!startIso) return '—'
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const s = Math.max(0, Math.round((end - start) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export function ExecutionModal({ taskId, subtaskId, onClose }: { taskId: string; subtaskId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const timerRef = useRef<number | null>(null)

  // 拉详情;running 时 2s 轮询
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const d = await fetchJSON<TaskDetail>(`/api/task/${taskId}`)
        if (cancelled) return
        setDetail(d)
        setLoading(false)
        const sub = d.task.subtasks.find(s => s.id === subtaskId)
        const active = sub && !['completed', 'failed', 'cancelled'].includes(sub.status)
        if (active) {
          timerRef.current = window.setTimeout(load, 2000)
        }
      } catch { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true; if (timerRef.current) clearTimeout(timerRef.current) }
  }, [taskId, subtaskId])

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const sub = detail?.task.subtasks.find(s => s.id === subtaskId)
  const turns = detail?.turnsBySubtask[subtaskId] || []
  const uiState = sub?.status === 'running' ? 'running' :
                  sub?.status === 'completed' ? 'done' :
                  sub?.status === 'failed' ? 'failed' : 'done'
  const lastEnd = turns.length ? turns[turns.length - 1].endedAt : undefined
  const elapsed = fmtDuration(sub?.startedAt, uiState === 'running' ? undefined : lastEnd)

  return (
    <div className="exm-mask" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="exm" data-state={uiState}>
        {loading ? (
          <div className="exm-loading">加载中…</div>
        ) : !sub ? (
          <div className="exm-empty">子任务不存在</div>
        ) : (
          <>
            <div className="exm-head">
              <span className="exm-dot"></span>
              <span className="exm-title">{sub.assignee}</span>
              <span className="exm-status">
                {uiState === 'running' ? '执行中' : uiState === 'done' ? '已完成' : '执行失败'}
              </span>
              <button className="exm-close" onClick={onClose}>✕</button>
            </div>
            <div className="exm-stats">
              <span>回合 <b>{sub.turnCount ?? turns.length}</b></span>
              <span>耗时 <b>{elapsed}</b></span>
              {sub.retryCount ? <span>重试 <b>{sub.retryCount}</b></span> : null}
              {(sub.tokensInput || sub.tokensOutput) ? <span>token <b>{sub.tokensInput || 0}/{sub.tokensOutput || 0}</b></span> : null}
            </div>
            {sub.error && <div className="exm-error">{sub.error}</div>}
            <div className="exm-body">
              {turns.length === 0 ? (
                <div className="exm-empty">暂无轨迹记录</div>
              ) : turns.map(t => (
                <div className="exm-turn" key={t.id}>
                  <div className="exm-turn-idx">{String(t.turnIndex).padStart(2, '0')}</div>
                  <div className="exm-turn-text">{t.text}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 前端类型检查**

Run: `cd web && npx tsc -b`
Expected: 无输出

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ExecutionModal.tsx web/src/components/ExecutionModal.css
git commit -m "feat(monitor): ExecutionModal 放大遮罩层(复用 /api/task 轨迹)"
```

---

## Task 7: ChatView 两栏布局 + 集成 MonitorPanel/Modal + 端到端验证

**Files:**
- Modify: `web/src/App.tsx` (ChatView line 52-74)

**Interfaces:**
- Consumes: `MonitorPanel`(Task 5)、`ExecutionModal`(Task 6)
- Produces: 完整的对话页两栏 + 弹层交互

- [ ] **Step 1: 改造 ChatView**

`web/src/App.tsx` 的 `ChatView`(line 52-74)顶部 import 区加:

```typescript
import { MonitorPanel } from './components/MonitorPanel'
import { ExecutionModal } from './components/ExecutionModal'
```

替换 `ChatView` 函数体:

```tsx
function ChatView({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const { messages, isLoading, send, applyLiveEvent } = useChat()
  const { connected, events } = useSSE('/events')
  const processedRef = useRef(0)
  const [modal, setModal] = useState<{ taskId: string; subtaskId: string } | null>(null)

  useEffect(() => {
    for (let i = processedRef.current; i < events.length; i++) {
      applyLiveEvent(events[i])
    }
    processedRef.current = events.length
  }, [events, applyLiveEvent])

  return (
    <div className="h-screen flex flex-col">
      <Header connected={connected} username={user.displayName || user.username} onLogout={onLogout} />
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-hidden min-w-0">
          <ChatPanel messages={messages} isLoading={isLoading} onSend={send} />
        </div>
        <MonitorPanel onOpen={(taskId, subtaskId) => setModal({ taskId, subtaskId })} />
      </div>
      {modal && <ExecutionModal taskId={modal.taskId} subtaskId={modal.subtaskId} onClose={() => setModal(null)} />}
    </div>
  )
}
```

顶部 import `useState` 若未 import 则补:

```typescript
import { useEffect, useState, useRef } from 'react'
```

- [ ] **Step 2: 前端类型检查 + 构建**

Run: `cd web && npx tsc -b && npx vite build`
Expected: 全部无错误,构建成功

- [ ] **Step 3: 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 后端 tsc 无输出;测试全过

- [ ] **Step 4: 端到端浏览器验证**

重启后端 + 前端:
```bash
pkill -f "tsx src/index.ts"; sleep 1
JARVIS_DEBUG=1 npx tsx src/index.ts > /tmp/jarvis-backend.log 2>&1 &
pkill -f "vite"; sleep 1
cd web && npx vite --host > /tmp/jarvis-frontend.log 2>&1 &
```

浏览器验证:
1. 空闲进对话页 → 右侧监控栏**不显示**,对话区占满。
2. 派一个多回合任务(如"帮我调研 X") → 右侧监控栏出现,一项:小弟名 + "执行中" + 回合数递增 + 耗时 + 当前工具 + 脉冲条。
3. 派单期间继续跟 Jarvis 聊别的 → 对话流滚动,监控栏位置固定、内容持续更新。
4. 点监控项 → 遮罩层 modal 弹出,显示逐回合轨迹 + 统计条;running 时 2s 刷新;Esc / 点遮罩关闭。
5. 小弟完成 → 标绿"已完成",~30s 后淡出并从栏中删除;若为最后一项,整栏收起。
6. 派 2 个并行任务 → 监控栏出现 2 项,各自独立更新。

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat(monitor): ChatView 两栏布局 + 集成 MonitorPanel/ExecutionModal"
```

---

## Self-Review 记录

**Spec 覆盖检查**:
- 后端 `subtask` 事件广播(running/done/failed)→ Task 3 ✓
- `onProgress` 扩为结构化对象 → Task 2 ✓
- `buildSubtaskEvent` 纯函数 + 单测 → Task 1 ✓
- 前端 `SubtaskEvent` 类型 + `parseSubtaskEvent` → Task 4 ✓
- MonitorPanel 状态 Map + 空态收起 + 30s 淡出 + 本地耗时 tick + `GET /api/agents` 初始化 → Task 5 ✓
- ExecutionModal 遮罩层 + 逐回合轨迹 + 2s 轮询(running)+ Esc/点遮罩关闭 → Task 6 ✓
- ChatView 两栏布局 + 集成 → Task 7 ✓
- 复用 `GET /api/task/:taskId`,不新建接口 → Task 6 ✓
- 视觉复用全局 token → Task 5/6 CSS ✓
- 不改 broadcast 签名(JSON-in-content 模式)→ Task 3 ✓
- 不改 `jarvis_subtask_turns` 表 → 全程 ✓

**类型一致性**:`SubtaskEventPayload`(Task 1 后端)与 `SubtaskEvent`(Task 4 前端)字段名一致;`MonitorItem`(Task 5)与前端 SubtaskEvent 无缝映射;`ExecutionModal` 用的 `TaskDetail`/`SubTaskLite`/`TurnLite` 与看板 `/api/task/:taskId` 返回结构一致(spec 第 5 节已确认)。

**已知取舍**:
- 对话流锚点(spec 第 5 节可选项)本次未做,派单消息保持现状(纯文本"正在后台执行")。用户想放大只能通过右侧监控栏点击。若后续想让派单消息也可点,再加一个 message.dispatchRef 字段迭代。
- 前端 MonitorPanel 无独立单测(项目 web 目录未见 vitest 配置)。状态归约的正确性靠 Task 7 端到端验证覆盖。
- `handleSubTaskComplete/Failed` 分支里的 `getRecipe` 查询在循环里同步调用,数量小(单批 runnables 通常 ≤5)可接受;若未来批量激增可考虑批量 `getRecipe`。
