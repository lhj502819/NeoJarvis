# 看板重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把看板重做成左侧导航的三页指挥中心（概览/任务/团队），并补齐后端五项执行元信息埋点，支持任务与小弟的执行详情钻取。

**Architecture:** 后端先加数据层（新表 `jarvis_subtask_turns` + `jarvis_subtasks` 五个新列 + 采集埋点 + 详情 API），再重构前端单文件为 `dashboard/` 目录下的多页组件，最后实现详情钻取。全程 TDD，后端每个数据改动配单测。

**Tech Stack:** TypeScript (ESM)、Express、PostgreSQL (pg)、React、Vite、vitest。

## Global Constraints

- ESM 导入路径必须带 `.js` 后缀（如 `import { x } from './y.js'`），即使源文件是 `.ts`。
- 所有时间戳字段用 ISO 字符串（`new Date().toISOString()`），与现有 `created_at`/`updated_at` 一致。
- 新增数据库列必须用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`——现有表已由 `CREATE TABLE IF NOT EXISTS` 建好，改结构不能靠改 CREATE 语句。
- 后端类型检查零报错：`npx tsc --noEmit`；前端：`cd web && npx tsc -b`。
- 现有 24 个单测不得回归：`npx vitest run`。
- 前端复用全局 design token（`web/src/index.css` 的 `--bg`/`--accent`/`--bg-elevated` 等），禁止散落内联样式（收进 `dashboard.css`）。
- 中途沟通对话零后端改动：复用 `bus.getConversation(taskId)`（`src/a2a/bus.ts`）。

---

## File Structure

**后端（修改）：**
- `src/shared/db.ts` — initDb 末尾追加：新表 `jarvis_subtask_turns` 的 CREATE + `jarvis_subtasks` 五列的 ALTER
- `src/shared/types.ts` — `SubTask` 接口加 5 个可选字段 + 新增 `SubTaskTurn` 类型
- `src/task/manager.ts` — `rowToSubTask` 读新字段；新增 `setSubtaskStarted`、`recordTurn`、`finalizeSubtaskMeta`、`getSubtaskTurns`、`getTaskDetail`
- `src/a2a/registry.ts` — `registerRunningTask` 无需改（started_at 由 dispatcher 写库）
- `src/a2a/client.ts` — `dispatchToAgent` 循环里埋点：开工时间、每回合、重试、token/回合数
- `src/jarvis/routes/dashboard.ts` — 新增 `GET /api/task/:taskId` 详情路由

**前端（新建目录，删除旧单文件）：**
```
web/src/pages/dashboard/
├── DashboardPage.tsx        // 外壳：左导航 + state 路由
├── OverviewPage.tsx
├── TasksPage.tsx            // 列表↔详情 state 切换
├── TeamPage.tsx
├── components/
│   ├── StatCard.tsx
│   ├── TaskDetail.tsx
│   ├── AgentProfile.tsx
│   ├── ActivityFeed.tsx     // 从旧文件迁移
│   └── JarvisState.tsx      // 从旧文件迁移
├── types.ts                 // 前端本地类型（Task/SubTask/TaskDetail 等）
└── dashboard.css            // 从旧 DashboardPage.css 迁移+清理
```
- `web/src/App.tsx` — 改 import 路径指向新 `dashboard/DashboardPage`
- 删除：`web/src/pages/DashboardPage.tsx`、`web/src/pages/DashboardPage.css`

---

## Task 1: 后端数据层 — 新表 + 新列 + 类型

**Files:**
- Modify: `src/shared/db.ts` (initDb 末尾，line 192 前的反引号内)
- Modify: `src/shared/types.ts:34-52` (SubTask 接口)
- Test: `tests/unit/subtask-turns.test.ts` (Create)

**Interfaces:**
- Produces:
  - 表 `jarvis_subtask_turns(id TEXT PK, subtask_id TEXT, turn_index INTEGER, text TEXT, started_at TEXT, ended_at TEXT, created_at TEXT)`
  - `jarvis_subtasks` 新列：`started_at TEXT, turn_count INTEGER, retry_count INTEGER, tokens_input INTEGER, tokens_output INTEGER`
  - `interface SubTaskTurn { id: string; subtaskId: string; turnIndex: number; text: string; startedAt: string; endedAt?: string; createdAt: string }`
  - `SubTask` 新增可选字段：`startedAt?: string; turnCount?: number; retryCount?: number; tokensInput?: number; tokensOutput?: number`

- [ ] **Step 1: Write the failing test**

新建 `tests/unit/subtask-turns.test.ts`——验证 initDb 后新表存在、新列可写读。用真实 pg（测试库连本地 jarvis）。

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import pool, { initDb } from '../../src/shared/db.js'

describe('dashboard 数据层 schema', () => {
  beforeAll(async () => { await initDb() })

  it('jarvis_subtask_turns 表存在且可插入', async () => {
    const id = `test-turn-${Date.now()}`
    await pool.query(
      `INSERT INTO jarvis_subtask_turns (id, subtask_id, turn_index, text, started_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, 'st-x', 1, 'hello', new Date().toISOString(), new Date().toISOString()]
    )
    const { rows } = await pool.query('SELECT * FROM jarvis_subtask_turns WHERE id=$1', [id])
    expect(rows[0].text).toBe('hello')
    expect(rows[0].turn_index).toBe(1)
    await pool.query('DELETE FROM jarvis_subtask_turns WHERE id=$1', [id])
  })

  it('jarvis_subtasks 新列存在', async () => {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='jarvis_subtasks' AND column_name IN
      ('started_at','turn_count','retry_count','tokens_input','tokens_output')
    `)
    expect(rows.length).toBe(5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/subtask-turns.test.ts`
Expected: FAIL — 表/列不存在（`relation "jarvis_subtask_turns" does not exist` 或列数 <5）

- [ ] **Step 3: 加建表和加列 SQL**

在 `src/shared/db.ts` 的 initDb 模板字符串末尾（现有 `jarvis_user_mcp_servers` 的 CREATE INDEX 之后、闭合反引号之前）追加：

```sql
-- ═══ 子任务执行回合表（完整轨迹） ═══
CREATE TABLE IF NOT EXISTS jarvis_subtask_turns (
  id TEXT PRIMARY KEY,
  subtask_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_subtask_turns_subtask ON jarvis_subtask_turns(subtask_id, turn_index);

-- ═══ 子任务执行元信息（在已有表上补列） ═══
ALTER TABLE jarvis_subtasks ADD COLUMN IF NOT EXISTS started_at TEXT;
ALTER TABLE jarvis_subtasks ADD COLUMN IF NOT EXISTS turn_count INTEGER;
ALTER TABLE jarvis_subtasks ADD COLUMN IF NOT EXISTS retry_count INTEGER;
ALTER TABLE jarvis_subtasks ADD COLUMN IF NOT EXISTS tokens_input INTEGER;
ALTER TABLE jarvis_subtasks ADD COLUMN IF NOT EXISTS tokens_output INTEGER;
```

- [ ] **Step 4: 扩展 types.ts**

在 `src/shared/types.ts` 的 `SubTask` 接口（line 34-52）末尾 `updatedAt: string` 前追加：

```typescript
  /** 小弟真正开工时刻（排队等待不计入执行耗时） */
  startedAt?: string
  turnCount?: number
  retryCount?: number
  tokensInput?: number
  tokensOutput?: number
```

在同文件 `SubTask` 接口之后新增：

```typescript
export interface SubTaskTurn {
  id: string
  subtaskId: string
  turnIndex: number
  text: string
  startedAt: string
  endedAt?: string
  createdAt: string
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/subtask-turns.test.ts`
Expected: PASS（两个用例都过）

- [ ] **Step 6: 确认全量测试与类型**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 无输出；测试全过（原 24 + 新 2 = 26）

- [ ] **Step 7: Commit**

```bash
git add src/shared/db.ts src/shared/types.ts tests/unit/subtask-turns.test.ts
git commit -m "feat(dashboard): 子任务执行元信息数据层(新表+五列)"
```

---

## Task 2: manager.ts — 元信息读写函数

**Files:**
- Modify: `src/task/manager.ts` (rowToSubTask ~line 5-23；末尾追加新函数)
- Test: `tests/unit/subtask-meta.test.ts` (Create)

**Interfaces:**
- Consumes: Task 1 的表/列/类型
- Produces（供 Task 3 采集、Task 6 详情 API 调用）：
  - `setSubtaskStarted(subtaskId: string, startedAt: string): Promise<void>`
  - `recordTurn(subtaskId: string, turnIndex: number, text: string, startedAt: string, endedAt: string): Promise<void>`
  - `finalizeSubtaskMeta(subtaskId: string, meta: { turnCount: number; retryCount: number; tokensInput: number; tokensOutput: number }): Promise<void>`
  - `getSubtaskTurns(subtaskId: string): Promise<SubTaskTurn[]>`
  - `rowToSubTask` 返回值含新字段

- [ ] **Step 1: Write the failing test**

新建 `tests/unit/subtask-meta.test.ts`：

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import pool, { initDb } from '../../src/shared/db.js'
import { setSubtaskStarted, recordTurn, finalizeSubtaskMeta, getSubtaskTurns } from '../../src/task/manager.js'

const TASK = `t-meta-${Date.now()}`
const SUB = `s-meta-${Date.now()}`
const USER = 'test-user'

describe('subtask 元信息读写', () => {
  beforeAll(async () => {
    await initDb()
    const now = new Date().toISOString()
    await pool.query(`INSERT INTO jarvis_tasks (id,user_id,name,description,status,created_at,updated_at) VALUES ($1,$2,'t','d','executing',$3,$3)`, [TASK, USER, now])
    await pool.query(`INSERT INTO jarvis_subtasks (id,task_id,user_id,name,description,assignee,status,created_at,updated_at) VALUES ($1,$2,$3,'n','d','general','running',$4,$4)`, [SUB, TASK, USER, now])
  })

  it('setSubtaskStarted 写入开工时间', async () => {
    const ts = new Date().toISOString()
    await setSubtaskStarted(SUB, ts)
    const { rows } = await pool.query('SELECT started_at FROM jarvis_subtasks WHERE id=$1', [SUB])
    expect(rows[0].started_at).toBe(ts)
  })

  it('recordTurn + getSubtaskTurns 按 turnIndex 顺序', async () => {
    const t0 = new Date().toISOString()
    await recordTurn(SUB, 1, '第一回合', t0, t0)
    await recordTurn(SUB, 2, '第二回合', t0, t0)
    const turns = await getSubtaskTurns(SUB)
    expect(turns.length).toBe(2)
    expect(turns[0].turnIndex).toBe(1)
    expect(turns[1].text).toBe('第二回合')
  })

  it('finalizeSubtaskMeta 写入统计', async () => {
    await finalizeSubtaskMeta(SUB, { turnCount: 5, retryCount: 1, tokensInput: 100, tokensOutput: 200 })
    const { rows } = await pool.query('SELECT turn_count,retry_count,tokens_input,tokens_output FROM jarvis_subtasks WHERE id=$1', [SUB])
    expect(rows[0].turn_count).toBe(5)
    expect(rows[0].retry_count).toBe(1)
    expect(rows[0].tokens_input).toBe(100)
    expect(rows[0].tokens_output).toBe(200)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/subtask-meta.test.ts`
Expected: FAIL — `setSubtaskStarted is not a function`（未导出）

- [ ] **Step 3: 扩展 rowToSubTask**

在 `src/task/manager.ts` 的 `rowToSubTask`（line 5-23），在 `updatedAt: row.updated_at,` 后追加：

```typescript
    startedAt: row.started_at || undefined,
    turnCount: row.turn_count ?? undefined,
    retryCount: row.retry_count ?? undefined,
    tokensInput: row.tokens_input ?? undefined,
    tokensOutput: row.tokens_output ?? undefined,
```

同时在文件顶部 import 补上 `SubTaskTurn`：

```typescript
import type { Task, SubTask, SubTaskTurn, TaskStatus, SubTaskStatus } from '../shared/types.js'
```

- [ ] **Step 4: 追加新函数**

在 `src/task/manager.ts` 末尾追加：

```typescript
export async function setSubtaskStarted(subtaskId: string, startedAt: string): Promise<void> {
  await pool.query('UPDATE jarvis_subtasks SET started_at = $1 WHERE id = $2', [startedAt, subtaskId])
}

export async function recordTurn(subtaskId: string, turnIndex: number, text: string, startedAt: string, endedAt: string): Promise<void> {
  const id = randomUUID().slice(0, 12)
  await pool.query(
    `INSERT INTO jarvis_subtask_turns (id, subtask_id, turn_index, text, started_at, ended_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, subtaskId, turnIndex, text, startedAt, endedAt, new Date().toISOString()]
  )
}

export async function finalizeSubtaskMeta(subtaskId: string, meta: { turnCount: number; retryCount: number; tokensInput: number; tokensOutput: number }): Promise<void> {
  await pool.query(
    `UPDATE jarvis_subtasks SET turn_count = $1, retry_count = $2, tokens_input = $3, tokens_output = $4 WHERE id = $5`,
    [meta.turnCount, meta.retryCount, meta.tokensInput, meta.tokensOutput, subtaskId]
  )
}

export async function getSubtaskTurns(subtaskId: string): Promise<SubTaskTurn[]> {
  const { rows } = await pool.query('SELECT * FROM jarvis_subtask_turns WHERE subtask_id = $1 ORDER BY turn_index ASC', [subtaskId])
  return rows.map(r => ({
    id: r.id,
    subtaskId: r.subtask_id,
    turnIndex: r.turn_index,
    text: r.text,
    startedAt: r.started_at,
    endedAt: r.ended_at || undefined,
    createdAt: r.created_at,
  }))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/subtask-meta.test.ts`
Expected: PASS（3 用例）

- [ ] **Step 6: 类型与全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 无输出；全过

- [ ] **Step 7: Commit**

```bash
git add src/task/manager.ts tests/unit/subtask-meta.test.ts
git commit -m "feat(dashboard): subtask 元信息读写函数"
```

---

## Task 3: client.ts — 执行循环埋点采集

**Files:**
- Modify: `src/a2a/client.ts` (dispatchToAgent，line 156-248 的循环)
- Test: 无独立单测（依赖真实 LLM，放到 Task 8 端到端验证）

**Interfaces:**
- Consumes: Task 2 的 `setSubtaskStarted`/`recordTurn`/`finalizeSubtaskMeta`
- Produces: 每次派单执行后，`jarvis_subtasks` 的 started_at/turn_count/retry_count/tokens_*、`jarvis_subtask_turns` 的逐回合记录都落库

- [ ] **Step 1: 补 import**

`src/a2a/client.ts` 顶部（line 5 `recordAgentSession` 那行附近）改为：

```typescript
import { recordAgentSession } from './history.js'
import { setSubtaskStarted, recordTurn, finalizeSubtaskMeta } from '../task/manager.js'
```

- [ ] **Step 2: 开工时间戳 + 累计变量**

在 `for (let attempt...` 循环**之前**（line 155 附近，`let sessionId = ''` 之后）加：

```typescript
  // 开工时刻（排队等待不计入执行耗时）——只在首次真正开跑时记一次
  await setSubtaskStarted(subtaskId, new Date().toISOString())
  let totalTurns = 0
  let tokensInput = 0
  let tokensOutput = 0
```

- [ ] **Step 3: 每回合落库**

在 line 201 的 `if (message.type === 'assistant' && message.message?.content) {` 块内，`turnCount++` 之后加起始时间，块末尾（`if (context?.onProgress)` 之后、`}` 之前）落库：

```typescript
        if (message.type === 'assistant' && message.message?.content) {
          const turnStart = new Date().toISOString()
          turnCount++
          totalTurns++
          let turnText = ''

          for (const block of message.message.content) {
            if ('text' in block && block.text) {
              result += block.text
              turnText += block.text
              const snippet = block.text.slice(0, 60).replace(/\n/g, ' ')
              progressLog.push(`[${turnCount}] ${snippet}`)
            }
            if ('type' in block && block.type === 'tool_use') {
              const toolName = (block as any).name || 'tool'
              turnText += `\n🔧 ${toolName}`
              progressLog.push(`[${turnCount}] 🔧 ${toolName}`)
            }
          }

          // 落一条回合轨迹（text 空则记工具/占位，避免 NOT NULL 违规）
          recordTurn(subtaskId, totalTurns, turnText || '(无文本输出)', turnStart, new Date().toISOString()).catch(() => {})

          if (context?.onProgress) {
            const recent = progressLog.slice(-5).join('\n')
            context.onProgress(`回合 ${turnCount} | 已执行 ${progressLog.length} 步\n${recent}`)
          }
        }
```

- [ ] **Step 4: token 采集**

在 line 224 的 `if (message.type === 'result') {` 块内，`sessionId = ...` 之后加：

```typescript
        if (message.type === 'result') {
          sessionId = (message as any).session_id || (message as any).sessionId || ''
          const usage = (message as any).usage
          if (usage) {
            tokensInput += usage.input_tokens || 0
            tokensOutput += usage.output_tokens || 0
          }
          // ...（原 success/error 分支不变）
```

- [ ] **Step 5: 完成时写统计**

在循环结束后、`recordAgentSession` 调用（line 252）**之前**加。`attempt` 是重试计数（0 表示没重试），循环结束时它的值即重试次数：

```typescript
  // 写入执行元信息统计（retry_count = 实际重试次数）
  await finalizeSubtaskMeta(subtaskId, {
    turnCount: totalTurns,
    retryCount: Math.max(0, attempt - (apiError ? 0 : 0)),  // 见下方说明
    tokensInput,
    tokensOutput,
  }).catch(() => {})
```

注意：`attempt` 在 for 循环结束后等于「最后一次尝试的下标」。成功 break 时 attempt=实际重试次数（0=一次成功）。为拿到准确值，把重试计数提到循环外：在 Step 2 的累计变量处加 `let retriesUsed = 0`，在 line 159 的 `if (attempt > 0)` 块内加 `retriesUsed = attempt`，此处 `retryCount: retriesUsed`。

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 7: Commit**

```bash
git add src/a2a/client.ts
git commit -m "feat(dashboard): 派单执行循环埋点(开工/回合/token/重试)"
```

---

## Task 4: 详情 API — GET /api/task/:taskId

**Files:**
- Modify: `src/task/manager.ts` (末尾加 `getTaskDetail`)
- Modify: `src/jarvis/routes/dashboard.ts` (加路由 + import)
- Test: `tests/unit/task-detail.test.ts` (Create)

**Interfaces:**
- Consumes: Task 2 的 `getSubtaskTurns`、现有 `getTask`、`bus.getConversation`
- Produces:
  - `getTaskDetail(userId: string, taskId: string): Promise<TaskDetail | undefined>`
  - `interface TaskDetail { task: Task; turnsBySubtask: Record<string, SubTaskTurn[]>; conversation: ConversationLog | undefined }`（在 `src/shared/types.ts` 定义，前端 Task 9 复制同构类型）
  - HTTP: `GET /api/task/:taskId` → `TaskDetail` JSON，404 若任务不存在

- [ ] **Step 1: Write the failing test**

新建 `tests/unit/task-detail.test.ts`：

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import pool, { initDb } from '../../src/shared/db.js'
import { getTaskDetail } from '../../src/task/manager.js'

const TASK = `t-detail-${Date.now()}`
const SUB = `s-detail-${Date.now()}`
const USER = 'test-user'

describe('getTaskDetail', () => {
  beforeAll(async () => {
    await initDb()
    const now = new Date().toISOString()
    await pool.query(`INSERT INTO jarvis_tasks (id,user_id,name,description,status,created_at,updated_at) VALUES ($1,$2,'详情任务','d','completed',$3,$3)`, [TASK, USER, now])
    await pool.query(`INSERT INTO jarvis_subtasks (id,task_id,user_id,name,description,assignee,status,created_at,updated_at) VALUES ($1,$2,$3,'子','d','general','completed',$4,$4)`, [SUB, TASK, USER, now])
    await pool.query(`INSERT INTO jarvis_subtask_turns (id,subtask_id,turn_index,text,started_at,created_at) VALUES ($1,$2,1,'回合1',$3,$3)`, [`tn-${Date.now()}`, SUB, now])
  })

  it('返回任务 + 子任务轨迹', async () => {
    const detail = await getTaskDetail(USER, TASK)
    expect(detail).toBeDefined()
    expect(detail!.task.name).toBe('详情任务')
    expect(detail!.turnsBySubtask[SUB].length).toBe(1)
    expect(detail!.turnsBySubtask[SUB][0].text).toBe('回合1')
  })

  it('不存在的任务返回 undefined', async () => {
    const detail = await getTaskDetail(USER, 'nonexistent')
    expect(detail).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/task-detail.test.ts`
Expected: FAIL — `getTaskDetail is not a function`

- [ ] **Step 3: types.ts 加 TaskDetail**

`src/shared/types.ts` 的 `SubTaskTurn` 之后追加（注意 `ConversationLog` 从 bus 引入，这里用结构化定义避免循环依赖）：

```typescript
export interface TaskDetail {
  task: Task
  turnsBySubtask: Record<string, SubTaskTurn[]>
  conversation: {
    contextId: string
    participants: string[]
    messages: Array<{ id: string; from: string; to: string; role: string; parts: Array<{ kind: string; text?: string }>; timestamp: string }>
  } | null
}
```

- [ ] **Step 4: manager.ts 加 getTaskDetail**

`src/task/manager.ts` 顶部 import 加 `TaskDetail`，并 import bus：

```typescript
import type { Task, SubTask, SubTaskTurn, TaskDetail, TaskStatus, SubTaskStatus } from '../shared/types.js'
import { bus } from '../a2a/bus.js'
```

末尾追加：

```typescript
export async function getTaskDetail(userId: string, taskId: string): Promise<TaskDetail | undefined> {
  const task = await getTask(userId, taskId)
  if (!task) return undefined

  const turnsBySubtask: Record<string, SubTaskTurn[]> = {}
  for (const st of task.subtasks) {
    turnsBySubtask[st.id] = await getSubtaskTurns(st.id)
  }

  const conv = await bus.getConversation(taskId)
  const conversation = conv ? {
    contextId: conv.contextId,
    participants: conv.participants,
    messages: conv.messages.map(m => ({
      id: m.id, from: m.from, to: m.to, role: m.role,
      parts: m.parts.map(p => ({ kind: p.kind, text: p.text })),
      timestamp: m.timestamp,
    })),
  } : null

  return { task, turnsBySubtask, conversation }
}
```

- [ ] **Step 5: dashboard.ts 加路由**

`src/jarvis/routes/dashboard.ts` 顶部 import 改为：

```typescript
import { getTaskSummary, listTasks, getTaskDetail } from '../../task/manager.js'
```

在 `router.get('/tasks', ...)` 之后加：

```typescript
  router.get('/api/task/:taskId', async (req, res) => {
    const detail = await getTaskDetail(req.userId!, req.params.taskId)
    if (!detail) { res.status(404).json({ error: '任务不存在' }); return }
    res.json(detail)
  })
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/task-detail.test.ts`
Expected: PASS（2 用例）

- [ ] **Step 7: 类型 + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 无输出；全过

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/task/manager.ts src/jarvis/routes/dashboard.ts tests/unit/task-detail.test.ts
git commit -m "feat(dashboard): 任务详情 API (GET /api/task/:taskId)"
```

---

## Task 5: 前端脚手架 — dashboard 目录 + 类型 + CSS 迁移

**Files:**
- Create: `web/src/pages/dashboard/types.ts`
- Create: `web/src/pages/dashboard/dashboard.css` (从旧 `DashboardPage.css` 复制)
- Create: `web/src/pages/dashboard/DashboardPage.tsx` (最小外壳)
- Modify: `web/src/App.tsx:5` (import 路径)

**Interfaces:**
- Produces:
  - 前端类型 `Task`/`SubTask`/`RunningAgent`/`Recipe`/`AgentSession`/`JarvisState`/`SubTaskTurn`/`TaskDetail`（从旧文件 line 8-67 迁移 + 补详情类型）
  - `DashboardPage({ user, onLogout }: { user: AuthUser; onLogout: () => void })` 组件（导航壳）
  - `type DashView = 'overview' | 'tasks' | 'team'`

- [ ] **Step 1: 复制 CSS**

```bash
cp web/src/pages/DashboardPage.css web/src/pages/dashboard/dashboard.css
```
（Task 5-8 逐步清理内联样式时往这里加类。先原样复制保证不丢样式。）

- [ ] **Step 2: 建前端类型文件**

新建 `web/src/pages/dashboard/types.ts`（迁移旧文件 line 8-67 的 interface + 补 SubTaskTurn/TaskDetail）：

```typescript
export interface SubTask {
  id: string
  name: string
  assignee: string
  domain?: string
  status: string
  progress?: string
  result?: string
  startedAt?: string
  turnCount?: number
  retryCount?: number
  tokensInput?: number
  tokensOutput?: number
}

export interface Task {
  id: string
  name: string
  description: string
  status: string
  subtasks: SubTask[]
  result?: string
  createdAt: string
  updatedAt: string
}

export interface RunningAgent {
  taskId: string
  subtaskId: string
  name: string
  recipeId: string
  description: string
  startedAt: number
  url?: string
}

export interface Recipe {
  id: string
  name: string
  description: string
  persistent: boolean
  usageCount: number
  createdBy: string
  lastUsedAt: string
}

export interface AgentSession {
  sessionId: string
  recipeId: string
  domain: string
  topics: string[]
  lastTaskDescription: string
  completedAt: string
  taskCount: number
}

export interface JarvisState {
  mood: number
  energy: number
  confidence: number
  familiarity: number
  trustLevel: number
  tasksCompletedToday: number
  messagesHandledToday: number
}

export interface SubTaskTurn {
  id: string
  subtaskId: string
  turnIndex: number
  text: string
  startedAt: string
  endedAt?: string
  createdAt: string
}

export interface TaskDetail {
  task: Task
  turnsBySubtask: Record<string, SubTaskTurn[]>
  conversation: {
    contextId: string
    participants: string[]
    messages: Array<{ id: string; from: string; to: string; role: string; parts: Array<{ kind: string; text?: string }>; timestamp: string }>
  } | null
}

export type DashView = 'overview' | 'tasks' | 'team'
```

- [ ] **Step 3: 建最小外壳 DashboardPage**

新建 `web/src/pages/dashboard/DashboardPage.tsx`（先只放导航壳 + 空占位，后续 Task 填充页面）：

```tsx
import { useState } from 'react'
import type { AuthUser } from '../../api/auth'
import { useSSE } from '../../api/hooks'
import { Header } from '../../components/Header'
import type { DashView } from './types'
import './dashboard.css'

const NAV: Array<{ id: DashView; icon: string; label: string }> = [
  { id: 'overview', icon: '📊', label: '概览' },
  { id: 'tasks', icon: '📋', label: '任务' },
  { id: 'team', icon: '👥', label: '团队' },
]

export function DashboardPage({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [view, setView] = useState<DashView>('overview')
  const { connected } = useSSE('/events')

  return (
    <div className="dash-app">
      <Header connected={connected} username={user.displayName || user.username} onLogout={onLogout} />
      <div className="dash-body dash-body-nav">
        <nav className="dash-nav">
          {NAV.map(n => (
            <button
              key={n.id}
              className={`dash-nav-item ${view === n.id ? 'active' : ''}`}
              onClick={() => setView(n.id)}
            >
              <span className="dash-nav-icon">{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <main className="dash-content">
          {view === 'overview' && <div className="dash-section-title">概览（待实现）</div>}
          {view === 'tasks' && <div className="dash-section-title">任务（待实现）</div>}
          {view === 'team' && <div className="dash-section-title">团队（待实现）</div>}
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 加导航布局 CSS**

在 `web/src/pages/dashboard/dashboard.css` 末尾追加：

```css
.dash-body-nav { display: flex; gap: 0; height: calc(100vh - 56px); }
.dash-nav {
  width: 160px; flex-shrink: 0; background: var(--bg-elevated);
  border-right: 1px solid var(--border); padding: 12px 8px;
  display: flex; flex-direction: column; gap: 4px;
}
.dash-nav-item {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  border: none; background: transparent; color: var(--text-secondary);
  border-radius: 8px; cursor: pointer; font-size: 14px; text-align: left;
  transition: background 0.15s, color 0.15s;
}
.dash-nav-item:hover { background: var(--bg-hover); color: var(--text); }
.dash-nav-item.active { background: var(--accent-light); color: var(--accent); }
.dash-nav-icon { font-size: 16px; }
.dash-content { flex: 1; overflow-y: auto; padding: 24px 28px; }
```

- [ ] **Step 5: 改 App.tsx import**

`web/src/App.tsx` line 5：

```tsx
import { DashboardPage } from './pages/dashboard/DashboardPage'
```

- [ ] **Step 6: 类型检查 + 启前端看导航壳**

Run: `cd web && npx tsc -b`
Expected: 无输出。前端 dev server（5180）应已 HMR，浏览器打开 `#/dashboard` 看到左侧三项导航可切换，内容区显示占位文字。

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/dashboard/ web/src/App.tsx
git commit -m "feat(dashboard): 前端脚手架(导航壳+类型+CSS迁移)"
```

---

## Task 6: 概览页 OverviewPage

**Files:**
- Create: `web/src/pages/dashboard/OverviewPage.tsx`
- Create: `web/src/pages/dashboard/components/StatCard.tsx`
- Create: `web/src/pages/dashboard/components/JarvisState.tsx` (迁移旧 line 361-379)
- Create: `web/src/pages/dashboard/components/ActivityFeed.tsx` (迁移旧 line 381-418)
- Modify: `web/src/pages/dashboard/DashboardPage.tsx` (接入 OverviewPage)
- Modify: `web/src/pages/dashboard/dashboard.css` (stat-card 样式)

**Interfaces:**
- Consumes: `usePolling`/`useSSE`（`web/src/api/hooks`）、Task 5 类型
- Produces:
  - `OverviewPage()` 组件
  - `StatCard({ label, value }: { label: string; value: string | number })`
  - `JarvisStateCard({ state }: { state: JarvisState | null })`
  - `ActivityFeed({ events }: { events: SSEEvent[] })`

- [ ] **Step 1: StatCard 组件**

新建 `web/src/pages/dashboard/components/StatCard.tsx`：

```tsx
export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="dash-stat-card">
      <div className="dash-stat-card-value">{value}</div>
      <div className="dash-stat-card-label">{label}</div>
    </div>
  )
}
```

- [ ] **Step 2: 迁移 JarvisState 与 ActivityFeed**

新建 `web/src/pages/dashboard/components/JarvisState.tsx`——从旧 `DashboardPage.tsx` line 348-379 复制 `StatBar` + `JarvisStateCard` 两个函数，改为 `export function`，无逻辑改动。

新建 `web/src/pages/dashboard/components/ActivityFeed.tsx`——从旧 line 381-418 复制 `ActivityFeed`，改 `export function`，顶部加 `import type { SSEEvent } from '../../../api/hooks'`。

- [ ] **Step 3: OverviewPage**

新建 `web/src/pages/dashboard/OverviewPage.tsx`：

```tsx
import { usePolling, useSSE } from '../../api/hooks'
import type { Task, RunningAgent, Recipe, JarvisState } from './types'
import { StatCard } from './components/StatCard'
import { JarvisStateCard } from './components/JarvisState'
import { ActivityFeed } from './components/ActivityFeed'

export function OverviewPage() {
  const tasksData = usePolling<{ summary: string; tasks: Task[] }>('/tasks', 3000)
  const agentsData = usePolling<RunningAgent[]>('/api/agents', 3000)
  const recipesData = usePolling<Recipe[]>('/api/recipes', 10000)
  const stateData = usePolling<JarvisState>('/api/state', 3000)
  const { events } = useSSE('/events')

  const tasks = tasksData?.tasks || []
  const running = tasks.filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
  const doneToday = stateData?.tasksCompletedToday ?? 0

  return (
    <div>
      <div className="dash-section-title">概览</div>
      <div className="dash-stat-row-cards">
        <StatCard label="进行中任务" value={running.length} />
        <StatCard label="今日完成" value={doneToday} />
        <StatCard label="团队成员" value={recipesData?.length ?? 0} />
        <StatCard label="在跑小弟" value={agentsData?.length ?? 0} />
      </div>
      <div className="dash-overview-grid">
        <div><JarvisStateCard state={stateData ?? null} /></div>
        <div><ActivityFeed events={events} /></div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 接入 DashboardPage**

`web/src/pages/dashboard/DashboardPage.tsx` 顶部 import 加 `import { OverviewPage } from './OverviewPage'`，把 `{view === 'overview' && ...}` 那行替换为 `{view === 'overview' && <OverviewPage />}`。

- [ ] **Step 5: 样式**

`dashboard.css` 末尾追加：

```css
.dash-stat-row-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
.dash-stat-card {
  background: var(--bg-elevated); border: 1px solid var(--border);
  border-radius: 10px; padding: 16px; text-align: center;
}
.dash-stat-card-value { font-size: 26px; font-weight: 600; color: var(--accent); }
.dash-stat-card-label { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
.dash-overview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
```

- [ ] **Step 6: 类型检查 + 浏览器验证**

Run: `cd web && npx tsc -b`
Expected: 无输出。浏览器 `#/dashboard` 概览页：4 个统计卡片数字正确、Jarvis 状态条、实时动态。

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/dashboard/
git commit -m "feat(dashboard): 概览页(统计卡+状态+动态)"
```

---

## Task 7: 团队页 TeamPage + 小弟档案

**Files:**
- Create: `web/src/pages/dashboard/TeamPage.tsx`
- Create: `web/src/pages/dashboard/components/AgentProfile.tsx`
- Modify: `web/src/pages/dashboard/DashboardPage.tsx`
- Modify: `web/src/pages/dashboard/dashboard.css`

**Interfaces:**
- Consumes: `/api/recipes`、`/api/history`（`usePolling`）、Task 5 类型
- Produces:
  - `TeamPage()` — 列表↔档案 state 切换
  - `AgentProfile({ recipe, sessions, onBack }: { recipe: Recipe; sessions: AgentSession[]; onBack: () => void })`

- [ ] **Step 1: AgentProfile 组件**

新建 `web/src/pages/dashboard/components/AgentProfile.tsx`：

```tsx
import type { Recipe, AgentSession } from '../types'

export function AgentProfile({ recipe, sessions, onBack }: { recipe: Recipe; sessions: AgentSession[]; onBack: () => void }) {
  const mine = sessions.filter(s => s.recipeId === recipe.id || s.recipeId === recipe.name)
  return (
    <div>
      <button className="dash-back-btn" onClick={onBack}>← 返回团队</button>
      <div className="dash-section-title">{recipe.name}</div>
      <div className="dash-card">
        <div className="dash-agent-task">{recipe.description}</div>
        <div className="dash-profile-meta">
          <span>{recipe.createdBy === 'builtin' ? '内置' : '沉淀专家'}</span>
          <span>已执行 {recipe.usageCount} 次</span>
          <span>{recipe.lastUsedAt ? `最后: ${recipe.lastUsedAt.slice(0, 10)}` : '未使用'}</span>
        </div>
      </div>
      <div className="dash-section-title" style={{ marginTop: 16 }}>执行过的任务 ({mine.length})</div>
      {mine.length > 0 ? mine.map(s => (
        <div className="dash-card" key={s.sessionId}>
          <div className="dash-agent-task">{s.lastTaskDescription.slice(0, 100)}</div>
          <div className="dash-profile-meta">
            <span>领域: {s.domain || '—'}</span>
            <span>{s.taskCount} 次</span>
          </div>
        </div>
      )) : <div className="dash-empty-hint">暂无执行记录</div>}
    </div>
  )
}
```

- [ ] **Step 2: TeamPage**

新建 `web/src/pages/dashboard/TeamPage.tsx`：

```tsx
import { useState } from 'react'
import { usePolling } from '../../api/hooks'
import type { Recipe, AgentSession } from './types'
import { AgentProfile } from './components/AgentProfile'

export function TeamPage() {
  const recipes = usePolling<Recipe[]>('/api/recipes', 10000)
  const history = usePolling<AgentSession[]>('/api/history', 10000)
  const [selected, setSelected] = useState<Recipe | null>(null)

  if (selected) {
    return <AgentProfile recipe={selected} sessions={history || []} onBack={() => setSelected(null)} />
  }

  return (
    <div>
      <div className="dash-section-title">团队 ({recipes?.length ?? 0})</div>
      {recipes && recipes.length > 0 ? (
        <div className="dash-team-grid">
          {recipes.map(r => (
            <div className="dash-card dash-clickable" key={r.id} onClick={() => setSelected(r)}>
              <div className="dash-team-card-head">
                <span className="dash-agent-name">{r.name}</span>
                <span className="dash-badge">{r.createdBy === 'builtin' ? '内置' : '沉淀'}</span>
              </div>
              <div className="dash-agent-task">{r.description}</div>
              <div className="dash-profile-meta"><span>已执行 {r.usageCount} 次</span></div>
            </div>
          ))}
        </div>
      ) : <div className="dash-empty-hint">暂无团队成员</div>}
    </div>
  )
}
```

- [ ] **Step 3: 接入 DashboardPage**

加 `import { TeamPage } from './TeamPage'`，替换 `{view === 'team' && ...}` 为 `{view === 'team' && <TeamPage />}`。

- [ ] **Step 4: 样式**

`dashboard.css` 末尾追加：

```css
.dash-team-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.dash-clickable { cursor: pointer; transition: border-color 0.15s; }
.dash-clickable:hover { border-color: var(--accent); }
.dash-team-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.dash-profile-meta { display: flex; gap: 14px; font-size: 11px; color: var(--text-muted); margin-top: 6px; }
.dash-back-btn { background: transparent; border: none; color: var(--accent); cursor: pointer; font-size: 13px; margin-bottom: 10px; padding: 0; }
.dash-empty-hint { font-size: 13px; color: var(--text-muted); padding: 12px 0; }
```

- [ ] **Step 5: 类型检查 + 浏览器验证**

Run: `cd web && npx tsc -b`
Expected: 无输出。团队页显示小弟卡片网格，点某个 → 档案页（描述、次数、执行过的任务），点返回回列表。

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/dashboard/
git commit -m "feat(dashboard): 团队页+小弟档案"
```

---

## Task 8: 任务页 TasksPage（列表）

**Files:**
- Create: `web/src/pages/dashboard/TasksPage.tsx`
- Modify: `web/src/pages/dashboard/DashboardPage.tsx`
- Modify: `web/src/pages/dashboard/dashboard.css`

**Interfaces:**
- Consumes: `/tasks`（usePolling）、Task 5 类型
- Produces:
  - `TasksPage()` — 列表↔详情 state 切换（详情组件 Task 9 实现，本任务先留占位 `selectedTaskId` state + 回调）
  - 列表项点击 → `setSelectedTaskId(task.id)`

- [ ] **Step 1: TasksPage（列表 + 详情占位）**

新建 `web/src/pages/dashboard/TasksPage.tsx`：

```tsx
import { useState } from 'react'
import { usePolling } from '../../api/hooks'
import type { Task } from './types'

function TaskRow({ task, onClick }: { task: Task; onClick: () => void }) {
  const done = ['completed', 'failed', 'cancelled'].includes(task.status)
  return (
    <div className="dash-card dash-clickable dash-task-row" onClick={onClick}>
      <div className="dash-task-row-main">
        <span className="dash-task-name">{task.name}</span>
        <span className={`dash-badge dash-badge-${task.status}`}>{task.status}</span>
      </div>
      <div className="dash-task-desc">{task.description}</div>
      <div className="dash-task-row-foot">
        <span>{task.subtasks.length} 子任务</span>
        <span className="dash-task-id-mono">{task.id}</span>
      </div>
    </div>
  )
}

export function TasksPage() {
  const tasksData = usePolling<{ summary: string; tasks: Task[] }>('/tasks', 3000)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const tasks = tasksData?.tasks || []

  if (selectedTaskId) {
    // Task 9 会替换成 <TaskDetail taskId={selectedTaskId} onBack={...} />
    return (
      <div>
        <button className="dash-back-btn" onClick={() => setSelectedTaskId(null)}>← 返回任务</button>
        <div className="dash-section-title">任务详情（待 Task 9 实现）: {selectedTaskId}</div>
      </div>
    )
  }

  const active = tasks.filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
  const done = tasks.filter(t => ['completed', 'failed', 'cancelled'].includes(t.status))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  return (
    <div>
      {active.length > 0 && (
        <>
          <div className="dash-section-title">进行中 ({active.length})</div>
          {active.map(t => <TaskRow key={t.id} task={t} onClick={() => setSelectedTaskId(t.id)} />)}
        </>
      )}
      <div className="dash-section-title" style={{ marginTop: active.length ? 20 : 0 }}>历史任务 ({done.length})</div>
      {done.length > 0
        ? done.slice(0, 30).map(t => <TaskRow key={t.id} task={t} onClick={() => setSelectedTaskId(t.id)} />)
        : <div className="dash-empty-hint">暂无</div>}
    </div>
  )
}
```

- [ ] **Step 2: 接入 DashboardPage**

加 `import { TasksPage } from './TasksPage'`，替换 `{view === 'tasks' && ...}` 为 `{view === 'tasks' && <TasksPage />}`。

- [ ] **Step 3: 样式**

`dashboard.css` 末尾追加：

```css
.dash-task-row-main { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.dash-task-row-foot { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin-top: 8px; }
.dash-task-id-mono { font-family: var(--font-mono, monospace); }
```

- [ ] **Step 4: 类型检查 + 浏览器验证**

Run: `cd web && npx tsc -b`
Expected: 无输出。任务页显示进行中/历史列表，点任意任务进占位详情页，点返回回列表。

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/dashboard/
git commit -m "feat(dashboard): 任务页列表(进行中+历史)"
```

---

## Task 9: 任务详情组件 TaskDetail（核心钻取）

**Files:**
- Create: `web/src/pages/dashboard/components/TaskDetail.tsx`
- Modify: `web/src/pages/dashboard/TasksPage.tsx` (接入)
- Modify: `web/src/pages/dashboard/dashboard.css`

**Interfaces:**
- Consumes: `GET /api/task/:taskId`（Task 4）、`fetchJSON`（`web/src/api/client`）、Task 5 的 `TaskDetail`/`SubTaskTurn` 类型
- Produces:
  - `TaskDetail({ taskId, onBack }: { taskId: string; onBack: () => void })` 组件——元信息卡片 + 子任务执行树（可展开轨迹）+ 中途沟通 + 产物

- [ ] **Step 1: 详情组件**

新建 `web/src/pages/dashboard/components/TaskDetail.tsx`。用 useEffect 拉详情，进行中任务 2s 轮询、完成的不轮询：

```tsx
import { useState, useEffect, useRef } from 'react'
import { fetchJSON } from '../../../api/client'
import type { TaskDetail as TaskDetailData, SubTaskTurn } from '../types'

function fmtDuration(startIso?: string, endIso?: string): string {
  if (!startIso) return '—'
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const s = Math.round((end - start) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function SubtaskTree({ subtask, turns }: { subtask: TaskDetailData['task']['subtasks'][number]; turns: SubTaskTurn[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="dash-card dash-subtask-tree">
      <div className="dash-subtask-tree-head" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'} {subtask.name} · <span className="dash-accent-text">{subtask.assignee}</span></span>
        <span className={`dash-badge dash-badge-${subtask.status}`}>{subtask.status}</span>
      </div>
      <div className="dash-subtask-tree-meta">
        执行 {subtask.turnCount ?? turns.length} 回合 · 耗时 {fmtDuration(subtask.startedAt, subtask.status === 'running' ? undefined : subtask.startedAt && turns.length ? turns[turns.length-1].endedAt : undefined)}
        {subtask.retryCount ? ` · 重试 ${subtask.retryCount} 次` : ''}
        {(subtask.tokensInput || subtask.tokensOutput) ? ` · token ${(subtask.tokensInput||0)}/${(subtask.tokensOutput||0)}` : ''}
      </div>
      {open && (
        <div className="dash-turns">
          {turns.length > 0 ? turns.map(t => (
            <div className="dash-turn" key={t.id}>
              <span className="dash-turn-idx">[{t.turnIndex}]</span>
              <span className="dash-turn-text">{t.text.slice(0, 200)}</span>
            </div>
          )) : <div className="dash-empty-hint">无轨迹记录</div>}
        </div>
      )}
    </div>
  )
}

export function TaskDetail({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<TaskDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const d = await fetchJSON<TaskDetailData>(`/api/task/${taskId}`)
        if (cancelled) return
        setDetail(d)
        setLoading(false)
        const active = !['completed', 'failed', 'cancelled'].includes(d.task.status)
        if (active) {
          timerRef.current = window.setTimeout(load, 2000)  // 仅进行中轮询
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true; if (timerRef.current) clearTimeout(timerRef.current) }
  }, [taskId])

  if (loading) return <div><button className="dash-back-btn" onClick={onBack}>← 返回任务</button><div className="dash-skeleton">加载中…</div></div>
  if (!detail) return <div><button className="dash-back-btn" onClick={onBack}>← 返回任务</button><div className="dash-empty-hint">任务不存在</div></div>

  const { task, turnsBySubtask, conversation } = detail
  const totalTurns = task.subtasks.reduce((s, st) => s + (st.turnCount ?? 0), 0)
  const totalTokIn = task.subtasks.reduce((s, st) => s + (st.tokensInput ?? 0), 0)
  const totalTokOut = task.subtasks.reduce((s, st) => s + (st.tokensOutput ?? 0), 0)

  return (
    <div>
      <button className="dash-back-btn" onClick={onBack}>← 返回任务</button>
      <div className="dash-detail-head">
        <div className="dash-section-title" style={{ margin: 0 }}>{task.name}</div>
        <span className={`dash-badge dash-badge-${task.status}`}>{task.status}</span>
      </div>
      <div className="dash-task-id-mono dash-detail-id">{task.id} · 创建 {task.createdAt.slice(5, 16).replace('T', ' ')}</div>

      <div className="dash-detail-stats">
        <div className="dash-detail-stat"><b>{fmtDuration(task.createdAt, ['completed','failed','cancelled'].includes(task.status) ? task.updatedAt : undefined)}</b><span>总耗时</span></div>
        <div className="dash-detail-stat"><b>{task.subtasks.length}</b><span>子任务</span></div>
        <div className="dash-detail-stat"><b>{totalTurns}</b><span>执行回合</span></div>
        <div className="dash-detail-stat"><b>{totalTokIn}/{totalTokOut}</b><span>token 入/出</span></div>
      </div>

      <div className="dash-task-desc" style={{ marginBottom: 12 }}>{task.description}</div>

      <div className="dash-section-title">子任务执行树</div>
      {task.subtasks.map(st => <SubtaskTree key={st.id} subtask={st} turns={turnsBySubtask[st.id] || []} />)}

      {conversation && conversation.messages.length > 0 && (
        <>
          <div className="dash-section-title" style={{ marginTop: 16 }}>中途沟通 ({conversation.messages.length})</div>
          {conversation.messages.map(m => {
            const text = m.parts.find(p => p.kind === 'text')?.text || ''
            const fromJarvis = m.from === 'jarvis'
            return (
              <div className={`dash-conv-msg ${fromJarvis ? 'from-jarvis' : 'from-agent'}`} key={m.id}>
                <span className="dash-conv-who">{fromJarvis ? 'Jarvis' : '小弟'}</span>
                <span className="dash-conv-text">{text.slice(0, 300)}</span>
              </div>
            )
          })}
        </>
      )}

      {task.result && (
        <>
          <div className="dash-section-title" style={{ marginTop: 16 }}>结果</div>
          <div className="dash-card dash-result-box">{task.result}</div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: TasksPage 接入**

`web/src/pages/dashboard/TasksPage.tsx` 顶部加 `import { TaskDetail } from './components/TaskDetail'`，把 Task 8 的占位 `if (selectedTaskId) { ... }` 块替换为：

```tsx
  if (selectedTaskId) {
    return <TaskDetail taskId={selectedTaskId} onBack={() => setSelectedTaskId(null)} />
  }
```

- [ ] **Step 3: 样式**

`dashboard.css` 末尾追加：

```css
.dash-detail-head { display: flex; justify-content: space-between; align-items: center; }
.dash-detail-id { font-size: 11px; color: var(--text-muted); margin-bottom: 14px; }
.dash-detail-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
.dash-detail-stat { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; padding: 12px; text-align: center; }
.dash-detail-stat b { display: block; font-size: 17px; color: var(--accent); }
.dash-detail-stat span { font-size: 11px; color: var(--text-muted); }
.dash-subtask-tree-head { display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
.dash-subtask-tree-meta { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
.dash-accent-text { color: var(--accent); }
.dash-turns { margin-top: 8px; border-top: 1px solid var(--border); padding-top: 8px; }
.dash-turn { display: flex; gap: 8px; font-size: 12px; padding: 3px 0; color: var(--text-secondary); }
.dash-turn-idx { color: var(--accent); flex-shrink: 0; font-family: var(--font-mono, monospace); }
.dash-conv-msg { display: flex; gap: 8px; padding: 6px 10px; border-radius: 8px; margin-bottom: 6px; font-size: 12px; }
.dash-conv-msg.from-jarvis { background: var(--accent-light); }
.dash-conv-msg.from-agent { background: var(--bg-subtle); }
.dash-conv-who { font-weight: 600; flex-shrink: 0; }
.dash-result-box { white-space: pre-wrap; font-size: 13px; line-height: 1.6; }
.dash-skeleton { padding: 20px; color: var(--text-muted); }
```

- [ ] **Step 4: 类型检查**

Run: `cd web && npx tsc -b`
Expected: 无输出

- [ ] **Step 5: 端到端浏览器验证（核心）**

先确保后端已重启加载 Task 1-4 的改动（`pkill -f "tsx src/index.ts"` 后 `JARVIS_DEBUG=1 npx tsx src/index.ts &`）。

1. 派一个多回合任务（如"生成一个完整 HTML 个人主页"）
2. 执行中进任务页 → 点该任务 → 详情页：能看到进行中状态、回合数随执行增长（2s 轮询生效）
3. 完成后：总耗时/回合/token 数字有值，子任务树可展开看逐回合轨迹
4. 若执行中有 message_jarvis 沟通，「中途沟通」区显示双向对话
5. 完成任务的详情页不再触发轮询（DevTools Network 确认无 2s 一次的 /api/task 请求）

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/dashboard/
git commit -m "feat(dashboard): 任务详情钻取(元信息+轨迹+沟通+结果)"
```

---

## Task 10: 清理旧文件 + 收尾验证

**Files:**
- Delete: `web/src/pages/DashboardPage.tsx`
- Delete: `web/src/pages/DashboardPage.css`
- Delete: `src/probe-inject.ts`（前期调试临时脚本）

**Interfaces:**
- Consumes: 无
- Produces: 无残留旧看板文件

- [ ] **Step 1: 确认无引用后删除**

```bash
cd /Users/lihongjian.34/Desktop/workspace/personal/jarvis
grep -rn "pages/DashboardPage" web/src --include="*.tsx" --include="*.ts" | grep -v "pages/dashboard/"
```
Expected: 无输出（App.tsx 已在 Task 5 改指向新目录）。若有残留引用先改掉。

- [ ] **Step 2: 删除旧文件**

```bash
rm web/src/pages/DashboardPage.tsx web/src/pages/DashboardPage.css
rm src/probe-inject.ts
```

- [ ] **Step 3: 全量类型检查 + 测试**

Run: `npx tsc --noEmit && npx vitest run && cd web && npx tsc -b`
Expected: 后端 tsc 无输出；测试全过（原 24 + 新增 7 = 31）；前端 tsc 无输出

- [ ] **Step 4: 前端构建验证**

Run: `cd web && npx vite build`
Expected: 构建成功，无未解析 import

- [ ] **Step 5: 三页回归浏览器验证**

概览/任务/团队三页切换正常，各页空态与数据态正确，任务详情钻取完整，返回按钮工作。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(dashboard): 删除旧看板单文件+调试脚本"
```

---

## Self-Review 记录

**Spec 覆盖检查**：
- 三页导航（概览/任务/团队）→ Task 5-8 ✓
- 前端单文件拆分 → Task 5-10 ✓
- 新表 jarvis_subtask_turns → Task 1 ✓
- subtasks 五列 → Task 1 ✓
- 五项采集埋点 → Task 3 ✓
- 详情 API → Task 4 ✓
- 中途沟通复用 bus.getConversation → Task 4 ✓
- 任务详情页（元信息/轨迹/沟通/产物）→ Task 9 ✓
- 小弟档案页 → Task 7 ✓
- 视觉 token 复用 + CSS 收敛 → Task 5-9 ✓
- 分级刷新 + 完成任务不轮询 → Task 6/9 ✓
- 空态/骨架屏 → Task 6/7/9 ✓

**类型一致性**：`TaskDetail`/`SubTaskTurn` 在后端 types.ts（Task 1/4）与前端 types.ts（Task 5）结构同构；函数名 `getTaskDetail`/`getSubtaskTurns`/`setSubtaskStarted`/`recordTurn`/`finalizeSubtaskMeta` 在定义（Task 2/4）与调用（Task 3/4/9）处一致。

**已知取舍**：`SubtaskTree` 的耗时计算在轨迹缺失时会退化为 `—`；产物（artifact）展示未单独做卡片，并入结果区（spec 提到 artifact，但当前 task.result 已含汇报全文，artifact 元数据在任务级未单独存——如需独立产物卡片需后续迭代）。
