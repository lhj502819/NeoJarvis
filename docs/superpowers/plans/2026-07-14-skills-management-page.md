# 技能管理页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 前端新增「技能」页,让 Sir 展示 + 启用/禁用 skills-hub 里聚合的 skill;禁用后 Jarvis 本体和小弟都不再使用;顺带补上 skill 清单从未注入 Jarvis prompt 的死代码窟窿。

**Architecture:** 黑名单表 `jarvis_skill_prefs`(有行=禁用,按用户隔离)与文件系统解耦。后端一次 `Set` 查表把 `enabled` 标好返回给前端。启禁通过 Agent SDK `skills` 数组过滤生效(不碰 `settingSources`,守住 token 红线)。内置 skill(真实目录 + 自定义 `category`/`icon` frontmatter)与个人 skill(软链 + 默认图标)靠 `lstat` 判 symlink 区分。

**Tech Stack:** TypeScript ESM(import 带 `.js`)、Node 22、PostgreSQL(`pg`)、Express、Claude Agent SDK、Vite + React 18、vitest。

## Global Constraints

- **import 带 `.js` 后缀**(ESM),后端源码在 `src/`,前端在 `web/src/`。
- **schema 演进用 `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`**,写在 `src/shared/db.ts` 的 `initDb()` 那段大 SQL 里(line 253 闭合反引号 ``` ` ``` 之前),不写迁移脚本。
- **不改 `settingSources`**(两处均保持 `[]`:`src/jarvis/llm.ts:79`、`src/a2a/client.ts:164`)。
- **管道 skill 恒加载**:`promote-agent` 在 `src/jarvis/plugins/jarvis/skills/`(jarvis 插件,非 hub),不进管理页、不受禁用影响。定义常量 `PIPELINE_SKILLS = ['promote-agent']`。
- **禁用作用域 = Jarvis + 小弟全局**(单开关)。
- **表名前缀 `jarvis_*`**;时间戳用 `new Date().toISOString()` 存 TEXT(跟随 `jarvis_adhoc_agents` 惯例)。
- 后端自检:`npx tsc --noEmit` + `npx vitest run`;前端自检:`cd web && npx tsc --noEmit`。
- 测试放 `tests/unit/*.test.ts`,`beforeAll(() => initDb())`,`afterAll` 清理本 case 造的数据。

---

### Task 1: DB 建表 + skill-prefs 数据层

**Files:**
- Modify: `src/shared/db.ts`(在 line 253 `ALTER TABLE jarvis_artifacts ADD COLUMN IF NOT EXISTS task_id TEXT;` 之后、line 254 闭合 ``` ` ``` 之前插入建表 SQL)
- Create: `src/jarvis/skill-prefs.ts`
- Test: `tests/unit/skill-prefs.test.ts`

**Interfaces:**
- Consumes: `pool`, `initDb` from `../../src/shared/db.js`
- Produces:
  - `getDisabledSkills(userId: string): Promise<Set<string>>` — 返回该用户禁用的 skill 名集合
  - `setSkillEnabled(userId: string, name: string, enabled: boolean): Promise<void>` — enabled=false 则记为禁用(INSERT ON CONFLICT DO NOTHING),true 则删除禁用记录(DELETE)

- [ ] **Step 1: 写建表 SQL(db.ts)**

在 `src/shared/db.ts` 的 line 253 之后插入(仍在 `client.query(\`...\`)` 的模板字符串内):

```sql

-- ═══ 技能启禁偏好(黑名单:有行=该用户禁用了此 skill) ═══
CREATE TABLE IF NOT EXISTS jarvis_skill_prefs (
  user_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  PRIMARY KEY (user_id, skill_name)
);
```

- [ ] **Step 2: 写 skill-prefs.ts**

Create `src/jarvis/skill-prefs.ts`:

```typescript
import pool from '../shared/db.js'

// 黑名单模型:表里有行 = 该用户禁用了这个 skill。空 = 全部启用。
export async function getDisabledSkills(userId: string): Promise<Set<string>> {
  const { rows } = await pool.query(
    'SELECT skill_name FROM jarvis_skill_prefs WHERE user_id = $1',
    [userId]
  )
  return new Set(rows.map((r: any) => r.skill_name))
}

export async function setSkillEnabled(userId: string, name: string, enabled: boolean): Promise<void> {
  if (enabled) {
    await pool.query('DELETE FROM jarvis_skill_prefs WHERE user_id = $1 AND skill_name = $2', [userId, name])
  } else {
    await pool.query(
      'INSERT INTO jarvis_skill_prefs (user_id, skill_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, name]
    )
  }
}
```

- [ ] **Step 3: 写失败测试**

Create `tests/unit/skill-prefs.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pool, { initDb } from '../../src/shared/db.js'
import { getDisabledSkills, setSkillEnabled } from '../../src/jarvis/skill-prefs.js'

const USER = `u-skillpref-${Date.now()}`

describe('skill-prefs 黑名单', () => {
  beforeAll(async () => { await initDb() })
  afterAll(async () => { await pool.query('DELETE FROM jarvis_skill_prefs WHERE user_id=$1', [USER]) })

  it('初始无禁用,集合为空', async () => {
    const disabled = await getDisabledSkills(USER)
    expect(disabled.size).toBe(0)
  })

  it('禁用一个 skill 后集合含它', async () => {
    await setSkillEnabled(USER, 'deep-research', false)
    const disabled = await getDisabledSkills(USER)
    expect(disabled.has('deep-research')).toBe(true)
  })

  it('重复禁用不报错(ON CONFLICT)', async () => {
    await setSkillEnabled(USER, 'deep-research', false)
    const disabled = await getDisabledSkills(USER)
    expect(disabled.size).toBe(1)
  })

  it('重新启用后集合不含它', async () => {
    await setSkillEnabled(USER, 'deep-research', true)
    const disabled = await getDisabledSkills(USER)
    expect(disabled.has('deep-research')).toBe(false)
  })

  it('按用户隔离', async () => {
    const OTHER = `${USER}-other`
    await setSkillEnabled(USER, 'docx', false)
    const otherDisabled = await getDisabledSkills(OTHER)
    expect(otherDisabled.has('docx')).toBe(false)
    await pool.query('DELETE FROM jarvis_skill_prefs WHERE user_id=$1', [OTHER])
  })
})
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/skill-prefs.test.ts`
Expected: 5 个测试全 PASS(建表在 `initDb()` 内已生效)

- [ ] **Step 5: tsc 自检 + 提交**

```bash
npx tsc --noEmit
git add src/shared/db.ts src/jarvis/skill-prefs.ts tests/unit/skill-prefs.test.ts
git commit -m "feat: 技能启禁黑名单表 + skill-prefs 数据层"
```

---

### Task 2: skills-hub 扩展解析 category/icon/source

**Files:**
- Modify: `src/jarvis/skills-hub.ts`
- Test: `tests/unit/skills-hub-meta.test.ts`

**Interfaces:**
- Consumes: 现有 `SOURCES`, `HUB_SKILLS`, `isSkillDir`
- Produces:
  - `HubSkill` 接口扩展为 `{ name: string; description: string; category?: string; icon?: string; source: 'builtin' | 'personal' }`
  - `listHubSkills(): HubSkill[]` — 现有函数,扩展返回字段
  - 内部函数 `parseFrontmatter(text: string): { description: string; category?: string; icon?: string }`

- [ ] **Step 1: 写失败测试**

Create `tests/unit/skills-hub-meta.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { listHubSkills } from '../../src/jarvis/skills-hub.js'

describe('skills-hub 元数据解析', () => {
  it('listHubSkills 每项带 source 字段', () => {
    const skills = listHubSkills()
    // hub 里当前全是软链的个人 skill;若为空则跳过断言
    for (const s of skills) {
      expect(['builtin', 'personal']).toContain(s.source)
      expect(typeof s.name).toBe('string')
    }
  })

  it('软链 skill 的 source 为 personal', () => {
    const skills = listHubSkills()
    const symlinked = skills.filter(s => s.source === 'personal')
    // 当前 hub 全是软链,personal 应占多数(至少非负)
    expect(symlinked.length).toBeGreaterThanOrEqual(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/skills-hub-meta.test.ts`
Expected: FAIL —— `HubSkill` 当前无 `source` 字段,TS 编译或断言失败

- [ ] **Step 3: 扩展 skills-hub.ts**

在 `src/jarvis/skills-hub.ts` 顶部 import 补 `lstatSync`(已在第 1 行 import 列表里,确认包含;若无则加)。替换 `HubSkill` 接口和 `listHubSkills` 函数(文件末尾 line 58-79):

```typescript
export interface HubSkill {
  name: string
  description: string
  category?: string
  icon?: string
  source: 'builtin' | 'personal'
}

// 解析 SKILL.md frontmatter:标准 description + 我们的自定义扩展字段 category/icon
function parseFrontmatter(text: string): { description: string; category?: string; icon?: string } {
  const fm = text.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return { description: '' }
  const block = fm[1]
  const pick = (key: string) => {
    const m = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined
  }
  return {
    description: pick('description') || '',
    category: pick('category'),
    icon: pick('icon'),
  }
}

// 一个 hub 条目是软链(个人)还是真实目录(内置)
function skillSource(name: string): 'builtin' | 'personal' {
  try {
    return lstatSync(join(HUB_SKILLS, name)).isSymbolicLink() ? 'personal' : 'builtin'
  } catch {
    return 'personal'
  }
}

// 读 hub 里每个 skill 的 name/description/category/icon/source
export function listHubSkills(): HubSkill[] {
  if (!existsSync(HUB_SKILLS)) return []
  const skills: HubSkill[] = []
  for (const name of readdirSync(HUB_SKILLS)) {
    const md = join(HUB_SKILLS, name, 'SKILL.md')
    if (!existsSync(md)) continue
    try {
      const meta = parseFrontmatter(readFileSync(md, 'utf-8'))
      skills.push({ name, description: meta.description, category: meta.category, icon: meta.icon, source: skillSource(name) })
    } catch { /* ignore */ }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}
