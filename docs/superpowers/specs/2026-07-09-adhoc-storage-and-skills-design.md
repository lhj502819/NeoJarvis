# 临时工独立存储 + Skill 机制 + 晋升改造 设计

> 状态:已批准，待转 writing-plans
> 日期:2026-07-09

## 背景与问题

当前系统里，Jarvis 派任务时若没有匹配的正式小弟（recipe），就临时拉起一个"临时工"（adhoc agent）——本质是一次性的 Claude Agent SDK `query()` 会话，用完即弃。存在三个问题：

1. **临时工没有独立存储**。它的踪迹只散落在 `jarvis_claude_sessions`（执行 session 明细）里，靠 `domain` 字段隐式聚合。`get_team_stats`（`tools.ts`）里的 "temporary" 分类实际读的是 `jarvis_recipes` 表中 `persistent=false` 的行——但晋升时创建的 recipe 全是 `persistent=true`，所以那个分类**永远是空的**，是个隐藏 bug。
2. **晋升是自动的、无人拍板**。`promoter.ts` 的 `evaluatePromotion` 在每次任务完成后（`action-dispatcher.ts:162`）自动按 domain 聚类，满 3 次就偷偷建正式小弟。用户希望改成 **Jarvis 推荐 + 用户确认**。
3. **复用机制是死代码**。`findMatchingSession`（`history.ts:58`）定义了"按 domain+关键词匹配历史 session 来复用"，但全代码库无任何调用方。复用现在只靠 Jarvis 在 prompt 里肉眼挑 sessionId 填 `resumeSession`。

此外，用户提出更高层的诉求：**Jarvis 和小弟都应支持 Claude Code 的 skill 机制**——晋升逻辑本身应封装成一个可复用的 skill，小弟作为领域专家也应能挂载各自的专属 skill。当前两处 `settingSources: []`（`llm.ts:50`、`client.ts:140`）关闭了 `.claude/` 加载，但 SDK（v0.3.193）提供了独立的 `skills` + `plugins` 选项，无需改动 `settingSources` 即可加载 skill。

## 目标

一次性完成四块相互咬合的改造：

1. **Skill 基建**：给 Jarvis 和小弟双侧引入 SDK 原生 skill 机制。
2. **临时工独立存储**：新建 `jarvis_adhoc_agents` 表，临时工从"session 影子"升级为按 domain 聚合的独立实体。
3. **晋升改造**：废除自动晋升，改为 Jarvis 推荐 + 用户确认，逻辑封装为 `promote-agent` skill + `promote_agent` 工具。
4. **复用接线**：把 `findMatchingSession` 接进派单流程，临时工历史记忆自动复用。

## 非目标

- 不改动正式小弟已有的 session 明细存储方式（`jarvis_claude_sessions` 保持不变，继续供任务详情钻取和 resume）。
- 不引入定时器/轮询来触发晋升推荐（用户此前否决过定时轮询）。推荐只搭在 Jarvis 本就会醒来的时机（任务完成汇报、用户问起）。
- 不改动 `settingSources`（保持 `[]`），skill 通过独立的 `plugins` + `skills` 选项加载，避免本地配置污染。

---

## 决策记录（来自 brainstorm）

| 决策点 | 选择 |
|---|---|
| 晋升计数数据源 | 仍从临时工独立存储读，但改为 Jarvis 决策 |
| 晋升触发方式 | **Jarvis 推荐 + 用户确认** |
| 临时工身份粒度 | **按 domain 聚合**（不预建实体，首次派活即建行） |
| 复用机制 | **自动复用**（接线 `findMatchingSession`） |
| 存储方案 | **方案 A：独立 `jarvis_adhoc_agents` 表 + domain 聚合** |
| 临时工表存 cwd | **存**（门牌号，供晋升时带上下文） |
| 晋升逻辑封装 | **先搭 skill 机制，晋升写成 skill** |
| skill 覆盖范围 | **Jarvis + 小弟双侧都做** |
| 小弟 skill 绑定 | **recipe.skills 白名单** |

---

## 架构总览

```
派任务
  │
  ├─ getRecipe 命中 ──→ 正式小弟执行（skills = recipe.skills 白名单）
  │
  └─ 未命中 ──→ 临时工执行（skills = 空/默认）
                    │
                    ├─ recordAgentSession（session 明细，不变）
                    └─ upsertAdhocAgent（按 domain 聚合到新表）← 新增

Jarvis 大脑（llm.ts）
  ├─ plugins: [local skills 目录] + skills: 'all'
  └─ promote-agent skill：判断推荐时机 → 推荐 → 用户确认 → 调 promote_agent 工具

promote_agent 工具
  └─ 读 adhoc 行 + 历史 session → 构造 recipe → createRecipe(persistent=true) → adhoc 行标 promoted=1

派单前（client.ts）
  └─ findMatchingSession（按 domain+关键词）→ 命中则 resumeSession ← 接线
```

### 存储边界（三张表各司其职）

