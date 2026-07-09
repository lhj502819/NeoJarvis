# 临时工独立存储 + Skill 机制 + 晋升改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Jarvis 和小弟引入 SDK 原生 skill 机制,把临时工从"session 影子"升级为独立表实体,并把晋升从自动改为 Jarvis 推荐+用户确认。

**Architecture:** 先做数据层(新表 `jarvis_adhoc_agents` + `jarvis_recipes` 加 skills 列 + 类型),再做临时工写入与记忆复用(client.ts 埋点 + findMatchingSession 接线),再做 skill 基建(两侧 query 加 plugins+skills),最后做晋升(promote_agent 工具 + promote-agent skill + 废除自动晋升 + 改造 get_team_stats)。全程 TDD,数据/逻辑改动配单测,skill 与前端类交互靠端到端浏览器验证。

**Tech Stack:** TypeScript (ESM)、Express、PostgreSQL (pg)、@anthropic-ai/claude-agent-sdk v0.3.193、vitest。

## Global Constraints

- ESM 导入路径必须带 `.js` 后缀(如 `import { x } from './y.js'`),即使源文件是 `.ts`。
- 所有时间戳字段用 ISO 字符串(`new Date().toISOString()`)。
- 新增数据库表用 `CREATE TABLE IF NOT EXISTS`;给现有表加列用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`。所有 DDL 追加在 `src/shared/db.ts` 的 `initDb` 模板字符串内(已被 advisory lock 序列化,勿在 initDb 外单独跑 DDL)。
- 后端类型检查零报错:`npx tsc --noEmit`;前端:`cd web && npx tsc -b`。
- 现有单测不得回归:`npx vitest run`(当前 31 个)。
- `settingSources: []` 保持不变——skill 只通过 `plugins` + `skills` 选项加载,禁止改 settingSources 以免引入本地配置污染。
- skill 全局共享,放 `src/jarvis/skills/`,不按 userId 隔离。
- `last_session_id` 只存真实 UUID sessionId,不存 `auto-` 兜底 ID(后者无法 resume)。
- domain 为空的临时工不入 adhoc 表(无法聚合/晋升)。

---

## File Structure

**后端(新建):**
- `src/a2a/adhoc.ts` — 临时工聚合存储:`upsertAdhocAgent`、`getAdhocAgent`、`listAdhocAgents`、`markAdhocPromoted`
- `src/jarvis/skills/promote-agent/SKILL.md` — 晋升 skill(推荐时机+话术+流程)

**后端(修改):**
- `src/shared/db.ts` — initDb 追加:`jarvis_adhoc_agents` 建表 + `jarvis_recipes` 加 `skills` 列
- `src/shared/types.ts` — `AgentRecipe` 加 `skills: string[]`;新增 `AdhocAgent` 类型
- `src/team/registry.ts` — `rowToRecipe` 读 skills;`createRecipe` 支持 skills 参数并写库
- `src/a2a/history.ts` — `export` `extractKeywords`;新增 `findMatchingSessionByDomain`
- `src/a2a/client.ts` — 收尾处写 adhoc(仅临时工)+ 派单前复用接线;queryOptions 加 plugins+skills
- `src/jarvis/llm.ts` — Jarvis query 加 plugins + `skills: 'all'`
- `src/jarvis/tools.ts` — 新增 `promote_agent` 工具;改造 `get_team_stats` 读 adhoc 表
- `src/jarvis/action-dispatcher.ts` — 删除 line 162 的自动 `evaluatePromotion`
- `src/jarvis/prompt.ts` — 团队管理段:说明晋升改为 skill 驱动(推荐+确认)

**测试(新建):**
- `tests/unit/adhoc.test.ts` — upsert 聚合/跳过逻辑、promoted 标记
- `tests/unit/session-match.test.ts` — findMatchingSessionByDomain 打分匹配
- `tests/unit/promote-agent.test.ts` — promote_agent 转正落库

---

## Task 1: 数据层 — adhoc 表 + recipes.skills 列 + 类型

**Files:**
- Modify: `src/shared/db.ts` (initDb 模板末尾,`ALTER TABLE jarvis_subtasks ADD COLUMN IF NOT EXISTS tokens_output INTEGER;` 之后、闭合反引号之前)
- Modify: `src/shared/types.ts` (`AgentRecipe` 接口 line 81-94;末尾加 `AdhocAgent`)
- Test: `tests/unit/adhoc-schema.test.ts` (Create)

**Interfaces:**
- Produces:
  - 表 `jarvis_adhoc_agents(id, user_id, domain, task_count, last_task_description, cwd, topics, last_session_id, promoted, created_at, updated_at)`
  - `jarvis_recipes` 新列 `skills TEXT DEFAULT '[]'`
  - `AgentRecipe.skills: string[]`
  - `interface AdhocAgent { id, userId, domain, taskCount, lastTaskDescription, cwd?, topics, lastSessionId?, promoted, createdAt, updatedAt }`

- [ ] **Step 1: Write the failing test**

新建 `tests/unit/adhoc-schema.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import pool, { initDb } from '../../src/shared/db.js'