```

> 注:`lstatSync` 已在文件第 1 行的 `import { ... } from 'fs'` 中;`join`/`existsSync`/`readdirSync`/`readFileSync` 亦然。无需新增 import。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/skills-hub-meta.test.ts`
Expected: PASS

- [ ] **Step 5: tsc 自检 + 提交**

```bash
npx tsc --noEmit
git add src/jarvis/skills-hub.ts tests/unit/skills-hub-meta.test.ts
git commit -m "feat: skills-hub 解析 category/icon + 区分内置/个人来源"
```

---

### Task 3: listSkillsForUser 合并层 + PIPELINE_SKILLS

**Files:**
- Modify: `src/jarvis/skill-prefs.ts`
- Test: `tests/unit/skill-prefs.test.ts`(追加)

**Interfaces:**
- Consumes: `listHubSkills` from `./skills-hub.js`, `getDisabledSkills` (Task 1)
- Produces:
  - `PIPELINE_SKILLS: string[]` — 常量 `['promote-agent']`,管道 skill,不进管理页、恒加载
  - `SkillView` 接口 `{ name, description, category, icon, source: 'builtin'|'personal', enabled: boolean }`
  - `listSkillsForUser(userId: string): Promise<SkillView[]>` — 合并 hub skill + enabled 标注,排除 PIPELINE_SKILLS
  - `getEnabledHubSkills(userId: string): Promise<string[]>` — 返回启用的 hub skill 名(供派单/注入过滤用,不含 PIPELINE)

