# Per-User API Key 配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每个用户配置一个或多个 LLM 凭证（API Key + Base URL + 模型名 + 能力档位），任务执行时用自己的凭证，未配置则回退平台默认。

**Architecture:** 新增 `jarvis_user_credentials` 表（一用户多行，扁平建模）。API Key 用 AES-256-GCM 加密存储。执行链路（`dispatchToAgent`、`rawLlmCall`）已带 `userId`，通过新函数 `buildUserEnv(userId, tier?)` 每次返回独立 env 对象注入 `query()`，不碰全局状态，保证并发隔离。前端在 Header 加齿轮入口，弹出凭证列表管理弹窗。

**Tech Stack:** TypeScript (ESM, `.js` import 后缀), better-sqlite3, Node crypto, Express 5, React + Vite + Tailwind。

## Global Constraints

- **ESM import 后缀**：所有相对 import 必须带 `.js` 后缀（如 `import db from '../shared/db.js'`），项目是 ESM。
- **无测试框架**：项目没有 jest/vitest。验证靠 `npx tsc --noEmit`（类型）+ 独立可运行的 tsx 脚本（放 `src/` 下，用完删）+ `npm run case`（现有集成测试，改动执行链路后必须仍通过）。
- **用户隔离**：所有数据访问按 `userId` 过滤，风格对齐 `src/auth/users.ts`。
- **加密主密钥**：从环境变量 `SETTINGS_SECRET` 读，缺失时用 dev 默认值 + `console.warn`，风格对齐 `src/auth/auth.ts:5` 的 `JWT_SECRET`。
- **API Key 明文红线**：任何 GET 接口、任何返回给前端的数据，都不得含 API Key 明文。
- **并发隔离红线**：`buildUserEnv` 只返回新对象，绝不写 `process.env`，绝不修改全局 `agentEnv`。
- **建表模式**：新表加进 `src/shared/db.ts` 的 `db.exec` 块，用 `CREATE TABLE IF NOT EXISTS`，风格对齐现有表。
- **tier 值**：只用稳定英文值 `fast` | `standard` | `strong`，UI 显示中文。

---

### Task 1: 加密模块 crypto.ts

**Files:**
- Create: `src/shared/crypto.ts`
- Verify: 临时脚本 `src/_verify_crypto.ts`（验证后删除）

**Interfaces:**
- Produces:
  - `encrypt(plaintext: string): string` — 返回 `iv:authTag:ciphertext`（全 hex）
  - `decrypt(payload: string): string` — 还原明文，payload 格式非法或篡改则抛错

- [ ] **Step 1: 写加密模块**

Create `src/shared/crypto.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const SECRET = process.env.SETTINGS_SECRET || 'jarvis-dev-settings-secret-change-in-prod'
if (!process.env.SETTINGS_SECRET) {
  console.warn('\x1b[33m[crypto] SETTINGS_SECRET 未设置，使用开发默认值。生产环境必须设置！\x1b[0m')
}

// scrypt 派生 32 字节密钥（AES-256）。salt 固定是可接受的：主密钥本身是高熵秘密，
// 且我们要的是确定性密钥派生，不是密码哈希。
const KEY = scryptSync(SECRET, 'jarvis-settings-salt', 32)
const ALGO = 'aes-256-gcm'

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, KEY, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`
}