describe('adhoc 数据层 schema', () => {
  beforeAll(async () => { await initDb() })

  it('jarvis_adhoc_agents 表存在且可插入', async () => {
    const id = `test-adhoc-${Date.now()}`
    await pool.query(
      `INSERT INTO jarvis_adhoc_agents (id, user_id, domain, task_count, last_task_description, topics, promoted, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, 'u-x', '技术调研', 1, 'hello', '["a"]', 0, new Date().toISOString(), new Date().toISOString()]
    )
    const { rows } = await pool.query('SELECT * FROM jarvis_adhoc_agents WHERE id=$1', [id])
    expect(rows[0].domain).toBe('技术调研')
    expect(rows[0].task_count).toBe(1)
    await pool.query('DELETE FROM jarvis_adhoc_agents WHERE id=$1', [id])
  })

  it('jarvis_recipes 有 skills 列', async () => {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='jarvis_recipes' AND column_name='skills'
    `)
    expect(rows.length).toBe(1)
  })

  it('(user_id, domain) 唯一约束生效', async () => {
    const now = new Date().toISOString()
    const base = `dup-${Date.now()}`
    await pool.query(
      `INSERT INTO jarvis_adhoc_agents (id, user_id, domain, task_count, last_task_description, topics, promoted, created_at, updated_at)
       VALUES ($1,'u-dup','域A',1,'t','[]',0,$2,$2)`, [base + '-1', now]
    )
    await expect(pool.query(
      `INSERT INTO jarvis_adhoc_agents (id, user_id, domain, task_count, last_task_description, topics, promoted, created_at, updated_at)
       VALUES ($1,'u-dup','域A',1,'t','[]',0,$2,$2)`, [base + '-2', now]
    )).rejects.toThrow()
    await pool.query(`DELETE FROM jarvis_adhoc_agents WHERE user_id='u-dup'`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/adhoc-schema.test.ts`
Expected: FAIL — `relation "jarvis_adhoc_agents" does not exist`

- [ ] **Step 3: 加建表与加列 SQL**

在 `src/shared/db.ts` 的 initDb 模板字符串末尾(现有 `ALTER TABLE jarvis_subtasks ADD COLUMN IF NOT EXISTS tokens_output INTEGER;` 之后、闭合反引号 `` ` `` 之前)追加:

```sql
-- ═══ 临时工(adhoc agent)聚合表 ═══
CREATE TABLE IF NOT EXISTS jarvis_adhoc_agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  task_count INTEGER NOT NULL DEFAULT 0,
  last_task_description TEXT NOT NULL,
  cwd TEXT,
  topics TEXT NOT NULL DEFAULT '[]',
  last_session_id TEXT,
  promoted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jarvis_adhoc_user_domain ON jarvis_adhoc_agents(user_id, domain);

-- ═══ recipe 挂载 skill 白名单 ═══
ALTER TABLE jarvis_recipes ADD COLUMN IF NOT EXISTS skills TEXT DEFAULT '[]';
```

- [ ] **Step 4: 扩展 types.ts**

在 `src/shared/types.ts` 的 `AgentRecipe` 接口(line 81-94),在 `tools: string[]` 之后加一行:

```typescript
  tools: string[]
  skills: string[]
```

在 `AgentRecipe` 接口 `}`(line 94)之后新增:

```typescript
export interface AdhocAgent {
  id: string
  userId: string
  domain: string
  taskCount: number
  lastTaskDescription: string
  cwd?: string
  topics: string[]
  lastSessionId?: string
  promoted: boolean
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/adhoc-schema.test.ts`
Expected: PASS(3 用例)

注意:tsc 此时会因 `AgentRecipe.skills` 必填而在 `registry.ts` 报错(rowToRecipe/createRecipe 还没设置 skills)——Task 2 修复。本步只需测试通过。

- [ ] **Step 6: Commit**

```bash
git add src/shared/db.ts src/shared/types.ts tests/unit/adhoc-schema.test.ts
git commit -m "feat(adhoc): 数据层(adhoc表+recipes.skills列+类型)"
```

---

## Task 2: registry.ts — recipe 读写 skills

**Files:**
- Modify: `src/team/registry.ts` (`rowToRecipe` line 5-20;`createRecipe` line 40-70)
- Test: `tests/unit/recipe-skills.test.ts` (Create)

**Interfaces:**
- Consumes: Task 1 的 `jarvis_recipes.skills` 列、`AgentRecipe.skills`
- Produces:
  - `rowToRecipe` 返回值含 `skills: string[]`
  - `createRecipe` params 支持可选 `skills?: string[]`,默认 `[]`,写入库

- [ ] **Step 1: Write the failing test**

新建 `tests/unit/recipe-skills.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import pool, { initDb } from '../../src/shared/db.js'
import { createRecipe, getRecipe } from '../../src/team/registry.js'

const USER = `u-rs-${Date.now()}`

describe('recipe skills 读写', () => {
  beforeAll(async () => { await initDb() })

  it('createRecipe 写入 skills 并可读回', async () => {
    const r = await createRecipe(USER, {
      name: '测试专家', description: 'd', systemPrompt: 'p',
      tools: ['Read'], skills: ['promote-agent', 'research'],
    })
    const fetched = await getRecipe(USER, r.id)
    expect(fetched?.skills).toEqual(['promote-agent', 'research'])
    await pool.query('DELETE FROM jarvis_recipes WHERE id=$1', [r.id])
  })

  it('createRecipe 不传 skills 默认空数组', async () => {
    const r = await createRecipe(USER, {
      name: '无技能', description: 'd', systemPrompt: 'p', tools: ['Read'],
    })
    const fetched = await getRecipe(USER, r.id)
    expect(fetched?.skills).toEqual([])
    await pool.query('DELETE FROM jarvis_recipes WHERE id=$1', [r.id])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/recipe-skills.test.ts`
Expected: FAIL — `skills` 未定义(createRecipe 不接受该参数 / rowToRecipe 不返回)

- [ ] **Step 3: 扩展 rowToRecipe**

在 `src/team/registry.ts` 的 `rowToRecipe`(line 5-20),在 `tools: JSON.parse(row.tools),` 之后加:

```typescript
    tools: JSON.parse(row.tools),
    skills: row.skills ? JSON.parse(row.skills) : [],
```

- [ ] **Step 4: 扩展 createRecipe**

在 `src/team/registry.ts` 的 `createRecipe` params 类型(line 40-48)加 `skills?: string[]`:

```typescript
export async function createRecipe(userId: string, params: {
  name: string
  description: string
  systemPrompt: string
  tools: string[]
  skills?: string[]
  model?: string
  context?: Record<string, unknown>
  persistent?: boolean
}): Promise<AgentRecipe> {
```

在 recipe 对象字面量(line 49-62)`tools: params.tools,` 之后加:

```typescript
    tools: params.tools,
    skills: params.skills || [],
```

把 INSERT 语句(line 64-67)改为含 skills 列(加到 tools 之后):

```typescript
  await pool.query(`
    INSERT INTO jarvis_recipes (id, user_id, name, description, system_prompt, tools, skills, model, context, persistent, usage_count, created_by, created_at, last_used_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  `, [recipe.id, userId, recipe.name, recipe.description, recipe.systemPrompt, JSON.stringify(recipe.tools), JSON.stringify(recipe.skills), recipe.model, JSON.stringify(recipe.context), recipe.persistent ? 1 : 0, recipe.usageCount, recipe.createdBy, recipe.createdAt, recipe.lastUsedAt || null])
```

- [ ] **Step 5: Run test + tsc**

Run: `npx vitest run tests/unit/recipe-skills.test.ts && npx tsc --noEmit`
Expected: 测试 PASS(2 用例);tsc 无输出(AgentRecipe.skills 现已在 rowToRecipe/createRecipe 处赋值)

- [ ] **Step 6: 全量测试不回归**

Run: `npx vitest run`
Expected: 全过(31 原有 + adhoc-schema 3 + recipe-skills 2 = 36)

- [ ] **Step 7: Commit**

```bash
git add src/team/registry.ts tests/unit/recipe-skills.test.ts
git commit -m "feat(adhoc): recipe 读写 skills 白名单"
```

---

## Task 3: adhoc.ts — 临时工聚合存储函数

**Files:**
- Create: `src/a2a/adhoc.ts`
- Modify: `src/a2a/history.ts` (`export` extractKeywords,line 92)
- Test: `tests/unit/adhoc.test.ts` (Create)

**Interfaces:**
- Consumes: Task 1 的表/类型;`extractKeywords`(history.ts)
- Produces:
  - `upsertAdhocAgent(userId, params: { domain, taskDescription, cwd?, sessionId?, topics: string[] }): Promise<void>`
  - `getAdhocAgent(userId, domain): Promise<AdhocAgent | undefined>`
  - `listAdhocAgents(userId): Promise<AdhocAgent[]>`(仅 promoted=0)
  - `markAdhocPromoted(userId, domain): Promise<void>`

- [ ] **Step 1: 先导出 extractKeywords**

`src/a2a/history.ts` line 92 的 `function extractKeywords` 改为 `export function extractKeywords`:

```typescript
export function extractKeywords(text: string): string[] {
```

- [ ] **Step 2: Write the failing test**

新建 `tests/unit/adhoc.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pool, { initDb } from '../../src/shared/db.js'
import { upsertAdhocAgent, getAdhocAgent, listAdhocAgents, markAdhocPromoted } from '../../src/a2a/adhoc.js'

const USER = `u-adhoc-${Date.now()}`

describe('adhoc 聚合存储', () => {
  beforeAll(async () => { await initDb() })
  afterAll(async () => { await pool.query('DELETE FROM jarvis_adhoc_agents WHERE user_id=$1', [USER]) })

  it('首次 upsert 插入 task_count=1', async () => {
    await upsertAdhocAgent(USER, { domain: '技术调研', taskDescription: '调研A', topics: ['a', 'b'] })
    const a = await getAdhocAgent(USER, '技术调研')
    expect(a?.taskCount).toBe(1)
    expect(a?.topics).toContain('a')
  })

  it('同 domain 再 upsert 累加 task_count 并合并 topics', async () => {
    await upsertAdhocAgent(USER, { domain: '技术调研', taskDescription: '调研B', topics: ['b', 'c'] })
    const a = await getAdhocAgent(USER, '技术调研')
    expect(a?.taskCount).toBe(2)
    expect(a?.topics).toEqual(expect.arrayContaining(['a', 'b', 'c']))
    expect(a?.lastTaskDescription).toBe('调研B')
  })

  it('domain 为空跳过(不插入)', async () => {
    await upsertAdhocAgent(USER, { domain: '', taskDescription: 'x', topics: [] })
    const all = await listAdhocAgents(USER)
    expect(all.find(a => a.domain === '')).toBeUndefined()
  })

  it('仅存真实 sessionId,auto- 前缀不存', async () => {
    await upsertAdhocAgent(USER, { domain: '差旅', taskDescription: 't', topics: [], sessionId: 'auto-123' })
    const a = await getAdhocAgent(USER, '差旅')
    expect(a?.lastSessionId).toBeUndefined()
    await upsertAdhocAgent(USER, { domain: '差旅', taskDescription: 't2', topics: [], sessionId: 'real-uuid-abc' })
    const b = await getAdhocAgent(USER, '差旅')
    expect(b?.lastSessionId).toBe('real-uuid-abc')
  })

  it('markAdhocPromoted 置 promoted=1,listAdhocAgents 不再返回', async () => {
    await markAdhocPromoted(USER, '技术调研')
    const a = await getAdhocAgent(USER, '技术调研')
    expect(a?.promoted).toBe(true)
    const list = await listAdhocAgents(USER)
    expect(list.find(x => x.domain === '技术调研')).toBeUndefined()
  })

  it('promoted 后同 domain upsert 不再累加', async () => {
    await upsertAdhocAgent(USER, { domain: '技术调研', taskDescription: '调研C', topics: [] })
    const a = await getAdhocAgent(USER, '技术调研')
    expect(a?.taskCount).toBe(2)  // 仍是 2,未累加
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/adhoc.test.ts`
Expected: FAIL — `Cannot find module '../../src/a2a/adhoc.js'`

- [ ] **Step 4: 实现 adhoc.ts**

新建 `src/a2a/adhoc.ts`:

```typescript
import { randomUUID } from 'crypto'
import type { AdhocAgent } from '../shared/types.js'
import pool from '../shared/db.js'

function rowToAdhoc(row: any): AdhocAgent {
  return {
    id: row.id,
    userId: row.user_id,
    domain: row.domain,
    taskCount: row.task_count,
    lastTaskDescription: row.last_task_description,
    cwd: row.cwd || undefined,
    topics: row.topics ? JSON.parse(row.topics) : [],
    lastSessionId: row.last_session_id || undefined,
    promoted: row.promoted === 1 || row.promoted === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 只有真实 sessionId 能 resume,auto- 兜底 ID 不存 */
function realSessionId(sessionId?: string): string | null {
  if (!sessionId || sessionId.startsWith('auto-')) return null
  return sessionId
}

export async function upsertAdhocAgent(userId: string, params: {
  domain: string
  taskDescription: string
  cwd?: string
  sessionId?: string
  topics: string[]
}): Promise<void> {
  if (!params.domain) return  // 无领域标签,无法聚合/晋升

  const now = new Date().toISOString()
  const sid = realSessionId(params.sessionId)
  const existing = await getAdhocAgent(userId, params.domain)

  if (existing) {
    if (existing.promoted) return  // 已晋升,不再累加临时工数据
    const mergedTopics = [...new Set([...existing.topics, ...params.topics])].slice(0, 20)
    await pool.query(`
      UPDATE jarvis_adhoc_agents
      SET task_count = task_count + 1, last_task_description = $1, topics = $2,
          last_session_id = COALESCE($3, last_session_id), updated_at = $4
      WHERE user_id = $5 AND domain = $6
    `, [params.taskDescription, JSON.stringify(mergedTopics), sid, now, userId, params.domain])
  } else {
    await pool.query(`
      INSERT INTO jarvis_adhoc_agents (id, user_id, domain, task_count, last_task_description, cwd, topics, last_session_id, promoted, created_at, updated_at)
      VALUES ($1, $2, $3, 1, $4, $5, $6, $7, 0, $8, $8)
    `, [`adhoc-${randomUUID().slice(0, 8)}`, userId, params.domain, params.taskDescription, params.cwd || null, JSON.stringify(params.topics), sid, now])
  }
}

export async function getAdhocAgent(userId: string, domain: string): Promise<AdhocAgent | undefined> {
  const { rows } = await pool.query('SELECT * FROM jarvis_adhoc_agents WHERE user_id = $1 AND domain = $2', [userId, domain])
  return rows[0] ? rowToAdhoc(rows[0]) : undefined
}

export async function listAdhocAgents(userId: string): Promise<AdhocAgent[]> {
  const { rows } = await pool.query('SELECT * FROM jarvis_adhoc_agents WHERE user_id = $1 AND promoted = 0 ORDER BY task_count DESC', [userId])
  return rows.map(rowToAdhoc)
}

export async function markAdhocPromoted(userId: string, domain: string): Promise<void> {
  await pool.query('UPDATE jarvis_adhoc_agents SET promoted = 1 WHERE user_id = $1 AND domain = $2', [userId, domain])
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/adhoc.test.ts`
Expected: PASS(6 用例)

- [ ] **Step 6: tsc + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 无输出;全过

- [ ] **Step 7: Commit**

```bash
git add src/a2a/adhoc.ts src/a2a/history.ts tests/unit/adhoc.test.ts
git commit -m "feat(adhoc): 临时工聚合存储函数(upsert/get/list/promote)"
```

---

## Task 4: history.ts — findMatchingSessionByDomain 复用匹配

**Files:**
- Modify: `src/a2a/history.ts` (末尾新增函数)
- Test: `tests/unit/session-match.test.ts` (Create)

**Interfaces:**
- Consumes: `extractKeywords`(Task 3 已导出)、`jarvis_claude_sessions` 表
- Produces:
  - `findMatchingSessionByDomain(userId, domain, description): Promise<string | undefined>` — 返回匹配到的真实 sessionId(打分≥0.3),无则 undefined

- [ ] **Step 1: Write the failing test**

新建 `tests/unit/session-match.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pool, { initDb } from '../../src/shared/db.js'
import { findMatchingSessionByDomain } from '../../src/a2a/history.js'

const USER = `u-sm-${Date.now()}`

describe('findMatchingSessionByDomain', () => {
  beforeAll(async () => {
    await initDb()
    // 一条真实 UUID session,domain=技术调研,关键词含 openspec
    await pool.query(`
      INSERT INTO jarvis_claude_sessions (user_id, session_id, recipe_id, domain, cwd, topics, last_task_description, completed_at, task_count)
      VALUES ($1, 'real-sess-openspec', 'adhoc-x', '技术调研', '', $2, '调研 openspec 工具', $3, 1)
    `, [USER, JSON.stringify(['openspec', '调研', '工具']), new Date().toISOString()])
    // 一条 auto- 兜底 ID,不应被返回
    await pool.query(`
      INSERT INTO jarvis_claude_sessions (user_id, session_id, recipe_id, domain, cwd, topics, last_task_description, completed_at, task_count)
      VALUES ($1, 'auto-999', 'adhoc-y', '差旅', '', $2, '订机票', $3, 1)
    `, [USER, JSON.stringify(['机票', '差旅']), new Date().toISOString()])
  })
  afterAll(async () => { await pool.query('DELETE FROM jarvis_claude_sessions WHERE user_id=$1', [USER]) })

  it('同 domain + 关键词重叠命中,返回真实 sessionId', async () => {
    const sid = await findMatchingSessionByDomain(USER, '技术调研', '继续调研 openspec 的用法')
    expect(sid).toBe('real-sess-openspec')
  })

  it('关键词无重叠不命中', async () => {
    const sid = await findMatchingSessionByDomain(USER, '技术调研', '写一首关于春天的诗')
    expect(sid).toBeUndefined()
  })

  it('auto- 兜底 sessionId 不返回', async () => {
    const sid = await findMatchingSessionByDomain(USER, '差旅', '帮我订机票去差旅')
    expect(sid).toBeUndefined()
  })

  it('无该 domain 的 session 返回 undefined', async () => {
    const sid = await findMatchingSessionByDomain(USER, '不存在的领域', 'x')
    expect(sid).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/session-match.test.ts`
Expected: FAIL — `findMatchingSessionByDomain is not a function`

- [ ] **Step 3: 实现 findMatchingSessionByDomain**

在 `src/a2a/history.ts` 末尾追加(`extractKeywords` 已在 Task 3 导出,同文件直接用):

```typescript
/**
 * 按 domain + 关键词重叠为临时工匹配可复用的历史 session。
 * 只返回真实 UUID sessionId(auto- 兜底 ID 无法 resume,排除)。
 * 打分 = 关键词重叠数 / 查询关键词数,≥0.3 命中,取最高分。
 */
export async function findMatchingSessionByDomain(userId: string, domain: string, description: string): Promise<string | undefined> {
  if (!domain) return undefined
  const keywords = extractKeywords(description)
  if (keywords.length === 0) return undefined

  const { rows } = await pool.query(
    `SELECT * FROM jarvis_claude_sessions WHERE user_id = $1 AND domain = $2 AND session_id NOT LIKE 'auto-%' ORDER BY completed_at DESC`,
    [userId, domain]
  )
  if (rows.length === 0) return undefined

  let best: string | undefined
  let bestScore = 0
  for (const row of rows) {
    const topics: string[] = JSON.parse(row.topics)
    const overlap = keywords.filter(k => topics.some(t => t.includes(k) || k.includes(t)))
    const score = overlap.length / keywords.length
    if (score > bestScore && score >= 0.3) {
      bestScore = score
      best = row.session_id
    }
  }
  return best
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/session-match.test.ts`
Expected: PASS(4 用例)

- [ ] **Step 5: tsc + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 无输出;全过

- [ ] **Step 6: Commit**

```bash
git add src/a2a/history.ts tests/unit/session-match.test.ts
git commit -m "feat(adhoc): 按 domain 复用匹配 findMatchingSessionByDomain"
```

---

## Task 5: client.ts — 写 adhoc + 复用接线

**Files:**
- Modify: `src/a2a/client.ts` (顶部 import;派单前复用;收尾写 adhoc)
- Test: 无独立单测(依赖真实 LLM 派单),靠 Task 9 端到端验证

**Interfaces:**
- Consumes: `upsertAdhocAgent`(Task 3)、`findMatchingSessionByDomain`(Task 4)、`extractKeywords`(history.ts)
- Produces: 临时工执行后 `jarvis_adhoc_agents` 落库;临时工派单前自动 resume 匹配的历史 session

- [ ] **Step 1: 补 import**

`src/a2a/client.ts` 顶部,现有 `import { setSubtaskStarted, recordTurn, finalizeSubtaskMeta } from '../task/manager.js'` 那行附近加:

```typescript
import { recordAgentSession, findMatchingSessionByDomain, extractKeywords } from './history.js'
import { upsertAdhocAgent } from './adhoc.js'
```

注意:现有已 `import { recordAgentSession } from './history.js'`——把它合并成上面一行,勿重复 import。

- [ ] **Step 2: 派单前复用接线**

在 `src/a2a/client.ts` 的 `const resumeSessionId = context?.resumeSession`(line 121)之后,改为:

```typescript
  let resumeSessionId = context?.resumeSession
  // 临时工(无 recipe)且调用方未指定 resume 时,按 domain 自动匹配历史记忆
  if (!recipe && !resumeSessionId && domain) {
    const matched = await findMatchingSessionByDomain(userId, domain, taskDescription).catch(() => undefined)
    if (matched) {
      resumeSessionId = matched
      debug('adhoc reuse: matched session', matched.slice(0, 8), 'for domain', domain)
    }
  }
```

(`recipe` 是 line 85 `const recipe = await getRecipe(...)`;`domain` 是 line 106 `const domain = context?.domain || ''`——都在此行之前已定义,可直接用。)

- [ ] **Step 3: 收尾写 adhoc**

在 `src/a2a/client.ts` 的 `await recordAgentSession(...)`(line 280)之后加:

```typescript
  await recordAgentSession(userId, finalSessionId, recipeId, taskDescription, domain, recordedCwd)
  debug('recorded agent session:', finalSessionId, 'domain:', domain)

  // 临时工(无 recipe)才聚合到 adhoc 表;正式小弟不写
  if (!recipe && domain) {
    await upsertAdhocAgent(userId, {
      domain,
      taskDescription,
      cwd: recordedCwd || undefined,
      sessionId,  // 原始 sessionId(可能空),adhoc.ts 内部过滤 auto-;此处不传 finalSessionId
      topics: extractKeywords(taskDescription),
    }).catch(() => {})
  }
```

(`sessionId` 是 line 154 `let sessionId = ''` 声明、循环里赋真实值;`finalSessionId` 是 `sessionId || auto-...`。此处刻意传 `sessionId` 而非 `finalSessionId`,让 adhoc 表只存真实 UUID。)

- [ ] **Step 4: tsc**

Run: `npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 5: 全量测试不回归**

Run: `npx vitest run`
Expected: 全过

- [ ] **Step 6: Commit**

```bash
git add src/a2a/client.ts
git commit -m "feat(adhoc): 派单写 adhoc 表 + 临时工历史记忆自动复用"
```

---

## Task 6: skill 基建 — 两侧 query 加 plugins + skills

**Files:**
- Create: `src/jarvis/skills/promote-agent/SKILL.md`
- Modify: `src/jarvis/llm.ts` (queryOptions,line 44-56)
- Modify: `src/a2a/client.ts` (queryOptions,line 133-144)
- Test: 无独立单测,靠 Task 9 端到端验证

**Interfaces:**
- Consumes: SDK v0.3.193 的 `plugins` + `skills` 选项;`recipe.skills`(Task 2)
- Produces:
  - Jarvis query 挂载 skill 目录并 `skills: 'all'`
  - 小弟 query 挂载 skill 目录并 `skills: recipe.skills`(临时工省略)
  - `promote-agent` skill 文件存在(内容 Task 7 补完,本任务先放最小骨架验证加载)

- [ ] **Step 1: 建 skill 目录与最小骨架**

新建 `src/jarvis/skills/promote-agent/SKILL.md`(本任务先放骨架,Task 7 补完晋升逻辑):

```markdown
---
name: promote-agent
description: 当某个领域的临时工(adhoc agent)累计执行多次、值得转正为正式小弟时,用此 skill 判断推荐时机、向用户提议、并在用户确认后执行转正。
---

# 临时工转正(promote-agent)

（完整推荐时机与流程见 Task 7 补完）

用 `promote_agent` 工具执行转正,入参 domain。
```

- [ ] **Step 2: 定位 skill 目录的绝对路径解析方式**

两处 query 需要 skill 目录的绝对路径。在 `src/jarvis/llm.ts` 顶部 import 区加:

```typescript
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'skills')
```

(llm.ts 在 `src/jarvis/`,skill 在 `src/jarvis/skills/`,故 `__dirname/skills`。)

- [ ] **Step 3: Jarvis query 加 plugins + skills**

在 `src/jarvis/llm.ts` 的 `rawLlmCall` 内 `query({ ... options })` 的 options(line 44-56),在 `settingSources: [],` 之后加:

```typescript
      settingSources: [],
      plugins: [{ type: 'local', path: SKILLS_DIR }],
      skills: 'all',
```

- [ ] **Step 4: 小弟 query 加 plugins + skills**

`src/a2a/client.ts` 顶部 import 区加(client.ts 在 `src/a2a/`,skill 在 `src/jarvis/skills/`):

```typescript
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'jarvis', 'skills')
```

在 `queryOptions`(line 133-144)的 `settingSources: [],` 之后加:

```typescript
    settingSources: [],
    plugins: [{ type: 'local', path: SKILLS_DIR }],
    ...(recipe?.skills?.length ? { skills: recipe.skills } : {}),
```

(临时工 `recipe` 为 undefined → 不加 skills 选项;正式小弟按其 skills 白名单。)

- [ ] **Step 5: tsc + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 无输出;测试全过(skill 加载不影响单测,单测不走 query)

- [ ] **Step 6: 端到端验证 skill 加载**

重启后端(`pkill -f "tsx src/index.ts"` 后 `JARVIS_DEBUG=1 npx tsx src/index.ts &`),在浏览器对 Jarvis 说"你现在有哪些 skill 可用?"或触发 Skill 列表。
Expected: Jarvis 能识别到 `promote-agent` skill(不报错、能列出)。若加载失败会在后端日志报 plugin 路径错误——据此修正 SKILLS_DIR。

- [ ] **Step 7: Commit**

```bash
git add src/jarvis/skills/ src/jarvis/llm.ts src/a2a/client.ts
git commit -m "feat(skill): 两侧 query 挂载 local skill 插件目录"
```

---

## Task 7: promote_agent 工具 + promote-agent skill 补完

**Files:**
- Modify: `src/jarvis/tools.ts` (新增 promote_agent 工具;顶部 import)
- Modify: `src/jarvis/skills/promote-agent/SKILL.md` (补完推荐时机+话术+流程)
- Modify: `src/team/promoter.ts` (导出构造函数供工具复用)
- Test: `tests/unit/promote-agent.test.ts` (Create)

**Interfaces:**
- Consumes: `getAdhocAgent`/`markAdhocPromoted`(Task 3)、`getSessionsByDomain`(history.ts)、`createRecipe`(Task 2)、promoter.ts 的 `buildDomainExpertPrompt`/`dominantCwd`/`buildExpertDescription`
- Produces:
  - MCP 工具 `promote_agent(domain)` — 把某 domain 临时工转正为 persistent recipe,标记 adhoc promoted
  - 可复用的导出:`promoteAdhocToRecipe(userId, domain): Promise<{ ok: boolean; message: string }>`

- [ ] **Step 1: 导出 promoter.ts 构造函数**

`src/team/promoter.ts` 里 `buildExpertDescription`(line 98)、`buildDomainExpertPrompt`(line 104)、`dominantCwd`(line 81,已 export)。把 `buildExpertDescription`、`buildDomainExpertPrompt` 前加 `export`:

```typescript
export function buildExpertDescription(domain: string, cwd: string): string {
```

```typescript
export function buildDomainExpertPrompt(domain: string, cwd: string, cluster: DomainCluster): string {
```

(`dominantCwd` 与 `DomainCluster` 已 export。`buildDomainExpertPrompt` 需要 `DomainCluster`,工具侧要构造它——见 Step 4。)

- [ ] **Step 2: Write the failing test**

新建 `tests/unit/promote-agent.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pool, { initDb } from '../../src/shared/db.js'
import { upsertAdhocAgent } from '../../src/a2a/adhoc.js'
import { promoteAdhocToRecipe } from '../../src/jarvis/tools.js'
import { listRecipes } from '../../src/team/registry.js'

const USER = `u-promo-${Date.now()}`

describe('promoteAdhocToRecipe', () => {
  beforeAll(async () => {
    await initDb()
    await upsertAdhocAgent(USER, { domain: '差旅出行', taskDescription: '订机票', topics: ['机票'] })
    await upsertAdhocAgent(USER, { domain: '差旅出行', taskDescription: '订酒店', topics: ['酒店'] })
  })
  afterAll(async () => {
    await pool.query('DELETE FROM jarvis_adhoc_agents WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM jarvis_recipes WHERE user_id=$1', [USER])
  })

  it('转正创建 persistent recipe 并标记 adhoc promoted', async () => {
    const res = await promoteAdhocToRecipe(USER, '差旅出行')
    expect(res.ok).toBe(true)
    const recipes = await listRecipes(USER)
    const expert = recipes.find(r => r.context.domain === '差旅出行')
    expect(expert).toBeDefined()
    expect(expert?.persistent).toBe(true)
    // adhoc 行已标 promoted(listAdhocAgents 过滤 promoted,故查库确认)
    const { rows } = await pool.query('SELECT promoted FROM jarvis_adhoc_agents WHERE user_id=$1 AND domain=$2', [USER, '差旅出行'])
    expect(rows[0].promoted).toBe(1)
  })

  it('无对应 adhoc 返回 ok=false', async () => {
    const res = await promoteAdhocToRecipe(USER, '不存在领域')
    expect(res.ok).toBe(false)
  })

  it('已 promoted 的领域重复转正返回 ok=false', async () => {
    const res = await promoteAdhocToRecipe(USER, '差旅出行')
    expect(res.ok).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/promote-agent.test.ts`
Expected: FAIL — `promoteAdhocToRecipe is not a function`

- [ ] **Step 4: 实现 promoteAdhocToRecipe + 工具**

`src/jarvis/tools.ts` 顶部 import 区加:

```typescript
import { getAdhocAgent, markAdhocPromoted } from '../a2a/adhoc.js'
import { getSessionsByDomain } from '../a2a/history.js'
import { buildDomainExpertPrompt, buildExpertDescription, dominantCwd, type DomainCluster } from '../team/promoter.js'
import { broadcast } from './sse.js'
```

(`createRecipe`、`listRecipes` 已在 tools.ts import;若无则一并加 `import { listRecipes, createRecipe } from '../team/registry.js'`——检查现有 import 行,line 3 是 `import { listRecipes } from '../team/registry.js'`,补 createRecipe。)

在 `createJarvisTools` 函数**之前**(模块级)加导出函数:

```typescript
export async function promoteAdhocToRecipe(userId: string, domain: string): Promise<{ ok: boolean; message: string }> {
  const adhoc = await getAdhocAgent(userId, domain)
  if (!adhoc) return { ok: false, message: `「${domain}」领域暂无临时工记录,无法转正。` }
  if (adhoc.promoted) return { ok: false, message: `「${domain}」领域已有正式小弟。` }

  const sessions = await getSessionsByDomain(userId, domain)
  const cluster: DomainCluster = {
    sessions,
    taskCount: adhoc.taskCount,
    topics: adhoc.topics,
  }
  const cwd = adhoc.cwd || dominantCwd(cluster)

  await createRecipe(userId, {
    name: `${domain}专家`,
    description: buildExpertDescription(domain, cwd),
    systemPrompt: buildDomainExpertPrompt(domain, cwd, cluster),
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
    skills: [],
    context: cwd ? { domain, cwd } : { domain },
    persistent: true,
  })
  await markAdhocPromoted(userId, domain)

  const where = cwd ? `(主战场:${cwd})` : ''
  broadcast('progress', `🎓 新小弟入队:「${domain}专家」${where} — 由 Sir 拍板转正`, userId)
  return { ok: true, message: `已把「${domain}」临时工转正为正式小弟「${domain}专家」。` }
}
```

在 `createJarvisTools` 的 tools 数组里(如放在 `get_team_stats` 之后)加工具:

```typescript
      tool('promote_agent', '把某个领域的临时工转正为正式小弟(persistent 专家)。仅在用户确认转正后调用。',
        { domain: z.string().describe('要转正的领域名,如"技术调研"') },
        async (args) => {
          const res = await promoteAdhocToRecipe(userId, args.domain)
          return { content: [{ type: 'text' as const, text: res.message }] }
        }
      ),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/promote-agent.test.ts`
Expected: PASS(3 用例)

- [ ] **Step 6: 补完 SKILL.md**

把 `src/jarvis/skills/promote-agent/SKILL.md` 内容替换为完整版:

```markdown
---
name: promote-agent
description: 当某个领域的临时工(adhoc agent)累计执行多次、值得转正为正式小弟时,用此 skill 判断推荐时机、向用户提议、并在用户确认后执行转正。
---

# 临时工转正(promote-agent)

你的团队里有两种执行者:**正式小弟**(persistent 专家,永久在队)和**临时工**(某领域临时拉起、用完即弃)。当一个领域的临时工反复被派活,就该考虑把它转正成正式专家。

## 何时推荐转正

用 `get_team_stats` 查看各领域临时工的 task_count。当某领域 **task_count ≥ 3** 时,这是一个"值得转正"的信号——但这是参考,不是硬门槛,由你判断:
- 这个领域的活是否还会持续来?(会 → 值得转正)
- 是一次性需求还是稳定能力?(稳定 → 值得转正)

## 推荐时机(不打扰原则)

不要为了推荐而打断用户。只在你**本就要开口**的两个时机顺带提:
1. **任务完成汇报时**:某临时工刚交付,顺口带一句"顺便说一句,『X 领域』这活儿他干了 N 次了,要不要转正成正式小弟?"
2. **用户问起团队/转正时**:用户问"团队怎么样""有谁可以转正",这时主动列出够格的领域。

## 推荐话术

自然、简短、给用户决定权。例如:
> "『技术调研』这块的临时工已经干了 3 次,表现稳定。要不要我把他转正成正式小弟?以后这类活就固定归他。"

## 转正流程

1. 用户确认(说"收了他""转正吧""可以")后,调 `promote_agent` 工具,入参 `domain`。
2. 工具会创建正式 recipe、标记该领域临时工已转正,并广播入队消息。
3. 向用户确认结果:"『X 专家』已正式入队。"

## 重要约束

- **必须用户确认后才调 promote_agent**。你只负责推荐,拍板权在 Sir。
- 一个领域只能转正一次;已转正的领域 `get_team_stats` 不再列为临时工。
- 转正是把"临时能力"固化为"永久成员",措辞上体现这份郑重,但不夸张。
```

- [ ] **Step 7: tsc + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 无输出;全过

- [ ] **Step 8: Commit**

```bash
git add src/jarvis/tools.ts src/team/promoter.ts src/jarvis/skills/promote-agent/SKILL.md tests/unit/promote-agent.test.ts
git commit -m "feat(promote): promote_agent 工具 + promote-agent skill 补完"
```

---

## Task 8: 废除自动晋升 + 改造 get_team_stats + prompt 说明

**Files:**
- Modify: `src/jarvis/action-dispatcher.ts` (删 line 162 自动 evaluatePromotion)
- Modify: `src/jarvis/tools.ts` (get_team_stats 读 adhoc 表)
- Modify: `src/jarvis/prompt.ts` (团队管理段说明晋升改为 skill 驱动)
- Test: 无独立单测(get_team_stats 组装靠端到端;删除行靠 tsc/回归)

**Interfaces:**
- Consumes: `listAdhocAgents`(Task 3)
- Produces: 任务完成不再自动晋升;get_team_stats 的 temporary 分类反映真实临时工

- [ ] **Step 1: 删除自动晋升**

`src/jarvis/action-dispatcher.ts` line 161-162:

```typescript
    if (!signal.aborted) {
      try { await evaluatePromotion(userId) } catch {}
```

删掉 `try { await evaluatePromotion(userId) } catch {}` 这一行,保留外层 `if (!signal.aborted) {`。同时删掉顶部 line 6 的 `import { evaluatePromotion } from '../team/promoter.js'`(若该 import 仅此一处用)。

- [ ] **Step 2: 改造 get_team_stats**

`src/jarvis/tools.ts` 的 `get_team_stats` 工具(现读 jarvis_claude_sessions 的 domainStats + recipes 的空 temporary)。顶部若未 import 则加 `import { listAdhocAgents } from '../a2a/adhoc.js'`(Task 7 可能已加,检查勿重复)。

把工具实现替换为:

```typescript
      tool('get_team_stats', '查看团队统计:正式小弟、临时工(按领域聚合的待转正候选)、各领域活跃度', {},
        async () => {
          const recipes = await listRecipes(userId)
          const persistent = recipes.filter(r => r.persistent)
          const adhocs = await listAdhocAgents(userId)  // 仅 promoted=0

          const stats = {
            totalMembers: persistent.length,
            persistent: persistent.map(r => ({ name: r.name, domain: r.context?.domain || '', usageCount: r.usageCount })),
            adhocCandidates: adhocs.map(a => ({
              domain: a.domain,
              taskCount: a.taskCount,
              readyToPromote: a.taskCount >= 3,
              lastTask: a.lastTaskDescription.slice(0, 60),
            })),
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(stats, null, 2) }] }
        }
      ),
```

(删掉原来查 jarvis_claude_sessions 的 domainStats 与空的 temporary 分类。`pool` 在 tools.ts 中**仅** `get_team_stats` 这一处使用——删掉该查询后,顶部 line 7 的 `import pool from '../shared/db.js'` 变成未用导入,一并删除,否则 tsc 报未用变量。)

- [ ] **Step 3: 更新 prompt 团队管理段**

`src/jarvis/prompt.ts` 的团队管理段(现有"成长规则"讲"同 domain 3 次自动沉淀")。把自动晋升的描述改为 skill 驱动。找到"**成长规则:**"那段,替换为:

```markdown
**成长规则(晋升由你推荐、Sir 拍板):**
- 临时工干活的记录按 domain 聚合,你可以用 get_team_stats 看到各领域临时工的执行次数
- 某领域临时工执行多次(参考线:≥3 次)且这类活会持续时,你应主动向 Sir 推荐把他转正——具体推荐时机、话术、流程见 promote-agent skill
- **晋升不再自动发生**:必须你推荐 + Sir 确认后,调 promote_agent 工具执行转正
- 小弟一旦转正就是永久的,以后这个领域的活都优先找他
- 只有涉及具体仓库的开发类任务才需要 cwd(门牌号)
```

- [ ] **Step 4: tsc + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 无输出(evaluatePromotion 删除后无悬空引用);全过

- [ ] **Step 5: Commit**

```bash
git add src/jarvis/action-dispatcher.ts src/jarvis/tools.ts src/jarvis/prompt.ts
git commit -m "feat(promote): 废除自动晋升,get_team_stats 读 adhoc,prompt 改 skill 驱动"
```

---

## Task 9: 端到端验证 + 收尾

**Files:**
- 无代码改动(纯验证);如发现问题回对应 Task 修

**Interfaces:**
- Consumes: Task 1-8 全部

- [ ] **Step 1: 重启后端加载全部改动**

```bash
pkill -f "tsx src/index.ts"; sleep 1
JARVIS_DEBUG=1 npx tsx src/index.ts > /tmp/jarvis-backend.log 2>&1 &
```
等待 `curl -s http://localhost:3000/` 有响应,确认启动日志无 plugin/skill 加载错误。

- [ ] **Step 2: 验证 schema**

```bash
psql jarvis -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='jarvis_adhoc_agents'"
psql jarvis -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='jarvis_recipes' AND column_name='skills'"
```
Expected: adhoc 表 11 列齐全;recipes 有 skills 列。

- [ ] **Step 3: 端到端派临时工**

浏览器登录,让 Jarvis 派一个新领域的调研任务(如"帮我调研 X 工具",domain 会是"技术调研"或类似)。等执行完,查库:
```bash
psql jarvis -tAc "SELECT domain, task_count, last_session_id FROM jarvis_adhoc_agents ORDER BY updated_at DESC LIMIT 3"
```
Expected: 出现该 domain 行,task_count≥1。同领域再派一次 → task_count 累加。

- [ ] **Step 4: 验证 skill 与推荐**

再派同领域任务到 task_count≥3,然后问 Jarvis"团队现在什么情况""有谁可以转正"。
Expected: Jarvis 调 get_team_stats,识别到该领域够格,主动推荐转正(promote-agent skill 生效)。

- [ ] **Step 5: 验证转正**

对 Jarvis 说"把他转正"/"收了他"。
Expected: Jarvis 调 promote_agent → 广播"🎓 新小弟入队" → 团队页/`list_team` 出现"X专家"(persistent)→ 该 domain 从 adhoc 候选消失(get_team_stats 不再列)。

- [ ] **Step 6: 验证复用**

派一个和之前临时工相似的同领域任务,看后端日志。
Expected: 日志出现 `adhoc reuse: matched session ...`(findMatchingSessionByDomain 命中,自动 resume)。

- [ ] **Step 7: 全量回归**

```bash
npx tsc --noEmit && npx vitest run && cd web && npx tsc -b
```
Expected: 后端 tsc 无输出;测试全过(31 原 + adhoc-schema 3 + recipe-skills 2 + adhoc 6 + session-match 4 + promote-agent 3 = 49);前端 tsc 无输出。

- [ ] **Step 8: Commit(若验证中有修复)**

```bash
git add -A
git commit -m "test(adhoc): 端到端验证修复"
```
(若无修复则跳过。)

---

## Self-Review 记录

**Spec 覆盖检查:**
- Skill 基建双侧(plugins+skills,不动 settingSources)→ Task 6 ✓
- recipe.skills 白名单 → Task 2(读写)+ Task 6(小弟侧生效)✓
- jarvis_adhoc_agents 独立表 + cwd → Task 1 ✓
- upsertAdhocAgent 聚合/domain空跳过/promoted跳过/仅存真UUID → Task 3 ✓
- 废除自动晋升 → Task 8 ✓
- promote_agent 工具 + promote-agent skill(推荐+确认)→ Task 7 ✓
- get_team_stats 改读 adhoc → Task 8 ✓
- findMatchingSession 复用接线(签名改 by domain)→ Task 4(实现)+ Task 5(接线)✓
- extractKeywords 导出复用 → Task 3 Step 1 ✓
- prompt 说明晋升改 skill 驱动 → Task 8 ✓

**类型一致性:** `AgentRecipe.skills`(Task1)→ rowToRecipe/createRecipe(Task2)一致;`AdhocAgent`(Task1)→ adhoc.ts rowToAdhoc(Task3)一致;`upsertAdhocAgent` 签名(Task3 定义)→ client.ts 调用(Task5)一致;`promoteAdhocToRecipe`(Task7 定义)→ 测试与工具(Task7)一致;`DomainCluster`(promoter.ts 现有 export)→ Task7 构造一致。

**已知取舍:**
- 晋升 recipe 的 skills 初始为空数组(`skills: []`)——正式小弟挂哪些 skill 由后续按需填,本次不预设。
- 复用优先用 jarvis_claude_sessions 按 domain 打分(而非 adhoc.last_session_id 直取),因为打分能挑最相关的历史,比"最近一次"更准;adhoc.last_session_id 作为存储保留供未来用。
- Task 5/6 无独立单测(依赖真实 LLM query),靠 Task 9 端到端覆盖——这是 SDK query 类改动的固有限制。