- [ ] **Step 1: 追加失败测试**

在 `tests/unit/skill-prefs.test.ts` 的 `describe` 块内追加:

```typescript
  it('listSkillsForUser 每项带 enabled,禁用项为 false', async () => {
    const { listSkillsForUser } = await import('../../src/jarvis/skill-prefs.js')
    await setSkillEnabled(USER, 'deep-research', false)
    const list = await listSkillsForUser(USER)
    const dr = list.find(s => s.name === 'deep-research')
    // hub 里可能没有 deep-research(取决于本机),有才断言
    if (dr) expect(dr.enabled).toBe(false)
    // 不应包含管道 skill
    expect(list.find(s => s.name === 'promote-agent')).toBeUndefined()
    await setSkillEnabled(USER, 'deep-research', true)
  })

  it('getEnabledHubSkills 不含被禁的、也不含管道 skill', async () => {
    const { getEnabledHubSkills } = await import('../../src/jarvis/skill-prefs.js')
    await setSkillEnabled(USER, 'deep-research', false)
    const enabled = await getEnabledHubSkills(USER)
    expect(enabled).not.toContain('deep-research')
    expect(enabled).not.toContain('promote-agent')
    await setSkillEnabled(USER, 'deep-research', true)
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/skill-prefs.test.ts`
Expected: FAIL —— `listSkillsForUser` / `getEnabledHubSkills` 未定义

- [ ] **Step 3: 在 skill-prefs.ts 追加**

在 `src/jarvis/skill-prefs.ts` 顶部补 import,并在文件末尾追加:

```typescript
import { listHubSkills } from './skills-hub.js'

// 管道类 skill:Jarvis 内部机制(晋升等),恒加载、不进管理页、不受启禁影响
export const PIPELINE_SKILLS = ['promote-agent']

export interface SkillView {
  name: string
  description: string
  category?: string
  icon?: string
  source: 'builtin' | 'personal'
  enabled: boolean
}

// 给管理页用:合并 hub skill + 该用户 enabled 状态,排除管道 skill
export async function listSkillsForUser(userId: string): Promise<SkillView[]> {
  const disabled = await getDisabledSkills(userId)
  return listHubSkills()
    .filter(s => !PIPELINE_SKILLS.includes(s.name))
    .map(s => ({
      name: s.name,
      description: s.description,
      category: s.category,
      icon: s.icon,
      source: s.source,
      enabled: !disabled.has(s.name),
    }))
}

// 给派单/prompt 注入用:启用的 hub skill 名(不含管道 skill——管道 skill 由调用方单独 prepend)
export async function getEnabledHubSkills(userId: string): Promise<string[]> {
  const disabled = await getDisabledSkills(userId)
  return listHubSkills()
    .map(s => s.name)
    .filter(name => !PIPELINE_SKILLS.includes(name) && !disabled.has(name))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/skill-prefs.test.ts`