| 表 | 职责 | 本次变化 |
|---|---|---|
| `jarvis_adhoc_agents` | 临时工**聚合态实体**（按 domain 一行） | **新建** |
| `jarvis_claude_sessions` | 每次执行的 **session 明细**（详情钻取 + resume） | 不变 |
| `jarvis_recipes` | **正式小弟**（persistent 专家） | 加 `skills` 列 |

---

## 组件设计

### 1. Skill 基建

**加载方式**（两侧 query 都加）：
- `plugins: [{ type: 'local', path: <skills 根目录> }]`
- Jarvis（`llm.ts`）：`skills: 'all'`
- 小弟（`client.ts`）：`skills: recipe?.skills`（白名单；临时工无 recipe → 省略该选项或传空）

**skill 目录**（仓库内，全局共享，随代码走，不按 userId 隔离）：
```
src/jarvis/skills/
  promote-agent/
    SKILL.md
```

`SKILL.md` 用标准 frontmatter（`name`、`description`）。SDK 从 local plugin 目录发现 skill；`skills` 选项作为上下文过滤器控制哪些对模型可见。

**风险与验证**：`plugins` 是 SDK v0.3.193 明确支持的选项，`settingSources: []` 保持不变，不引入本地 `.claude/settings.json` 污染。落地后需浏览器端到端验证 Jarvis 能成功 `Skill` 调用 `promote-agent`。

### 2. recipe.skills 字段

- `AgentRecipe`（`src/shared/types.ts`）加 `skills: string[]`。
- `jarvis_recipes` 表加列：`ALTER TABLE jarvis_recipes ADD COLUMN IF NOT EXISTS skills TEXT DEFAULT '[]'`。
- `createRecipe`（`registry.ts`）写入；`rowToRecipe`（或等价读取处）解析 JSON。
- 晋升生成正式小弟时可带上相关 skill（初期可为空数组，后续按需填）。

### 3. 临时工独立存储

新表：
```sql
CREATE TABLE IF NOT EXISTS jarvis_adhoc_agents (
  id TEXT PRIMARY KEY,                    -- adhoc-{uuid8}
  user_id TEXT NOT NULL,
  domain TEXT NOT NULL,                   -- 聚合主键
  task_count INTEGER NOT NULL DEFAULT 0,  -- 晋升判断信号
  last_task_description TEXT NOT NULL,
  cwd TEXT,                               -- 门牌号（开发类仓库，可空）
  topics TEXT NOT NULL DEFAULT '[]',      -- 关键词累积（供复用匹配）
  last_session_id TEXT,                   -- 最近 SDK sessionId（供 resume）
  promoted INTEGER NOT NULL DEFAULT 0,    -- 已晋升则置 1
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jarvis_adhoc_user_domain ON jarvis_adhoc_agents(user_id, domain);
```

**写入逻辑**（新文件 `src/a2a/adhoc.ts` 的 `upsertAdhocAgent`）：
- 在 `client.ts` 收尾处（现调 `recordAgentSession` 的 line 280 附近），仅当 `!recipe`（临时工）时调用。
- 按 `(user_id, domain)` upsert：存在则 `task_count += 1`、更新 `last_task_description`/`last_session_id`/`topics`（合并去重）/`updated_at`；不存在则插入，`task_count = 1`。
- **domain 为空 → 跳过**（无法聚合也无法晋升，与现有 `clusterByDomain` 跳过空 domain 一致）。
- **`promoted=1` 的行 → 跳过累加**（该领域已有正式小弟，不该再有临时工数据混入）。
- **`last_session_id` 存原始 `sessionId`（真实 UUID），不存 `auto-` 兜底 ID**：`client.ts:278` 的 `finalSessionId` 拿不到真 sessionId 时会生成 `auto-...`，那种无法 resume。upsert 时应传原始 `sessionId`（可能为空字符串），空则该字段留空，复用时退化到 session 表匹配。

### 4. 晋升改造（skill + 工具）

**废除自动晋升**：删除 `action-dispatcher.ts:162` 的 `await evaluatePromotion(userId)`。`promoter.ts` 的 `evaluatePromotion`/`clusterByDomain` 退役；保留 `dominantCwd`、`buildDomainExpertPrompt`、`buildExpertDescription` 供 `promote_agent` 工具复用。

**`promote-agent` skill**（`src/jarvis/skills/promote-agent/SKILL.md`）——封装晋升的判断与话术：
- **何时推荐**：某 domain 的临时工 `task_count ≥ 3` 作为推荐信号（不是硬门槛，是给 Jarvis 的参考）。
- **推荐时机**：任务完成汇报时顺口带出、或用户问起团队/转正时。
- **推荐话术**：自然、不打扰，如"『X 领域』的临时工已经干了 N 次，要不要转正成正式小弟？"
- **转正流程**：用户确认后，调 `promote_agent` 工具执行。