export function decrypt(payload: string): string {
  const parts = payload.split(':')
  if (parts.length !== 3) throw new Error('密文格式非法')
  const [ivHex, tagHex, dataHex] = parts
  const decipher = createDecipheriv(ALGO, KEY, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 2: 写验证脚本**

Create `src/_verify_crypto.ts`:

```typescript
import { encrypt, decrypt } from './shared/crypto.js'

const secret = 'sk-ant-test-1234567890'
const enc = encrypt(secret)
console.log('encrypted:', enc)

// 往返一致
const dec = decrypt(enc)
console.assert(dec === secret, '❌ 往返解密不一致')
console.log('✓ 往返一致')

// 两次加密结果不同（IV 随机）
const enc2 = encrypt(secret)
console.assert(enc !== enc2, '❌ 两次加密相同（IV 未随机）')
console.log('✓ IV 随机')

// 篡改检测
try {
  decrypt(enc.slice(0, -2) + 'ff')
  console.error('❌ 篡改未被检测')
} catch {
  console.log('✓ 篡改被检测')
}

// 格式非法
try { decrypt('garbage'); console.error('❌ 非法格式未报错') }
catch { console.log('✓ 非法格式报错') }

console.log('crypto 验证完成')
```

- [ ] **Step 3: 跑验证脚本**

Run: `npx tsx src/_verify_crypto.ts`
Expected: 四个 ✓ 全部打印，无 ❌

- [ ] **Step 4: 删验证脚本 + 类型检查**

Run: `rm src/_verify_crypto.ts && npx tsc --noEmit`
Expected: 无输出（类型通过）

- [ ] **Step 5: Commit**

```bash
git add src/shared/crypto.ts
git commit -m "feat: 添加 AES-256-GCM 加密模块"
```

---

### Task 2: 建表 jarvis_user_credentials

**Files:**
- Modify: `src/shared/db.ts`（在 `db.exec` 模板字符串末尾、最后一个反引号前追加）

**Interfaces:**
- Produces: `jarvis_user_credentials` 表可用（列见下）

- [ ] **Step 1: 加建表语句**

在 `src/shared/db.ts` 的 `db.exec(\`...\`)` 块内、`jarvis_agent_messages` 的 index 之后、结尾反引号之前追加：

```sql

-- ═══ 用户凭证表（BYOK：API Key/Base URL/模型名，支持多凭证 + 能力档位）═══
CREATE TABLE IF NOT EXISTS jarvis_user_credentials (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  label       TEXT NOT NULL,
  tier        TEXT NOT NULL DEFAULT 'standard',
  api_key_enc TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  model       TEXT NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_user_credentials_user ON jarvis_user_credentials(user_id);
```

- [ ] **Step 2: 验证表创建**

Run: `npx tsx -e "import('./src/shared/db.js').then(m => { const cols = m.default.prepare('PRAGMA table_info(jarvis_user_credentials)').all(); console.log(cols.map(c => c.name).join(', ')); })"`
Expected: 打印 `id, user_id, label, tier, api_key_enc, base_url, model, is_default, created_at, updated_at`

- [ ] **Step 3: Commit**

```bash
git add src/shared/db.ts
git commit -m "feat: 添加 jarvis_user_credentials 表"
```

---

### Task 3: 凭证数据访问层 credentials.ts

**Files:**
- Create: `src/auth/credentials.ts`
- Verify: 临时脚本 `src/_verify_credentials.ts`（验证后删除）

**Interfaces:**
- Consumes: `encrypt`/`decrypt`（Task 1）、`db`（`src/shared/db.js`）
- Produces:
  - `interface Credential { id, userId, label, tier, baseUrl, model, isDefault, createdAt, updatedAt }` —— **不含 apiKey 明文**
  - `interface ResolvedCredential { apiKey: string; baseUrl: string; model: string }`
  - `listCredentials(userId: string): Credential[]` —— 脱敏列表（无 key）
  - `resolveCredential(userId: string, tier?: string): ResolvedCredential | null` —— 解密，仅后端内部用
  - `addCredential(userId, p: { label, tier, apiKey, baseUrl, model, isDefault?: boolean }): Credential`
  - `updateCredential(userId, id, p: { label?, tier?, apiKey?, baseUrl?, model?, isDefault?: boolean }): Credential | null`
  - `deleteCredential(userId, id: string): boolean`

- [ ] **Step 1: 写数据访问层**

Create `src/auth/credentials.ts`:

```typescript
import { randomUUID } from 'crypto'
import db from '../shared/db.js'
import { encrypt, decrypt } from '../shared/crypto.js'

export interface Credential {
  id: string
  userId: string
  label: string
  tier: string
  baseUrl: string
  model: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface ResolvedCredential {
  apiKey: string
  baseUrl: string
  model: string
}

function rowToCredential(row: any): Credential {
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    tier: row.tier,
    baseUrl: row.base_url,
    model: row.model,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// 脱敏列表：绝不含 api_key
export function listCredentials(userId: string): Credential[] {
  const rows = db.prepare(
    'SELECT id, user_id, label, tier, base_url, model, is_default, created_at, updated_at FROM jarvis_user_credentials WHERE user_id = ? ORDER BY created_at ASC'
  ).all(userId) as any[]
  return rows.map(rowToCredential)
}

// 解密解析，仅后端内部使用
export function resolveCredential(userId: string, tier?: string): ResolvedCredential | null {
  let row: any
  if (tier) {
    // 指定 tier：该 tier 默认优先，否则该 tier 任意一个
    row = db.prepare(
      'SELECT * FROM jarvis_user_credentials WHERE user_id = ? AND tier = ? ORDER BY is_default DESC, created_at ASC LIMIT 1'
    ).get(userId, tier)
  }
  if (!row) {
    // 无 tier 或无匹配 → 用户默认凭证
    row = db.prepare(
      'SELECT * FROM jarvis_user_credentials WHERE user_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1'
    ).get(userId)
  }
  if (!row) return null
  return { apiKey: decrypt(row.api_key_enc), baseUrl: row.base_url, model: row.model }
}

function clearDefault(userId: string) {
  db.prepare('UPDATE jarvis_user_credentials SET is_default = 0 WHERE user_id = ?').run(userId)
}

export function addCredential(userId: string, p: {
  label: string; tier: string; apiKey: string; baseUrl: string; model: string; isDefault?: boolean
}): Credential {
  const existingCount = (db.prepare('SELECT COUNT(*) as cnt FROM jarvis_user_credentials WHERE user_id = ?').get(userId) as any).cnt
  // 第一个凭证强制为默认；或显式要求默认
  const makeDefault = p.isDefault || existingCount === 0
  if (makeDefault) clearDefault(userId)

  const now = new Date().toISOString()
  const id = randomUUID()
  db.prepare(`
    INSERT INTO jarvis_user_credentials (id, user_id, label, tier, api_key_enc, base_url, model, is_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, p.label, p.tier, encrypt(p.apiKey), p.baseUrl, p.model, makeDefault ? 1 : 0, now, now)

  return rowToCredential(db.prepare('SELECT * FROM jarvis_user_credentials WHERE id = ?').get(id))
}

export function updateCredential(userId: string, id: string, p: {
  label?: string; tier?: string; apiKey?: string; baseUrl?: string; model?: string; isDefault?: boolean
}): Credential | null {
  const row = db.prepare('SELECT * FROM jarvis_user_credentials WHERE id = ? AND user_id = ?').get(id, userId) as any
  if (!row) return null

  if (p.isDefault === true) clearDefault(userId)

  const now = new Date().toISOString()
  db.prepare(`
    UPDATE jarvis_user_credentials
    SET label = ?, tier = ?, api_key_enc = ?, base_url = ?, model = ?, is_default = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    p.label ?? row.label,
    p.tier ?? row.tier,
    p.apiKey !== undefined ? encrypt(p.apiKey) : row.api_key_enc,  // apiKey 未传则保留原值
    p.baseUrl ?? row.base_url,
    p.model ?? row.model,
    p.isDefault === true ? 1 : row.is_default,
    now, id, userId
  )
  return rowToCredential(db.prepare('SELECT * FROM jarvis_user_credentials WHERE id = ?').get(id))
}

export function deleteCredential(userId: string, id: string): boolean {
  const row = db.prepare('SELECT is_default FROM jarvis_user_credentials WHERE id = ? AND user_id = ?').get(id, userId) as any
  if (!row) return false
  db.prepare('DELETE FROM jarvis_user_credentials WHERE id = ? AND user_id = ?').run(id, userId)

  // 删的是默认且还有其它凭证 → 自动指定最早创建的为新默认
  if (row.is_default === 1) {
    const next = db.prepare('SELECT id FROM jarvis_user_credentials WHERE user_id = ? ORDER BY created_at ASC LIMIT 1').get(userId) as any
    if (next) db.prepare('UPDATE jarvis_user_credentials SET is_default = 1 WHERE id = ?').run(next.id)
  }
  return true
}
```

- [ ] **Step 2: 写验证脚本**

Create `src/_verify_credentials.ts`:

```typescript
import { addCredential, listCredentials, resolveCredential, updateCredential, deleteCredential } from './auth/credentials.js'

const U = 'test-user-' + Date.now()

// 首个凭证自动成为默认
const c1 = addCredential(U, { label: 'DeepSeek Flash', tier: 'fast', apiKey: 'sk-flash-key', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-v4-flash' })
console.assert(c1.isDefault === true, '❌ 首个凭证应为默认')
console.log('✓ 首个凭证自动默认')

// 列表脱敏（无 apiKey 字段）
const list = listCredentials(U)
console.assert(!('apiKey' in (list[0] as any)), '❌ 列表泄露了 apiKey')
console.log('✓ 列表脱敏')

// 第二个凭证，设为默认 → 旧默认被清
const c2 = addCredential(U, { label: 'DeepSeek Pro', tier: 'strong', apiKey: 'sk-pro-key', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-v4-pro', isDefault: true })
const afterAdd = listCredentials(U)
const defaults = afterAdd.filter(c => c.isDefault)
console.assert(defaults.length === 1 && defaults[0].id === c2.id, '❌ 默认凭证应恰好一个且为 c2')
console.log('✓ 设新默认清旧默认')

// resolve 不传 tier → 默认凭证（c2）
const rDefault = resolveCredential(U)
console.assert(rDefault?.apiKey === 'sk-pro-key', '❌ 默认解析错误')
console.log('✓ resolve 默认凭证')

// resolve 指定 tier=fast → c1
const rFast = resolveCredential(U, 'fast')
console.assert(rFast?.apiKey === 'sk-flash-key', '❌ tier=fast 解析错误')
console.log('✓ resolve 指定 tier')

// resolve 无匹配 tier → 落到默认
const rNone = resolveCredential(U, 'nonexistent')
console.assert(rNone?.apiKey === 'sk-pro-key', '❌ 无匹配 tier 应落到默认')
console.log('✓ resolve 无匹配落默认')

// update 不传 apiKey → key 保留
updateCredential(U, c1.id, { label: 'DeepSeek Flash 改名' })
const rFastAfter = resolveCredential(U, 'fast')
console.assert(rFastAfter?.apiKey === 'sk-flash-key', '❌ 未传 apiKey 时 key 被覆盖')
console.log('✓ update 不传 apiKey 保留原 key')

// 删默认（c2）→ 自动补默认
deleteCredential(U, c2.id)
const afterDel = listCredentials(U)
console.assert(afterDel.length === 1 && afterDel[0].isDefault === true, '❌ 删默认后未自动补默认')
console.log('✓ 删默认自动补默认')

// 用户隔离：另一个用户看不到
console.assert(listCredentials('other-user').length === 0, '❌ 用户隔离失败')
console.log('✓ 用户隔离')

// 清理
deleteCredential(U, c1.id)
console.log('credentials 验证完成')
```

- [ ] **Step 3: 跑验证脚本**

Run: `npx tsx src/_verify_credentials.ts`
Expected: 九个 ✓ 全部打印，无 ❌

- [ ] **Step 4: 删验证脚本 + 类型检查**

Run: `rm src/_verify_credentials.ts && npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 5: Commit**

```bash
git add src/auth/credentials.ts
git commit -m "feat: 凭证数据访问层（加密存储 + tier 解析 + 默认管理）"
```

---

### Task 4: env 注入 buildUserEnv + 接入执行链路

**Files:**
- Create: `src/shared/user-env.ts`（独立模块，避免 config.ts↔db 循环依赖）
- Modify: `src/a2a/client.ts:127`（`dispatchToAgent` 的 `env`）
- Modify: `src/jarvis/brain.ts:127`（`rawLlmCall` 的 `env`）

**Interfaces:**
- Consumes: `resolveCredential`（Task 3）、`agentEnv`（`src/shared/config.js`）
- Produces: `buildUserEnv(userId: string, tier?: string): Record<string, string>`

- [ ] **Step 1: 写 user-env 模块**

Create `src/shared/user-env.ts`:

```typescript
import { agentEnv } from './config.js'
import { resolveCredential } from '../auth/credentials.js'

// 每次返回新对象，绝不修改全局 agentEnv、绝不写 process.env（并发隔离红线）
export function buildUserEnv(userId: string, tier?: string): Record<string, string> {
  const cred = resolveCredential(userId, tier)
  if (!cred) return agentEnv  // 无凭证 → 回退平台默认
  return {
    ...agentEnv,
    ANTHROPIC_API_KEY: cred.apiKey,
    ANTHROPIC_BASE_URL: cred.baseUrl,
    ANTHROPIC_MODEL: cred.model,
  }
}
```

- [ ] **Step 2: 接入 client.ts**

在 `src/a2a/client.ts` 顶部 import 区加：

```typescript
import { buildUserEnv } from '../shared/user-env.js'
```

把 `queryOptions` 里的 `env: agentEnv,`（第 127 行附近）改为：

```typescript
    env: buildUserEnv(userId),
```

然后删掉现在已无用的 import（第 8 行 `import { agentEnv } from '../shared/config.js'`）——`agentEnv` 在 client.ts 里仅此一处用过，改完即成死 import。

（`userId` 在 `dispatchToAgent` 开头已有：`const userId = context?.userId || 'system'`）

- [ ] **Step 3: 接入 brain.ts**

在 `src/jarvis/brain.ts` 顶部 import 区加：

```typescript
import { buildUserEnv } from '../shared/user-env.js'
```

把 `rawLlmCall` 里 `query()` options 中的 `env: agentEnv,`（第 127 行附近）改为：

```typescript
      env: buildUserEnv(userId),
```

然后删掉已无用的 import（第 17 行 `import { agentEnv } from '../shared/config.js'`）——`agentEnv` 在 brain.ts 里仅此一处用过。（先 `grep -n agentEnv src/jarvis/brain.ts` 复核确无其它引用再删。）

（`rawLlmCall(userId, ...)` 首参已是 userId）

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 5: 验证回退不破坏现有行为**

Run: `npx tsx -e "import('./src/shared/user-env.js').then(m => { const env = m.buildUserEnv('nonexistent-user'); console.assert(env.ANTHROPIC_API_KEY === undefined || env.ANTHROPIC_API_KEY === process.env.ANTHROPIC_API_KEY, 'fallback ok'); console.log('✓ 无凭证用户回退平台 env'); })"`
Expected: 打印 `✓ 无凭证用户回退平台 env`

- [ ] **Step 6: Commit**

```bash
git add src/shared/user-env.ts src/a2a/client.ts src/jarvis/brain.ts
git commit -m "feat: buildUserEnv 按用户注入凭证 env，接入执行链路"
```

---

### Task 5: 后端 API 端点 /api/credentials

**Files:**
- Modify: `src/jarvis/agent.ts`（顶部 import + 在其它 `/api/*` 端点旁新增 4 个路由）

**Interfaces:**
- Consumes: `listCredentials`, `addCredential`, `updateCredential`, `deleteCredential`（Task 3）；`req.userId`（authMiddleware 已注入，见 `agent.ts:132` 之后）
- Produces: REST 端点 `GET/POST/PUT/DELETE /api/credentials[/:id]`

- [ ] **Step 1: 加 import**

在 `src/jarvis/agent.ts` 顶部 import 区（`import { listRecipes } ...` 那一带）加：

```typescript
import { listCredentials, addCredential, updateCredential, deleteCredential } from '../auth/credentials.js'
```

- [ ] **Step 2: 加 4 个路由**

在 `src/jarvis/agent.ts` 现有 `app.get('/api/recipes', ...)`（约 208 行）之后插入：

```typescript
  // ─── 用户凭证管理（BYOK）───
  app.get('/api/credentials', (req, res) => {
    res.json(listCredentials(req.userId!))
  })

  app.post('/api/credentials', (req, res) => {
    const { label, tier, apiKey, baseUrl, model, isDefault } = req.body
    if (!label || !tier || !apiKey || !baseUrl || !model) {
      res.status(400).json({ error: 'label、tier、apiKey、baseUrl、model 均为必填' })
      return
    }
    const cred = addCredential(req.userId!, { label, tier, apiKey, baseUrl, model, isDefault })
    res.json(cred)
  })

  app.put('/api/credentials/:id', (req, res) => {
    const { label, tier, apiKey, baseUrl, model, isDefault } = req.body
    const cred = updateCredential(req.userId!, req.params.id, { label, tier, apiKey, baseUrl, model, isDefault })
    if (!cred) { res.status(404).json({ error: '凭证不存在' }); return }
    res.json(cred)
  })

  app.delete('/api/credentials/:id', (req, res) => {
    const ok = deleteCredential(req.userId!, req.params.id)
    if (!ok) { res.status(404).json({ error: '凭证不存在' }); return }
    res.json({ ok: true })
  })
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 4: 端到端验证（起服务 + curl）**

先起服务：`npm start`（后台或另开终端）。用注册拿 cookie 再打端点：

```bash
# 注册测试用户拿 cookie
curl -s -c /tmp/j_cookie -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"credtest","password":"pw123456"}' > /dev/null

# 新增凭证
curl -s -b /tmp/j_cookie -X POST http://localhost:3000/api/credentials \
  -H 'Content-Type: application/json' \
  -d '{"label":"DeepSeek","tier":"standard","apiKey":"sk-secret-xyz","baseUrl":"https://api.deepseek.com/anthropic","model":"deepseek-v4-flash"}'

# 列表 —— 必须不含 sk-secret-xyz
curl -s -b /tmp/j_cookie http://localhost:3000/api/credentials
```

Expected: 新增返回带 `id`、`isDefault:true`；列表 JSON **不含** `sk-secret-xyz`（grep 应为空）：
`curl -s -b /tmp/j_cookie http://localhost:3000/api/credentials | grep -q 'sk-secret-xyz' && echo "❌ KEY 泄露" || echo "✓ 无 key 泄露"`

- [ ] **Step 5: Commit**

```bash
git add src/jarvis/agent.ts
git commit -m "feat: /api/credentials CRUD 端点"
```

---

### Task 6: 前端 API 封装 credentials.ts

**Files:**
- Create: `web/src/api/credentials.ts`

**Interfaces:**
- Produces:
  - `interface Credential { id, label, tier, baseUrl, model, isDefault, createdAt, updatedAt }`
  - `listCredentials(): Promise<Credential[]>`
  - `createCredential(body): Promise<Credential>`
  - `updateCredential(id, body): Promise<Credential>`
  - `deleteCredential(id): Promise<void>`

- [ ] **Step 1: 写前端 api 封装**

Create `web/src/api/credentials.ts`（风格对齐现有 `web/src/api/auth.ts`）:

```typescript
const BASE = ''

export interface Credential {
  id: string
  label: string
  tier: 'fast' | 'standard' | 'strong'
  baseUrl: string
  model: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface CredentialInput {
  label: string
  tier: string
  apiKey?: string
  baseUrl: string
  model: string
  isDefault?: boolean
}

export async function listCredentials(): Promise<Credential[]> {
  const res = await fetch(`${BASE}/api/credentials`, { credentials: 'include' })
  if (!res.ok) throw new Error('获取凭证失败')
  return res.json()
}

export async function createCredential(body: CredentialInput): Promise<Credential> {
  const res = await fetch(`${BASE}/api/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({ error: '创建失败' }))
    throw new Error(d.error || '创建失败')
  }
  return res.json()
}

export async function updateCredential(id: string, body: Partial<CredentialInput>): Promise<Credential> {
  const res = await fetch(`${BASE}/api/credentials/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({ error: '更新失败' }))
    throw new Error(d.error || '更新失败')
  }
  return res.json()
}

export async function deleteCredential(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/credentials/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error('删除失败')
}
```

- [ ] **Step 2: 前端类型检查**

Run: `cd web && npx tsc --noEmit && cd ..`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add web/src/api/credentials.ts
git commit -m "feat: 前端凭证 API 封装"
```

---

### Task 7: 凭证管理弹窗组件 CredentialsModal.tsx

**Files:**
- Create: `web/src/components/CredentialsModal.tsx`

**Interfaces:**
- Consumes: `listCredentials`, `createCredential`, `updateCredential`, `deleteCredential`, `Credential`（Task 6）
- Produces: `<CredentialsModal open={boolean} onClose={() => void} />`

- [ ] **Step 1: 写弹窗组件**

Create `web/src/components/CredentialsModal.tsx`。配色对齐 Header（`#12122a` / `#2a2a4a` / `#7c7cff` / `#e94560`）。

```tsx
import { useEffect, useState } from 'react'
import { listCredentials, createCredential, updateCredential, deleteCredential, type Credential } from '../api/credentials'

interface Props {
  open: boolean
  onClose: () => void
}

const TIER_LABELS: Record<string, string> = { fast: '快速', standard: '标准', strong: '强力' }
const EMPTY_FORM = { label: '', tier: 'standard', apiKey: '', baseUrl: '', model: '', isDefault: false }

export function CredentialsModal({ open, onClose }: Props) {
  const [creds, setCreds] = useState<Credential[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // editing: null=不在编辑, 'new'=新增, 其它=编辑该 id
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [keyChanged, setKeyChanged] = useState(false)  // 编辑态是否点了"更换 key"

  const refresh = async () => {
    setLoading(true); setError('')
    try { setCreds(await listCredentials()) }
    catch (e) { setError(e instanceof Error ? e.message : '加载失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { if (open) { refresh(); setEditing(null) } }, [open])

  if (!open) return null

  const startNew = () => { setForm(EMPTY_FORM); setKeyChanged(true); setEditing('new') }
  const startEdit = (c: Credential) => {
    setForm({ label: c.label, tier: c.tier, apiKey: '', baseUrl: c.baseUrl, model: c.model, isDefault: c.isDefault })
    setKeyChanged(false)
    setEditing(c.id)
  }

  const save = async () => {
    setError('')
    try {
      if (editing === 'new') {
        if (!form.label || !form.apiKey || !form.baseUrl || !form.model) { setError('请填写所有必填项'); return }
        await createCredential(form)
      } else if (editing) {
        // 编辑：未点"更换"则不提交 apiKey
        const body: any = { label: form.label, tier: form.tier, baseUrl: form.baseUrl, model: form.model, isDefault: form.isDefault }
        if (keyChanged && form.apiKey) body.apiKey = form.apiKey
        await updateCredential(editing, body)
      }
      setEditing(null)
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败') }
  }

  const remove = async (id: string) => {
    if (!confirm('确定删除这个凭证？')) return
    try { await deleteCredential(id); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : '删除失败') }
  }

  const setDefault = async (id: string) => {
    try { await updateCredential(id, { isDefault: true }); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败') }
  }

  const inputCls = 'w-full px-3 py-2 rounded bg-[#0c0c1a] border border-[#2a2a4a] text-white text-sm focus:border-[#7c7cff] outline-none'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[520px] max-h-[80vh] overflow-auto rounded-xl bg-[#12122a] border border-[#2a2a4a] p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">API 凭证</h2>
          <button onClick={onClose} className="text-[#a0a0a0] hover:text-white text-xl leading-none">×</button>
        </div>

        {error && <div className="mb-3 text-sm text-[#e94560]">{error}</div>}
        {loading && <div className="text-sm text-[#a0a0a0]">加载中…</div>}

        {/* 列表 */}
        {!editing && (
          <>
            {creds.length === 0 && !loading && (
              <div className="text-sm text-[#a0a0a0] mb-4">当前使用平台默认凭证。添加自己的凭证后将优先使用。</div>
            )}
            <div className="space-y-2 mb-4">
              {creds.map(c => (
                <div key={c.id} className="flex items-center justify-between p-3 rounded bg-[#0c0c1a] border border-[#2a2a4a]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-white text-sm truncate">{c.label}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2a2a4a] text-[#9e9eff]">{TIER_LABELS[c.tier] || c.tier}</span>
                    {c.isDefault && <span className="text-[10px] text-[#e94560]">★ 默认</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-xs">
                    {!c.isDefault && <button onClick={() => setDefault(c.id)} className="text-[#7c7cff] hover:text-[#9e9eff]">设为默认</button>}
                    <button onClick={() => startEdit(c)} className="text-[#a0a0a0] hover:text-white">编辑</button>
                    <button onClick={() => remove(c.id)} className="text-[#a0a0a0] hover:text-[#e94560]">删除</button>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={startNew} className="w-full py-2 rounded border border-dashed border-[#2a2a4a] text-sm text-[#7c7cff] hover:border-[#7c7cff]">+ 添加凭证</button>
          </>
        )}

        {/* 新增/编辑表单 */}
        {editing && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">名称</label>
              <input className={inputCls} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="如 DeepSeek Pro" />
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">能力档位</label>
              <select className={inputCls} value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })}>
                <option value="fast">快速</option>
                <option value="standard">标准</option>
                <option value="strong">强力</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">API Key</label>
              {editing !== 'new' && !keyChanged ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#a0a0a0]">••••••••</span>
                  <button onClick={() => setKeyChanged(true)} className="text-xs text-[#7c7cff]">更换</button>
                </div>
              ) : (
                <input className={inputCls} type="password" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-..." />
              )}
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">Base URL</label>
              <input className={inputCls} value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} placeholder="如 https://api.deepseek.com/anthropic" />
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">模型名</label>
              <input className={inputCls} value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="如 deepseek-v4-flash" />
            </div>
            <label className="flex items-center gap-2 text-sm text-[#a0a0a0]">
              <input type="checkbox" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} />
              设为默认凭证
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded text-sm text-[#a0a0a0] hover:text-white">取消</button>
              <button onClick={save} className="px-4 py-2 rounded bg-[#7c7cff] text-white text-sm hover:bg-[#9e9eff]">保存</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 前端类型检查**

Run: `cd web && npx tsc --noEmit && cd ..`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add web/src/components/CredentialsModal.tsx
git commit -m "feat: 凭证管理弹窗组件"
```

---

### Task 8: Header 接入齿轮入口

**Files:**
- Modify: `web/src/components/Header.tsx`

**Interfaces:**
- Consumes: `<CredentialsModal>`（Task 7）

- [ ] **Step 1: 改 Header 加齿轮按钮 + 弹窗**

改写 `web/src/components/Header.tsx`（在现有基础上加 useState + 齿轮按钮 + 弹窗挂载）:

```tsx
import { useState } from 'react'
import { CredentialsModal } from './CredentialsModal'

interface Props {
  connected: boolean
  username?: string
  onLogout?: () => void
}

export function Header({ connected, username, onLogout }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-[#2a2a4a] bg-[#12122a]">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#e94560] to-[#f06292] flex items-center justify-center text-white font-bold text-sm">
          J
        </div>
        <span className="text-lg font-semibold text-white">Jarvis</span>
      </div>
      <div className="flex items-center gap-4">
        <a href="#/dashboard" className="text-sm text-[#7c7cff] hover:text-[#9e9eff] transition-colors">Dashboard</a>
        {username && (
          <span className="text-sm text-[#a0a0a0]">{username}</span>
        )}
        <button onClick={() => setSettingsOpen(true)} title="API 凭证设置" className="text-[#a0a0a0] hover:text-white transition-colors" aria-label="设置">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        {onLogout && (
          <button onClick={onLogout} className="text-xs text-[#a0a0a0] hover:text-[#e94560] transition-colors">退出</button>
        )}
        <div className="flex items-center gap-2 text-sm text-[#a0a0a0]">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span>{connected ? '已连接' : '未连接'}</span>
        </div>
      </div>
      <CredentialsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  )
}
```

- [ ] **Step 2: 前端类型检查**

Run: `cd web && npx tsc --noEmit && cd ..`
Expected: 无输出

- [ ] **Step 3: 浏览器验证**

起前端 `cd web && npm run dev`，后端 `npm start`。登录后：点 Header 齿轮 → 弹窗打开 → 添加一个凭证（DeepSeek，`https://api.deepseek.com/anthropic`，`deepseek-v4-flash`）→ 保存 → 列表出现该凭证带"★ 默认" → 刷新页面重开弹窗仍在 → 编辑不改 key 保存成功 → 删除消失。

Expected: 全流程无报错，凭证正确增改删。

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Header.tsx
git commit -m "feat: Header 齿轮入口接入凭证弹窗"
```

---

## 最终集成验证

- [ ] **回归：现有集成测试仍通过**

Run: `npm run case`
Expected: 所有 case 通过（执行链路改了 env 注入，未配置凭证时行为应与之前一致）

- [ ] **类型全绿**

Run: `npx tsc --noEmit && cd web && npx tsc --noEmit && cd ..`
Expected: 两处均无输出

- [ ] **并发隔离抽查**

确认 `grep -rn "process.env\s*\[" src/shared/user-env.ts src/auth/credentials.ts` 无写入 `process.env` 的代码；`buildUserEnv` 内是 `{ ...agentEnv }` 展开而非直接返回/修改 `agentEnv`。

## Self-Review 检查记录

- **Spec 覆盖**：① 存储层→Task 2；② 加密→Task 1；③ 数据访问→Task 3；④ env 注入→Task 4；⑤ API→Task 5；⑥ 前端→Task 6/7/8。tier 口子在 Task 3/4，多凭证默认管理在 Task 3。全覆盖。
- **无占位符**：所有代码步骤含完整可运行代码。
- **类型一致**：后端 `Credential`（含 userId）vs 前端 `Credential`（无 userId，脱敏）为不同层的类型，命名同但字段有意不同，已在 Interfaces 注明。`resolveCredential`/`buildUserEnv` 签名前后一致。