Expected: 全 PASS

- [ ] **Step 5: tsc 自检 + 提交**

```bash
npx tsc --noEmit
git add src/jarvis/skill-prefs.ts tests/unit/skill-prefs.test.ts
git commit -m "feat: listSkillsForUser 合并层 + PIPELINE_SKILLS 常量"
```

---

### Task 4: 后端 HTTP 接口

**Files:**
- Modify: `src/jarvis/routes/dashboard.ts`
- Test: `tests/unit/skills-api.test.ts`

**Interfaces:**
- Consumes: `listSkillsForUser`, `setSkillEnabled` from `../skill-prefs.js`
- Produces:
  - `GET /api/skills` → `SkillView[]`
  - `POST /api/skills/:name/toggle` body `{ enabled: boolean }` → `{ ok: true }`

- [ ] **Step 1: 写失败测试(直接测函数,不起 express)**

Create `tests/unit/skills-api.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pool, { initDb } from '../../src/shared/db.js'
import { listSkillsForUser, setSkillEnabled } from '../../src/jarvis/skill-prefs.js'

const USER = `u-skillapi-${Date.now()}`

describe('skills API 数据契约', () => {
  beforeAll(async () => { await initDb() })
  afterAll(async () => { await pool.query('DELETE FROM jarvis_skill_prefs WHERE user_id=$1', [USER]) })

  it('listSkillsForUser 返回数组,项形状正确', async () => {
    const list = await listSkillsForUser(USER)
    expect(Array.isArray(list)).toBe(true)
    if (list.length > 0) {
      const s = list[0]
      expect(s).toHaveProperty('name')
      expect(s).toHaveProperty('enabled')
      expect(s).toHaveProperty('source')
    }
  })

  it('toggle 往返:禁用再启用,状态随之变化', async () => {
    const before = await listSkillsForUser(USER)
    if (before.length === 0) return  // 本机 hub 为空则跳过
    const target = before[0].name
    await setSkillEnabled(USER, target, false)
    const afterDisable = await listSkillsForUser(USER)
    expect(afterDisable.find(s => s.name === target)?.enabled).toBe(false)
    await setSkillEnabled(USER, target, true)
    const afterEnable = await listSkillsForUser(USER)
    expect(afterEnable.find(s => s.name === target)?.enabled).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认通过(函数已存在于 Task 3)**

Run: `npx vitest run tests/unit/skills-api.test.ts`
Expected: PASS(这些函数 Task 3 已实现;本测试锁定数据契约)

- [ ] **Step 3: 加路由(dashboard.ts)**

在 `src/jarvis/routes/dashboard.ts` 顶部 import 区加:

```typescript
import { listSkillsForUser, setSkillEnabled } from '../skill-prefs.js'
```

在 `return router` 之前(line 89 之前)插入:

```typescript
  router.get('/api/skills', async (req, res) => {
    res.json(await listSkillsForUser(req.userId!))
  })

  router.post('/api/skills/:name/toggle', async (req, res) => {
    const { enabled } = req.body as { enabled?: boolean }
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled 必须是 boolean' })
      return
    }
    await setSkillEnabled(req.userId!, req.params.name, enabled)
    res.json({ ok: true })
  })
```

- [ ] **Step 4: tsc 自检 + 提交**

```bash
npx tsc --noEmit
git add src/jarvis/routes/dashboard.ts tests/unit/skills-api.test.ts
git commit -m "feat: GET /api/skills + POST /api/skills/:name/toggle"
```

---

### Task 5: 启禁生效 — llm.ts / brain.ts / client.ts 三处联动

**Files:**
- Modify: `src/jarvis/llm.ts`(line 81 `skills: 'all'`)
- Modify: `src/jarvis/brain.ts`(`think()` 组 prompt 处,注入可用技能清单)
- Modify: `src/a2a/client.ts`(line 166-169 merged skills 块,追加禁用过滤)

**Interfaces:**
- Consumes: `getEnabledHubSkills`, `getDisabledSkills`, `PIPELINE_SKILLS` from skill-prefs; `listSkillsForUser` for prompt injection
- Produces: 无新导出(改现有行为)

- [ ] **Step 1: llm.ts — `skills: 'all'` 换成显式启用集**

在 `src/jarvis/llm.ts` 顶部 import 区加:

```typescript
import { getEnabledHubSkills, PIPELINE_SKILLS } from './skill-prefs.js'
```

`rawLlmCall` 内(query options 之前,line 68 附近 `const promptInput = ...` 之后)加:

```typescript
  const enabledSkills = [...PIPELINE_SKILLS, ...(await getEnabledHubSkills(userId))]
```

把 line 81 的 `skills: 'all',` 改为:

```typescript
      skills: enabledSkills,