**`promote_agent` 工具**（`tools.ts` 新增）：
- 入参：`domain`（要转正的领域）。
- 逻辑：读该 domain 的 adhoc 行 + 它的历史 session（`getSessionsByDomain`）→ 用 `buildDomainExpertPrompt`/`dominantCwd` 构造 recipe → `createRecipe(persistent=true)` → 把 adhoc 行标 `promoted=1`。
- 广播：`🎓 新小弟入队：「X专家」— 由 Sir 拍板转正`。

**改造 `get_team_stats`**（`tools.ts`）：temporary 分类从读 `jarvis_recipes` 的空集，改为读 `jarvis_adhoc_agents`（`WHERE promoted=0`），展示各 domain 的 `task_count` 和距推荐信号的差值。

### 5. 复用接线

`findMatchingSession`（`history.ts:58`，已存在但为死代码）接进 `client.ts` 派单前触发。

**注意现有签名不匹配**：当前签名是 `findMatchingSession(userId, description, recipeId)`，按 `recipe_id` 过滤 `jarvis_claude_sessions`。但临时工**没有 recipeId**（recipe 为 undefined）。因此需改造签名为按 **domain** 匹配：`findMatchingSessionByDomain(userId, domain, description)`，查 `jarvis_claude_sessions WHERE domain=$domain`（或直接读 `jarvis_adhoc_agents.last_session_id`），再用关键词重叠打分。保留或替换旧函数由实现阶段定，旧函数既是死代码可安全改。

接线逻辑：
- 仅对临时工（`!recipe`）且调用方未显式指定 `resumeSession` 时触发。
- 按 domain + 关键词（`extractKeywords`）匹配，命中（打分 ≥0.3）则设 `resumeSession`，agent 带记忆续跑。
- 数据源优先用 `jarvis_adhoc_agents.last_session_id`（同 domain 最近一次会话，最简单可靠），无则退化到 `jarvis_claude_sessions` 按 domain 打分匹配。
- 仅接受真实 UUID 格式 sessionId（`auto-` 开头的兜底 ID 不能 resume，与 `prompt.ts:164` 现有约束一致）。

**依赖说明**：`extractKeywords`（`history.ts` 现为模块私有）需 `export` 出来，供 `adhoc.ts` 的 `upsertAdhocAgent` 和复用打分共用。

---

## 数据流

**派临时工**：
```
create_task(assignee="技术调研", domain="技术调研")
  → executeSubTask → dispatchToAgent
    → getRecipe("技术调研") 未命中 → recipe = undefined
    → findMatchingSession(domain, desc) → 命中历史 → resumeSession
    → query({ ...无 skills 或空 })  执行
    → 收尾:recordAgentSession + upsertAdhocAgent(domain 累加)
```

**晋升**：
```
任务完成汇报 → Jarvis（promote-agent skill）看到 "技术调研" task_count=3
  → "Sir，技术调研这活儿临时工干了 3 次了，要不要转正？"
  → 用户："收了他"
  → Jarvis 调 promote_agent("技术调研")
    → createRecipe(name="技术调研专家", persistent=true, skills=[])
    → adhoc 行 promoted=1
    → 广播入队
```

## 错误处理

- `upsertAdhocAgent` 失败不阻断任务执行（`.catch(() => {})`，与现有 `recordAgentSession` 一致）。
- `promote_agent` 工具：domain 无对应 adhoc 行 → 返回"该领域暂无临时工记录"；已 `promoted=1` → 返回"该领域已有正式小弟"。
- skill 加载失败：不应导致 query 崩溃；若 `plugins` 路径不存在，SDK 应静默跳过（需验证）。

## 测试策略

**单元测试**：
- `upsertAdhocAgent`：首次插入 / 同 domain 累加 / domain 空跳过 / promoted 跳过。
- `promote_agent` 工具逻辑：读 adhoc + 构造 recipe 落库 + 标记 promoted。
- `findMatchingSession`：domain+关键词匹配打分、≥0.3 命中、无匹配返回 undefined。

**端到端（浏览器）**：
- skill 挂载后 Jarvis 能 `Skill` 调用 `promote-agent`。
- 派临时工 → `jarvis_adhoc_agents` 出现/累加行。
- 攒够信号 → Jarvis 主动推荐 → 用户确认 → 正式小弟入队、adhoc 标记 promoted、`get_team_stats` temporary 分类正确反映。
- 小弟侧 recipe.skills 白名单生效（派个带 skills 的正式小弟，验证它能用列出的 skill）。

## 实施顺序建议（供 writing-plans 参考）

1. **数据层**：`jarvis_adhoc_agents` 建表 + `jarvis_recipes` 加 skills 列 + 类型（`AgentRecipe.skills`、adhoc 类型）。
2. **临时工存储**：`upsertAdhocAgent` + client.ts 接线（写入）。
3. **复用接线**：`findMatchingSession` 接进 client.ts。
4. **skill 基建**：两侧 query 加 `plugins`+`skills`；recipe.skills 读写。
5. **晋升**：删自动晋升；`promote_agent` 工具；`promote-agent` skill；改造 `get_team_stats`。
6. **清理与验证**：`promoter.ts` 退役自动逻辑（保留构造函数）；全量测试；端到端。
