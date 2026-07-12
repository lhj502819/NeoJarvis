# 桌面端 Jarvis v1 · Plan A — 内核适配(单机本地模式)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 按任务逐个实施。步骤用 checkbox(`- [ ]`)跟踪。

**Goal:** 让 Jarvis 内核在单机本地模式下跑起来 —— 默认用 SQLite(仍兼容 PG)、不依赖全局 claude CLI(用 SDK 自带二进制)、无需登录(本机单用户),为桌面端打包(Plan B)与 SwiftUI 客户端(Plan C)铺好地基。

**Architecture:** 数据层引入**薄适配器**(`db-driver.ts`):保留现有裸 SQL,把 `pg.Pool` 与 `better-sqlite3` 藏在同一个 `{ query(sql,params)→{rows}, exec(sql) }` 接口后;因 12 个消费文件全都只调 `pool.query(...).rows`,它们**一行不改**。驱动按 `DATABASE_URL` 选择:设了 postgres URL → PG,否则 → SQLite 文件(默认)。另删两处 `which claude`、给认证加本机单用户旁路。

**Tech Stack:** TypeScript ESM(Node 22)· `better-sqlite3`(新增)· `pg`(保留)· `@anthropic-ai/claude-agent-sdk` · vitest。

## Global Constraints

- **ESM**:所有相对 import 带 `.js` 后缀;`"type": "module"`。
- **表名前缀** `jarvis_*` / `user_jarvis_*`,保持不变。
- **数据层默认 SQLite**;设 `DATABASE_URL`(postgres URL)时用 PG。二者共用同一套裸 SQL。
- **消费文件接口不变**:`pool.query(sql, params)` 返回 `{ rows }`;禁止改这 12 个文件的查询写法。
- **无 `RETURNING`**(全库 0 处);新代码也不要引入。
- 自检:`npx tsc --noEmit` + `npx vitest run` 必须通过。

---

### Task 1: 数据层薄适配器(SQLite 驱动 + PG 驱动)

**Files:**
- Create: `src/shared/db-driver.ts`
- Test: `tests/unit/db-driver.test.ts`
- Modify: `package.json`(加 `better-sqlite3` 依赖)

**Interfaces:**
- Produces:
  - `interface Db { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>; exec(sql: string): Promise<void> }`
  - `export const db: Db`(按 `DATABASE_URL` 选驱动的单例)
  - `export function translatePlaceholders(sql: string, params: unknown[]): { sql: string; params: unknown[] }`(供测试)

- [ ] **Step 1: 装依赖**

Run:
```bash
npm install better-sqlite3 && npm install -D @types/better-sqlite3
```
Expected: `package.json` dependencies 出现 `better-sqlite3`(`@types/better-sqlite3` 本已在 devDeps)。

- [ ] **Step 2: 写失败测试**(占位符翻译 + SQLite query/exec 行为)

Create `tests/unit/db-driver.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { translatePlaceholders } from '../../src/shared/db-driver.js'

describe('translatePlaceholders', () => {
  it('$1,$2 顺序翻译为 ?', () => {
    const r = translatePlaceholders('SELECT * FROM t WHERE a=$1 AND b=$2', ['x', 'y'])
    expect(r.sql).toBe('SELECT * FROM t WHERE a=? AND b=?')
    expect(r.params).toEqual(['x', 'y'])
  })
  it('复用的 $1 翻译两次、参数取两遍', () => {
    const r = translatePlaceholders('SELECT * FROM t WHERE a=$1 OR b=$1', ['x'])
    expect(r.sql).toBe('SELECT * FROM t WHERE a=? OR b=?')
    expect(r.params).toEqual(['x', 'x'])
  })
})

describe('SqliteDriver via db-driver (内存库)', () => {
  it('exec 建表 + query 参数化插入/查询,返回 { rows }', async () => {
    // 直接构造一个临时 sqlite 文件路径,通过环境变量让 createDriver 选 sqlite
    process.env.JARVIS_DB_PATH = ':memory:'
    delete process.env.DATABASE_URL
    const { db } = await import('../../src/shared/db-driver.js')
    await db.exec('CREATE TABLE IF NOT EXISTS t (id TEXT PRIMARY KEY, n INTEGER)')
    await db.query('INSERT INTO t (id, n) VALUES ($1,$2)', ['a', 1])
    const { rows } = await db.query('SELECT * FROM t WHERE id=$1', ['a'])
    expect(rows[0]).toEqual({ id: 'a', n: 1 })
  })
})
```