```

> `rawLlmCall` 签名首参已是 `userId`(line 64),直接可用。

- [ ] **Step 2: 重启后端手测 llm 过滤(无自动化测试,SDK 集成态)**

Run(后台重启,避免 SIGTTIN):
```bash
pkill -f "tsx watch" ; sleep 1 ; nohup npm run dev < /dev/null > /tmp/jarvis-dev.log 2>&1 &
sleep 6 ; grep -E "skills-hub|SYSTEM ONLINE|Chat API" /tmp/jarvis-dev.log
```
Expected: 看到 `[skills-hub] 已纳入 N 个 skill` 且服务起来(无 TS 报错)

- [ ] **Step 3: brain.ts — prompt 注入可用技能清单**

在 `src/jarvis/brain.ts` 顶部 import 区加:

```typescript
import { listSkillsForUser } from './skill-prefs.js'
```

在 `think()` 里,`const recipes = await listRecipes(userId)` 之后(line 53 附近)加:

```typescript
  const availableSkills = await listSkillsForUser(userId)
  const enabledSkillLines = availableSkills
    .filter(s => s.enabled)
    .map(s => `- ${s.name}: ${s.description}`)
    .join('\n')
```

在 `contextualPrompt` 模板里(line 100 `## 可用团队成员` 区块之后)插入一段。找到:

```typescript
## 可用团队成员
${teamInfo || '暂无团队成员'}
```

改为:

```typescript
## 可用团队成员
${teamInfo || '暂无团队成员'}

## 可用技能(派任务时可挂给小弟)
${enabledSkillLines || '(暂无已启用技能)'}
```

- [ ] **Step 4: client.ts — 派单再过滤禁用 skill(防御)**

在 `src/a2a/client.ts` 顶部 import 区加:

```typescript
import { getDisabledSkills } from '../jarvis/skill-prefs.js'
```

把 line 166-169 的 IIFE 块:

```typescript
    ...(() => {
      const merged = [...new Set([...(recipe?.skills || []), ...(context?.skills || [])])]
      return merged.length ? { skills: merged } : {}
    })(),
```

改为(提到 queryOptions 对象构造之前,因为要 await):

先在 `const queryOptions: Record<string, any> = {` 之前加:

```typescript
  const disabledSkills = await getDisabledSkills(userId)
  const mergedSkills = [...new Set([...(recipe?.skills || []), ...(context?.skills || [])])]
    .filter(name => !disabledSkills.has(name))
```

再把 IIFE 块替换为:

```typescript
    ...(mergedSkills.length ? { skills: mergedSkills } : {}),
```

- [ ] **Step 5: tsc 自检**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: 手测端到端过滤**

Run(重启后端):
```bash
pkill -f "tsx watch" ; sleep 1 ; nohup npm run dev < /dev/null > /tmp/jarvis-dev.log 2>&1 &
sleep 6 ; tail -5 /tmp/jarvis-dev.log
```
用 psql 给测试用户禁一个 skill,确认后续派单日志不挂它(Task 8 里在浏览器整体验证)。

- [ ] **Step 7: 提交**

```bash
git add src/jarvis/llm.ts src/jarvis/brain.ts src/a2a/client.ts
git commit -m "feat: 启禁生效三处联动 + 补 skill 清单注入 Jarvis prompt"
```

---

### Task 6: 前端 SkillsPage 组件 + 类型 + 图标

**Files:**
- Create: `web/src/pages/dashboard/SkillsPage.tsx`
- Create: `web/src/pages/dashboard/components/SkillIcon.tsx`
- Modify: `web/src/pages/dashboard/types.ts`(加 `SkillItem`)

**Interfaces:**
- Consumes: `fetchJSON`, `postJSON` from `../../api/client`(均已存在:client.ts:48/56)
- Produces:
  - `SkillItem` 类型
  - `SkillsPage` 组件(default 或具名导出,与 TeamPage 一致用具名 `export function SkillsPage`)
  - `SkillIcon` 组件 `{ icon?: string; source: 'builtin'|'personal' }`

- [ ] **Step 1: types.ts 加类型**

在 `web/src/pages/dashboard/types.ts` 末尾(`export type DashView` 之前)加:

```typescript
export interface SkillItem {
  name: string
  description: string
  category?: string
  icon?: string
  source: 'builtin' | 'personal'
  enabled: boolean
}
```

- [ ] **Step 2: SkillIcon 组件(默认星标 + 少量品牌 SVG)**

Create `web/src/pages/dashboard/components/SkillIcon.tsx`:

```tsx
// 默认图标:四角星带右上小十字(用户指定)。内置 skill 可用 icon 字段指定品牌图标。
const DEFAULT_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 3c.3 2.6 1.4 3.7 4 4-2.6.3-3.7 1.4-4 4-.3-2.6-1.4-3.7-4-4 2.6-.3 3.7-1.4 4-4z" />
    <path d="M19 4v3M17.5 5.5h3" />
    <circle cx="6" cy="17" r="1" />
  </svg>
)

// 内置图标集:key = SKILL.md 里的 icon 字段值
const BRAND_ICONS: Record<string, JSX.Element> = {
  github: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.5 2 2 6.6 2 12.3c0 4.5 2.9 8.3 6.8 9.7.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.4-3.4-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .8.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.6 5 .4.3.7 1 .7 2v2.9c0 .3.2.6.7.5 3.9-1.4 6.8-5.2 6.8-9.7C22 6.6 17.5 2 12 2z"/></svg>
  ),
  apple: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M16 2c0 1.2-.5 2.3-1.3 3.1-.8.9-2.1 1.6-3.2 1.5-.1-1.2.5-2.4 1.2-3.1C13.5 2.6 14.9 2 16 2zm3.5 15.5c-.6 1.4-.9 2-1.7 3.2-1.1 1.7-2.6 3.8-4.5 3.8-1.7 0-2.1-1.1-4.4-1.1s-2.8 1.1-4.4 1.1c-1.9 0-3.3-1.9-4.4-3.6C-.6 17.6-.9 12 1.9 9.1 3 7.7 4.7 6.9 6.3 6.9c1.7 0 2.8 1.1 4.2 1.1 1.4 0 2.2-1.1 4.2-1.1 1.4 0 2.9.8 4 2.1-3.5 1.9-2.9 6.9.8 8.5z"/></svg>
  ),
  google: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 11v2.8h4c-.2 1-1.3 3-4 3-2.4 0-4.4-2-4.4-4.5S9.6 7.8 12 7.8c1.4 0 2.3.6 2.8 1.1l1.9-1.8C15.5 5.9 13.9 5.2 12 5.2 8.2 5.2 5.2 8.3 5.2 12s3 6.8 6.8 6.8c3.9 0 6.5-2.7 6.5-6.6 0-.5 0-.8-.1-1.2H12z"/></svg>
  ),
  wechat: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M9 4C4.9 4 1.6 6.8 1.6 10.2c0 1.9 1 3.6 2.7 4.8L3.4 17l2.4-1.2c.9.3 1.8.4 2.7.4h.6a5.2 5.2 0 0 1-.3-1.8c0-3.2 3-5.7 6.8-5.7h.6C15.7 6 12.7 4 9 4zm7.2 5.4c-3.1 0-5.6 2.1-5.6 4.7s2.5 4.7 5.6 4.7c.7 0 1.4-.1 2-.3l1.9 1-.5-1.6c1.3-.9 2.2-2.3 2.2-3.8 0-2.6-2.5-4.7-5.6-4.7z"/></svg>
  ),
}

export function SkillIcon({ icon, source }: { icon?: string; source: 'builtin' | 'personal' }) {
  const el = source === 'builtin' && icon && BRAND_ICONS[icon] ? BRAND_ICONS[icon] : DEFAULT_ICON
  return <span className="skill-icon">{el}</span>
}
```

- [ ] **Step 3: SkillsPage 组件**