- [ ] **Step 3: 运行测试,确认失败**

Run: `npx vitest run tests/unit/db-driver.test.ts`
Expected: FAIL —— `Cannot find module '.../db-driver.js'`。

- [ ] **Step 4: 写适配器实现**

Create `src/shared/db-driver.ts`:
```ts
import pg from 'pg'
import Database from 'better-sqlite3'
import { join } from 'path'

export interface Db {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>
  exec(sql: string): Promise<void>
}

// pg 位置占位符 $N → sqlite 位置占位符 ?(处理复用与顺序)
export function translatePlaceholders(sql: string, params: unknown[]): { sql: string; params: unknown[] } {
  const out: unknown[] = []
  const translated = sql.replace(/\$(\d+)/g, (_m, n: string) => {
    out.push(params[Number(n) - 1])
    return '?'
  })
  return { sql: translated, params: out }
}

// DDL 方言归一(仅 sqlite):SERIAL 自增、ADD COLUMN IF NOT EXISTS 去掉 IF NOT EXISTS(靠 catch 去重)
function normalizeDDL(sql: string): string {
  return sql
    .replace(/SERIAL PRIMARY KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/ADD COLUMN IF NOT EXISTS/gi, 'ADD COLUMN')
}

function isRowReturning(sql: string): boolean {
  return /^\s*(SELECT|WITH|PRAGMA)/i.test(sql)
}

class PgDriver implements Db {
  private pool: pg.Pool
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString })
  }
  async query(sql: string, params: unknown[] = []) {
    return this.pool.query(sql, params as any[])
  }
  async exec(sql: string) {
    await this.pool.query(sql)
  }
}

class SqliteDriver implements Db {
  private sdb: Database.Database
  constructor(path: string) {
    this.sdb = new Database(path)
    this.sdb.pragma('journal_mode = WAL')
    this.sdb.pragma('foreign_keys = ON')
  }
  async query(sql: string, params: unknown[] = []) {
    const t = translatePlaceholders(sql, params)
    const stmt = this.sdb.prepare(t.sql)
    if (isRowReturning(t.sql)) {
      return { rows: stmt.all(...(t.params as any[])) as any[] }
    }
    stmt.run(...(t.params as any[]))
    return { rows: [] as any[] }
  }
  async exec(sql: string) {
    this.sdb.exec(normalizeDDL(sql))
  }
}

function createDriver(): Db {
  const url = process.env.DATABASE_URL
  if (url && /^postgres/i.test(url)) {
    return new PgDriver(url)
  }
  const path = process.env.JARVIS_DB_PATH || join(process.cwd(), 'data', 'jarvis.db')
  return new SqliteDriver(path)
}

export const db: Db = createDriver()
```

- [ ] **Step 5: 运行测试,确认通过**

Run: `npx vitest run tests/unit/db-driver.test.ts`
Expected: PASS(3 个用例)。

- [ ] **Step 6: 提交**

```bash
git add package.json package-lock.json src/shared/db-driver.ts tests/unit/db-driver.test.ts
git commit -m "feat(db): 数据层薄适配器(SQLite/PG 双驱动 + 占位符翻译)"
```

---

### Task 2: `db.ts` 切换到适配器 + 拆分 DDL

**Files:**
- Modify: `src/shared/db.ts`(全文改写)
- Test: `tests/unit/db-sqlite-init.test.ts`

**Interfaces:**
- Consumes: `db`(Task 1 的 `Db` 单例)
- Produces:`export default db`(仍暴露 `.query(sql,params)→{rows}`,消费文件与现有测试无感)、`export async function initDb(): Promise<void>`

- [ ] **Step 1: 写失败测试**(SQLite 下建表 + 往关键表往返)

Create `tests/unit/db-sqlite-init.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'

describe('initDb 在 SQLite 下建表并可读写', () => {
  beforeAll(async () => {
    process.env.JARVIS_DB_PATH = ':memory:'
    delete process.env.DATABASE_URL
  })

  it('建表后可插入并查回 jarvis_tasks', async () => {
    const mod = await import('../../src/shared/db.js')
    await mod.initDb()
    const pool = mod.default
    const now = new Date().toISOString()
    await pool.query(
      `INSERT INTO jarvis_tasks (id, user_id, name, description, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      ['t1', 'local', '测试', '描述', 'created', now, now]
    )
    const { rows } = await pool.query('SELECT * FROM jarvis_tasks WHERE id=$1', ['t1'])
    expect(rows[0].name).toBe('测试')
  })

  it('SERIAL 表(jarvis_claude_sessions)可插入,id 自增', async () => {
    const pool = (await import('../../src/shared/db.js')).default
    await pool.query(
      `INSERT INTO jarvis_claude_sessions (user_id, session_id, recipe_id, last_task_description, completed_at)
       VALUES ($1,$2,$3,$4,$5)`,
      ['local', 's1', 'r1', 'desc', new Date().toISOString()]
    )
    const { rows } = await pool.query('SELECT * FROM jarvis_claude_sessions WHERE session_id=$1', ['s1'])
    expect(rows[0].id).toBeGreaterThan(0)
  })

  it('ALTER ADD COLUMN 幂等(重复 initDb 不报错)', async () => {
    const mod = await import('../../src/shared/db.js')
    await mod.initDb()   // 第二次:sqlite 上 ADD COLUMN 会撞重复列,应被吞掉
    const pool = mod.default
    const { rows } = await pool.query('SELECT started_at FROM jarvis_subtasks LIMIT 1')
    expect(Array.isArray(rows)).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/unit/db-sqlite-init.test.ts`
Expected: FAIL —— 现有 `db.ts` 直接用 `pg.Pool`,`:memory:` sqlite 下 `pool.connect()`/`pg_advisory_lock` 无法工作。

- [ ] **Step 3: 改写 `db.ts`**

将 `src/shared/db.ts` 全文替换为(CREATE 大 blob 去掉 6 条 ALTER,ALTER 拆成数组逐条执行;advisory lock 仅 PG):
```ts
import { db } from './db-driver.js'

const CREATE_SQL = `
-- ═══ 用户表 ═══
CREATE TABLE IF NOT EXISTS jarvis_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);

-- ═══ 任务表 ═══
CREATE TABLE IF NOT EXISTS jarvis_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  plan TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_tasks_user ON jarvis_tasks(user_id);

-- ═══ 子任务表 ═══
CREATE TABLE IF NOT EXISTS jarvis_subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES jarvis_tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  assignee TEXT NOT NULL,
  domain TEXT,
  cwd TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  progress TEXT,
  result TEXT,
  error TEXT,
  blocked_reason TEXT,
  depends_on TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_subtasks_task ON jarvis_subtasks(task_id);

-- ═══ Agent Recipe 表 ═══
CREATE TABLE IF NOT EXISTS jarvis_recipes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  tools TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'sonnet',
  context TEXT NOT NULL DEFAULT '{}',
  persistent INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'jarvis',
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  skills TEXT DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_jarvis_recipes_user ON jarvis_recipes(user_id);

-- ═══ Claude Code Session 登记簿 ═══
CREATE TABLE IF NOT EXISTS jarvis_claude_sessions (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  domain TEXT,
  cwd TEXT,
  topics TEXT NOT NULL DEFAULT '[]',
  last_task_description TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  task_count INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_jarvis_claude_sessions_user ON jarvis_claude_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_jarvis_claude_sessions_recipe ON jarvis_claude_sessions(user_id, recipe_id);

-- ═══ Jarvis 人格状态表 ═══
CREATE TABLE IF NOT EXISTS jarvis_state (
  user_id TEXT PRIMARY KEY,
  mood INTEGER NOT NULL DEFAULT 80,
  energy INTEGER NOT NULL DEFAULT 90,
  confidence INTEGER NOT NULL DEFAULT 70,
  tasks_completed_today INTEGER NOT NULL DEFAULT 0,
  messages_handled_today INTEGER NOT NULL DEFAULT 0,
  last_interaction_at TEXT,
  last_day_reset TEXT NOT NULL,
  familiarity INTEGER NOT NULL DEFAULT 50,
  trust_level INTEGER NOT NULL DEFAULT 45
);

-- ═══ 用户↔Jarvis 会话表 ═══
CREATE TABLE IF NOT EXISTS user_jarvis_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_jarvis_sessions_user ON user_jarvis_sessions(user_id);

-- ═══ 用户↔Jarvis 消息表 ═══
CREATE TABLE IF NOT EXISTS user_jarvis_messages (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES user_jarvis_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  artifact_id TEXT,
  image_ids TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_jarvis_messages_session ON user_jarvis_messages(session_id, timestamp);

-- ═══ Artifact 制品表 ═══
CREATE TABLE IF NOT EXISTS jarvis_artifacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  language TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_artifacts_user ON jarvis_artifacts(user_id);

-- ═══ Jarvis↔Agent 会话表 ═══
CREATE TABLE IF NOT EXISTS jarvis_agent_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  participants TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_agent_threads_user ON jarvis_agent_threads(user_id);

-- ═══ Jarvis↔Agent 消息表 ═══
CREATE TABLE IF NOT EXISTS jarvis_agent_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES jarvis_agent_threads(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  receiver TEXT NOT NULL,
  role TEXT NOT NULL,
  parts TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_jarvis_agent_messages_thread ON jarvis_agent_messages(thread_id);

-- ═══ 用户凭证表（BYOK）═══
CREATE TABLE IF NOT EXISTS jarvis_user_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'standard',
  api_key_enc TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_user_credentials_user ON jarvis_user_credentials(user_id);

-- ═══ 用户 MCP servers 表 ═══
CREATE TABLE IF NOT EXISTS jarvis_user_mcp_servers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  transport TEXT NOT NULL,
  command TEXT,
  args_json TEXT,
  url TEXT,
  env_enc TEXT,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jarvis_user_mcp_name ON jarvis_user_mcp_servers(user_id, name);

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

-- ═══ 对话图片(用户发给 Jarvis 的图,base64 存库供预览/回看) ═══
CREATE TABLE IF NOT EXISTS jarvis_chat_images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_chat_images_user ON jarvis_chat_images(user_id);
`

// 补列(在已存在表上增量加列)。PG 用 IF NOT EXISTS;sqlite 驱动会去掉 IF NOT EXISTS,靠 catch 去重。
const ALTER_SQL: string[] = [
  `ALTER TABLE jarvis_subtasks ADD COLUMN IF NOT EXISTS started_at TEXT`,
  `ALTER TABLE jarvis_subtasks ADD COLUMN IF NOT EXISTS turn_count INTEGER`,
  `ALTER TABLE jarvis_subtasks ADD COLUMN IF NOT EXISTS retry_count INTEGER`,
  `ALTER TABLE jarvis_subtasks ADD COLUMN IF NOT EXISTS tokens_input INTEGER`,
  `ALTER TABLE jarvis_subtasks ADD COLUMN IF NOT EXISTS tokens_output INTEGER`,
]

function isPg(): boolean {
  const url = process.env.DATABASE_URL
  return !!url && /^postgres/i.test(url)
}

export async function initDb() {
  // advisory lock 仅在 PG(多 worker 并发建表)下需要;sqlite 单进程无需
  if (isPg()) await db.query('SELECT pg_advisory_lock($1)', [918273])
  try {
    await db.exec(CREATE_SQL)
    for (const alter of ALTER_SQL) {
      try {
        await db.exec(alter)
      } catch (e: any) {
        // sqlite 重复列 → 幂等忽略;PG 有 IF NOT EXISTS 不会抛
        if (!/duplicate column/i.test(String(e?.message))) throw e
      }
    }
  } finally {
    if (isPg()) await db.query('SELECT pg_advisory_unlock($1)', [918273]).catch(() => {})
  }
}

export default db
```

> 注意:原 db.ts 里 `jarvis_recipes` 的 `skills` 列与 `user_jarvis_messages` 的 `image_ids` 列,原先靠 ALTER 补;这里已直接并入 CREATE TABLE(新库一次建全),同时旧 PG 库靠既有列 + `CREATE TABLE IF NOT EXISTS` 不受影响。

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/unit/db-sqlite-init.test.ts`
Expected: PASS(3 个用例)。

- [ ] **Step 5: 提交**

```bash
git add src/shared/db.ts tests/unit/db-sqlite-init.test.ts
git commit -m "feat(db): db.ts 切到薄适配器,默认 SQLite、拆 DDL、advisory-lock 仅 PG"
```

---

### Task 3: 回归 —— 全量测试跑通 SQLite + 修 2 个 PG 专属测试

**Files:**
- Modify: `tests/unit/adhoc-schema.test.ts`(改 `information_schema` 断言)
- Modify: `tests/unit/subtask-turns.test.ts`(同,如用到 `information_schema`)

**Interfaces:**
- Consumes: Task 2 的 `db` / `initDb`

- [ ] **Step 1: 全量跑一遍,定位 SQLite 下失败项**

Run:
```bash
JARVIS_DB_PATH=:memory: npx vitest run
```
Expected: 大部分通过;`adhoc-schema.test.ts` / `subtask-turns.test.ts` 中查 `information_schema.columns` 的用例 FAIL(SQLite 无该系统表)。

- [ ] **Step 2: 把 `information_schema` 断言改成跨库写法**

在 `tests/unit/adhoc-schema.test.ts` 里,"jarvis_recipes 有 skills 列"这类断言,改为直接 SELECT 该列不报错来验证(跨库通用):
```ts
it('jarvis_recipes 有 skills 列', async () => {
  // 跨库:直接查该列,不报错即存在(避免 PG 专属 information_schema)
  const { rows } = await pool.query('SELECT skills FROM jarvis_recipes LIMIT 1')
  expect(Array.isArray(rows)).toBe(true)
})
```
`subtask-turns.test.ts` 若有同类 `information_schema` 断言,按同法改为 `SELECT <列> FROM <表> LIMIT 1`。

- [ ] **Step 3: 全量测试通过(SQLite)**

Run: `JARVIS_DB_PATH=:memory: npx vitest run`
Expected: PASS(全部 15+ 文件)。

- [ ] **Step 4: dev 冒烟(SQLite 真实文件)**

Run:
```bash
rm -f data/jarvis-smoke.db* ; JARVIS_DB_PATH=data/jarvis-smoke.db npm run dev
```
Expected:控制台打印 `Jarvis A2A Server: http://localhost:3000`,无 pg 连接错误。另开终端:
```bash
sqlite3 data/jarvis-smoke.db ".tables" | tr ' ' '\n' | grep -c jarvis_
```
Expected:数出 ≥10 张 `jarvis_*` 表。停掉 dev,`rm -f data/jarvis-smoke.db*`。

- [ ] **Step 5: 提交**

```bash
git add tests/unit/adhoc-schema.test.ts tests/unit/subtask-turns.test.ts
git commit -m "test(db): PG 专属 information_schema 断言改跨库写法,全量测试跑通 SQLite"
```

---

### Task 4: 删除 `which claude` 依赖,用 Agent SDK 自带二进制

**Files:**
- Modify: `src/jarvis/llm.ts:15,74`
- Modify: `src/team/factory.ts:19-28,57`

**Interfaces:**
- 不改导出签名;仅移除 `pathToClaudeCodeExecutable` 传参与 `which claude` 探测。

- [ ] **Step 1: 改 `llm.ts`**

删除第 15 行:
```ts
const CLAUDE_PATH = execSync('which claude', { encoding: 'utf-8' }).trim()
```
删除第 2 行的 `execSync` import(若该文件仅此处用到):
```ts
import { execSync } from 'child_process'
```
在 `query({ options: { ... } })` 中删掉这一行(原 74 行):
```ts
      pathToClaudeCodeExecutable: CLAUDE_PATH,
```

- [ ] **Step 2: 改 `factory.ts`**

删除 `findClaudePath()` 函数(19-26 行)与其调用 `const CLAUDE_PATH = findClaudePath()`(28 行),删除第 4 行 `import { execSync } from 'child_process'`。在 `query({ options })` 中删掉(原 57 行):
```ts
          pathToClaudeCodeExecutable: CLAUDE_PATH,
```

- [ ] **Step 3: 类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无错误(不再引用 `CLAUDE_PATH` / `execSync`)。

- [ ] **Step 4: 冒烟 —— 内核仍能派活**

前提:本机已装 `@anthropic-ai/claude-agent-sdk`(其 optional 依赖会带平台二进制),并有可用的 `ANTHROPIC_API_KEY`。
Run:
```bash
JARVIS_DB_PATH=:memory: JARVIS_LOCAL_MODE=1 npm run dev
```
在 CLI 里发一句简单消息(如"你好"),Expected:Jarvis 正常流式回复,日志无 "找不到 claude CLI" / spawn 失败。

> 说明:此步是集成冒烟,非单元测试(spawn 子进程 + 真实 LLM 不适合单测)。tsc + 现有全量测试保证不回归。

- [ ] **Step 5: 提交**

```bash
git add src/jarvis/llm.ts src/team/factory.ts
git commit -m "feat(sdk): 删除 which-claude 依赖,改用 Agent SDK 自带二进制"
```

---

### Task 5: 单机单用户认证(本机 loopback 旁路)

**Files:**
- Modify: `src/auth/middleware.ts`
- Test: `tests/unit/local-auth.test.ts`

**Interfaces:**
- Consumes: 环境变量 `JARVIS_LOCAL_MODE`(`'1'` 开启)、`JARVIS_LOCAL_USER_ID`(默认 `'local'`)
- Produces:`authMiddleware` 在本地模式下不校验 cookie,直接注入固定 `req.userId`

- [ ] **Step 1: 写失败测试**

Create `tests/unit/local-auth.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

function makeRes() {
  return {
    statusCode: 0,
    body: null as any,
    status(c: number) { this.statusCode = c; return this },
    json(b: any) { this.body = b; return this },
  }
}

describe('authMiddleware 本地模式', () => {
  beforeEach(() => { vi.resetModules() })

  it('LOCAL_MODE=1 时无 cookie 也放行,注入固定 userId', async () => {
    process.env.JARVIS_LOCAL_MODE = '1'
    process.env.JARVIS_LOCAL_USER_ID = 'local'
    const { authMiddleware } = await import('../../src/auth/middleware.js')
    const req: any = { cookies: {} }
    const res = makeRes()
    const next = vi.fn()
    authMiddleware(req, res as any, next)
    expect(next).toHaveBeenCalled()
    expect(req.userId).toBe('local')
  })

  it('非本地模式且无 token 时 401', async () => {
    delete process.env.JARVIS_LOCAL_MODE
    const { authMiddleware } = await import('../../src/auth/middleware.js')
    const req: any = { cookies: {} }
    const res = makeRes()
    const next = vi.fn()
    authMiddleware(req, res as any, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/unit/local-auth.test.ts`
Expected: FAIL —— 本地模式用例走进 cookie 校验被 401。

- [ ] **Step 3: 给 `middleware.ts` 加本地模式旁路**

在 `src/auth/middleware.ts` 的 `authMiddleware` 开头(第 16 行函数体最前)插入:
```ts
  // 单机本地模式:内核绑 127.0.0.1、单用户,无需登录。由桌面应用启动内核时设 JARVIS_LOCAL_MODE=1。
  if (process.env.JARVIS_LOCAL_MODE === '1') {
    const uid = process.env.JARVIS_LOCAL_USER_ID || 'local'
    req.userId = uid
    req.username = 'local'
    if (!initializedUsers.has(uid)) {
      initializedUsers.add(uid)
      cleanupStaleTasks(uid)
    }
    next()
    return
  }
```
(其余 cookie 校验逻辑保持不变,作为非本地模式路径。)

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/unit/local-auth.test.ts`
Expected: PASS(2 个用例)。

- [ ] **Step 5: 全量回归 + 提交**

Run: `JARVIS_DB_PATH=:memory: npx vitest run`
Expected: 全部 PASS。
```bash
git add src/auth/middleware.ts tests/unit/local-auth.test.ts
git commit -m "feat(auth): 单机本地模式旁路登录(JARVIS_LOCAL_MODE)"
```

---

## 关于 provider 多厂商(§5):Plan A 无需任务

调查确认 `buildUserEnv`(`src/shared/user-env.ts`)已从 BYOK 凭证表(`jarvis_user_credentials`,含 `base_url`/`api_key_enc`/`model`)按用户注入 `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL`。接 DeepSeek = 存一条 base_url 指向其 anthropic 端点的凭证即可,机制已具备。**"选 DeepSeek 自动填 base_url"这类 preset 属首启引导 UX,归 Plan C(SwiftUI 客户端)。** 对 vision/thinking/MCP 的兼容度 spike 也在有真实客户端后再做更合适。

---

## Self-Review

**Spec 覆盖(对 §):**
- §4.1 删 which-claude → Task 4 ✅
- §4.3 单机认证 → Task 5 ✅
- §5 provider → 已由 BYOK 覆盖,无需任务(见上说明)✅
- §7 SQLite 默认 + 兼容 PG → Task 1/2/3 ✅
- §4.2 API key 认证 → 机制已在 buildUserEnv;填 key 的 UI 归 Plan C(本计划不涉及)

**占位符扫描:** 无 TBD/TODO;每个代码步骤含真实代码与预期输出。

**类型一致性:** `Db` 接口 `{ query, exec }` 在 Task 1 定义,Task 2 消费一致;`db` 单例默认导出保持消费方 `pool.query(sql,params)→{rows}` 契约不变。`translatePlaceholders` 签名 Task 1 定义、测试一致。

**范围:** Plan A 只动内核 TS 侧,自洽可测;打包(Plan B)、SwiftUI 客户端 + 首启引导/provider preset(Plan C)是后续独立计划。