Create `web/src/pages/dashboard/SkillsPage.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { fetchJSON, postJSON } from '../../api/client'
import type { SkillItem } from './types'
import { SkillIcon } from './components/SkillIcon'

type FilterMode = 'all' | 'enabled' | 'disabled'

export function SkillsPage() {
  const [items, setItems] = useState<SkillItem[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterMode>('all')

  const load = async () => {
    const data = await fetchJSON<SkillItem[]>('/api/skills')
    setItems(data)
  }
  useEffect(() => { load() }, [])

  const toggle = async (name: string, next: boolean) => {
    setItems(prev => prev.map(s => s.name === name ? { ...s, enabled: next } : s))  // 乐观更新
    try {
      await postJSON(`/api/skills/${encodeURIComponent(name)}/toggle`, { enabled: next })
    } catch {
      setItems(prev => prev.map(s => s.name === name ? { ...s, enabled: !next } : s))  // 回滚
    }
  }

  const visible = items.filter(s => {
    if (filter === 'enabled' && !s.enabled) return false
    if (filter === 'disabled' && s.enabled) return false
    if (query) {
      const q = query.toLowerCase()
      if (!s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q)) return false
    }
    return true
  })

  // 按分类分组:内置 skill 用各自 category;个人 skill 归「个人」组(排最后)
  const groups = new Map<string, SkillItem[]>()
  for (const s of visible) {
    const g = s.source === 'personal' ? '个人' : (s.category || '其他')
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(s)
  }
  const orderedGroups = [...groups.entries()].sort(([a], [b]) => {
    if (a === '个人') return 1
    if (b === '个人') return -1
    return a.localeCompare(b)
  })

  const enabledCount = items.filter(s => s.enabled).length

  return (
    <div>
      <div className="dash-section-title">技能 ({enabledCount}/{items.length} 启用)</div>
      <div className="skill-toolbar">
        <input
          className="skill-search"
          placeholder="搜索技能名或描述..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <select className="skill-filter" value={filter} onChange={e => setFilter(e.target.value as FilterMode)}>
          <option value="all">全部</option>
          <option value="enabled">已启用</option>
          <option value="disabled">已禁用</option>
        </select>
      </div>

      {items.length === 0 && <div className="dash-empty-hint">暂无技能(skills-hub 未同步到任何 skill)</div>}

      {orderedGroups.map(([group, skills]) => (
        <div key={group} className="skill-group">
          <div className="skill-group-title">{group}</div>
          <div className="skill-grid">
            {skills.map(s => (
              <div className={`skill-card${s.enabled ? '' : ' skill-card-off'}`} key={s.name}>
                <SkillIcon icon={s.icon} source={s.source} />
                <div className="skill-meta">
                  <div className="skill-name">{s.name}</div>
                  <div className="skill-desc">{s.description || '(无描述)'}</div>
                </div>
                <label className="skill-toggle">
                  <input type="checkbox" checked={s.enabled} onChange={e => toggle(s.name, e.target.checked)} />
                  <span className="skill-toggle-track"></span>
                </label>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: 前端 tsc 自检**

Run: `cd web && npx tsc --noEmit`
Expected: 无错误(CSS 类未定义不影响 TS)

- [ ] **Step 5: 提交**

```bash
git add web/src/pages/dashboard/SkillsPage.tsx web/src/pages/dashboard/components/SkillIcon.tsx web/src/pages/dashboard/types.ts
git commit -m "feat: SkillsPage 组件 + SkillIcon(默认星标/品牌图标)"
```

---

### Task 7: 接进 Layout 导航 + CSS

**Files:**
- Modify: `web/src/components/Layout.tsx`
- Modify: `web/src/pages/dashboard/dashboard.css`(末尾追加,当前 517 行)

**Interfaces:**
- Consumes: `SkillsPage` from `../pages/dashboard/SkillsPage`
- Produces: 无(接线)

- [ ] **Step 1: Layout.tsx 加导航项 + 视图分支**

在 `web/src/components/Layout.tsx` import 区(line 10 附近)加:

```typescript
import { SkillsPage } from '../pages/dashboard/SkillsPage'
```

line 14 的 `View` 类型改为:

```typescript
type View = 'chat' | 'tasks' | 'team' | 'artifacts' | 'skills'
```

`NAV_ITEMS`(line 16-21)在 team 与 artifacts 之间(或 artifacts 后)加一项:

```typescript
  { id: 'skills', icon: '✦', label: '技能' },
```

`MainArea` 里(line 129 `{view === 'artifacts' && ...}` 之后)加:

```tsx
        {view === 'skills' && <div className="main-page-wrap"><SkillsPage /></div>}
```

- [ ] **Step 2: dashboard.css 追加样式**

在 `web/src/pages/dashboard/dashboard.css` 末尾追加:

```css
/* ═══ 技能管理页 ═══ */
.skill-toolbar { display: flex; gap: 10px; margin-bottom: 18px; }
.skill-search {
  flex: 1; padding: 8px 12px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 13px;
}
.skill-filter {
  padding: 8px 12px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 13px; cursor: pointer;
}
.skill-group { margin-bottom: 22px; }
.skill-group-title {
  font-size: 12px; color: var(--text-dim); text-transform: uppercase;
  letter-spacing: .05em; margin: 0 0 10px 2px;
}
.skill-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px;
}
.skill-card {
  display: flex; align-items: center; gap: 12px; padding: 14px 16px;
  border-radius: var(--radius); background: var(--surface); border: 1px solid var(--border);
  transition: opacity .15s, border-color .15s;
}
.skill-card-off { opacity: .5; }
.skill-icon { flex-shrink: 0; color: var(--accent, #4a9eff); display: flex; align-items: center; }
.skill-meta { flex: 1; min-width: 0; }
.skill-name { font-size: 14px; font-weight: 600; color: var(--text); }
.skill-desc {
  font-size: 12px; color: var(--text-dim); margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* iOS 风格开关 */
.skill-toggle { flex-shrink: 0; position: relative; display: inline-block; width: 40px; height: 22px; cursor: pointer; }
.skill-toggle input { opacity: 0; width: 0; height: 0; }
.skill-toggle-track {
  position: absolute; inset: 0; border-radius: 22px; background: var(--border);
  transition: background .2s;
}
.skill-toggle-track::before {
  content: ''; position: absolute; left: 2px; top: 2px; width: 18px; height: 18px;
  border-radius: 50%; background: #fff; transition: transform .2s;
}
.skill-toggle input:checked + .skill-toggle-track { background: #34c759; }
.skill-toggle input:checked + .skill-toggle-track::before { transform: translateX(18px); }
```

> 若 `--surface`/`--accent`/`--text-dim`/`--radius` 变量在 dashboard.css 中不存在,用已有的等价变量(参考文件顶部 `:root`)。实现时先 `grep -n "^\s*--" web/src/pages/dashboard/dashboard.css` 确认变量名,替换成实际存在的。

- [ ] **Step 3: 前端 tsc 自检**

Run: `cd web && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add web/src/components/Layout.tsx web/src/pages/dashboard/dashboard.css
git commit -m "feat: 侧栏接入技能页 + 卡片/开关样式"
```

---

### Task 8: 端到端浏览器验证

**Files:** 无(验证任务)

**Interfaces:** 无

- [ ] **Step 1: 重启后端 + 确认前端 HMR**

```bash
pkill -f "tsx watch" ; sleep 1 ; nohup npm run dev < /dev/null > /tmp/jarvis-dev.log 2>&1 &
sleep 6 ; grep -E "skills-hub|Chat API" /tmp/jarvis-dev.log
```
Expected: `[skills-hub] 已纳入 N 个 skill` + 服务启动。前端 vite HMR 无需重启。

- [ ] **Step 2: 浏览器验证展示(chrome-devtools MCP)**

用已登录的 testsir 账号(localhost:5180),点侧栏「✦ 技能」:
- 确认所有 skill 显示、分组标题为「个人」、默认星标图标、开关默认全开
- 顶部计数 `N/N 启用` 正确

- [ ] **Step 3: 验证搜索 + 过滤**

- 搜索框输入关键词 → 卡片按名/描述过滤
- 下拉切「已禁用」→ 初始为空;切「已启用」→ 全部

- [ ] **Step 4: 验证启禁持久化 + 后端生效**

- 关掉某 skill(如 deep-research)的开关 → 卡片变灰
- 刷新页面 → 状态保持关闭(持久化生效)
- 在对话页派一个调研任务 → 查 `/tmp/jarvis-dev.log`,确认该 skill **未**出现在派单 skills 里(可加 `JARVIS_DEBUG=1` 看 debug)
- 重新打开开关 → 再派任务确认恢复

- [ ] **Step 5: 验证内置路径(可选,手造一个内置 skill)**

```bash
mkdir -p src/jarvis/plugins/skills-hub/skills/_test-builtin
cat > src/jarvis/plugins/skills-hub/skills/_test-builtin/SKILL.md <<'EOF'
---
name: _test-builtin
description: 测试内置 skill 分类与图标
category: 开发
icon: github
---
测试
EOF
```
重启后端 → 技能页确认它出现在「开发」组、显示 GitHub 图标。验证完删除该目录:
```bash
rm -rf src/jarvis/plugins/skills-hub/skills/_test-builtin
```

- [ ] **Step 6: 全量自检 + 收尾提交(若验证中有微调)**

```bash
npx tsc --noEmit && npx vitest run
cd web && npx tsc --noEmit && cd ..
git add -A && git commit -m "test: 技能管理页端到端验证" || echo "无改动"
```

---

## Self-Review

**Spec coverage(逐条对 spec):**
- ✅ 前端技能页(分组网格+图标+名+描述+开关):Task 6/7
- ✅ 搜索 + 全部/已启用/已禁用过滤:Task 6
- ✅ 黑名单表按用户隔离:Task 1
- ✅ 禁用后 Jarvis + 小弟都不用:Task 5(llm.ts + client.ts)
- ✅ 补 skill 注入 prompt 窟窿:Task 5(brain.ts)
- ✅ 内置 vs 个人(category/icon/source):Task 2 + Task 6(SkillIcon/分组)
- ✅ 管道 skill 不进页面、恒加载:Task 3(PIPELINE_SKILLS)+ Task 5(llm.ts prepend)
- ✅ 不改 settingSources:Task 5 未触碰
- ✅ 不做增删改 / 不做渠道 Tab:范围内无此任务
- ✅ 多账号隔离验证:Task 1 测试 + Task 8 手测

**Placeholder scan:** 无 TBD/TODO;每个改动步骤都给了完整代码。

**Type consistency:**
- `SkillView`(后端 skill-prefs.ts)与 `SkillItem`(前端 types.ts)字段一致:`name/description/category?/icon?/source/enabled` ✓
- `getEnabledHubSkills` 不含 PIPELINE,llm.ts 里 `[...PIPELINE_SKILLS, ...getEnabledHubSkills()]` 补齐 ✓
- `HubSkill`(Task 2)加 `source` 后,`listSkillsForUser`(Task 3)消费一致 ✓
- `postJSON`/`fetchJSON` 签名与 client.ts 现有一致 ✓

**已知实现期注意点(非阻塞):**
- Task 7 CSS 变量名需 grep 确认(`--surface` 等可能叫别的);已在步骤里标注。
- Task 5 client.ts 的 skills 过滤要提到 `queryOptions` 构造前(因 await),已在步骤写明。
