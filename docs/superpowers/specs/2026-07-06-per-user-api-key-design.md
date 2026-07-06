# Per-User API Key 配置 — 设计文档

**日期**: 2026-07-06
**状态**: 已 review 通过，进入实现计划

## 目标

让每个用户配置**一个或多个** LLM API 凭证（每个凭证 = API Key + Base URL + 模型名 + 能力档位），跑任务时用自己的凭证；未配置则回退平台默认。纯 BYOK（Bring Your Own Key）模型——平台不承担用户的 token 成本。

这是 Jarvis 商业化路径「阶段一：面向个人开发者」的核心前置功能。

### 前瞻：为动态模型切换预留

后续 Jarvis 将根据任务难易**动态切换模型**——简单任务用快而弱的模型，复杂任务用强模型。因此数据模型现在就设计成「一个用户多个凭证，每个带能力档位（tier）」，避免后续迁移表。

**范围切割**（重要）：
- **本次实现**：多凭证的存储、管理 UI、`is_default` 默认选择。`buildUserEnv` 接口预留 `tier?` 参数，但当前所有调用都不传 tier，一律走默认凭证。
- **未来实现**（不在本次范围）：Jarvis 大脑判断任务难易 → 派活时传入 tier → 自动选对应档位凭证。接口现在留好，选择逻辑以后再填，表和 resolver 无需再改。

## 背景与约束

### 为什么需要 Base URL 和模型名（不只是 Key）

Jarvis 通过 `@anthropic-ai/claude-agent-sdk` + `claude` CLI 派活，发出的是 **Anthropic `/v1/messages` 协议**。

国内用户大多买不到 Anthropic 官方 key，主要用 DeepSeek / Kimi / Qwen。这些 provider：
- **原生 API 是 OpenAI 格式**，SDK 直接发过去无法识别。
- 但都提供了 **Anthropic 兼容端点**。例如 DeepSeek：
  - OpenAI 端点：`https://api.deepseek.com`（不可用）
  - **Anthropic 端点：`https://api.deepseek.com/anthropic`（可用）**
- 模型名也不同：Anthropic 是 `sonnet`，DeepSeek 是 `deepseek-v4-flash` / `deepseek-v4-pro`。

因此对非 Anthropic 用户，必须能同时配置 **Base URL + 模型名**，否则「看起来能配、实际跑不通」。

三个字段全部必填（对配置了自定义凭证的用户而言）。

### 模型名不硬编码示例

DeepSeek 的 `deepseek-chat` / `deepseek-reasoner` 将于 2026-07-24 弃用。UI 占位符给当前有效值（如 `deepseek-v4-flash`）作提示即可，实际值由用户自由填写，不写死，避免过期。

## 架构

### 数据流

```
用户在设置弹窗填 { label, tier, apiKey, baseUrl, model }
  → POST /api/credentials （明文，仅传输时经 HTTPS）
  → 后端 addCredential()：apiKey 加密，其余明文
  → 存入 jarvis_user_credentials 表（一个用户可多行）

任务执行时：
  dispatchToAgent(userId) / rawLlmCall(userId)
  → buildUserEnv(userId, tier?)：按 tier（本次恒为空 → 走默认凭证）解析该用户凭证，解密 apiKey
  → 返回新的 env 对象（用户配了就带自定义凭证，没配就回退平台 agentEnv）
  → 作为 query() 的 options.env 参数传入（不碰全局 process.env）
```

### 并发隔离（关键安全属性）

**用户凭证全程活在单次调用的局部对象里，绝不写入全局状态。**

- `buildUserEnv(userId)` 每次返回一个**新对象**，只在函数内用 `{ ...agentEnv, ... }` 拼装，从不修改全局 `agentEnv` 常量，也从不写 `process.env`。
- 全局 `agentEnv` 始终只是只读的「平台默认基座」，被展开复制，原对象不动。
- `query()` 接收 env 作为参数，传给它 spawn 的子进程，进程间天然隔离。
- 执行链路（`dispatchToAgent`、`rawLlmCall`）每处都已带 `userId` 参数，「该用谁的 key」信息一路贯通，无需任何全局「当前用户」状态——而那种全局状态正是并发串号的根源，本设计不引入。

结论：A 用户和 B 用户并发跑任务，各自 `buildUserEnv` 返回独立对象，互不影响，不会串号。

**实现红线**：任何人不得把 `buildUserEnv` 改成写 `process.env` 或修改全局 `agentEnv`。

## 组件

### ① 存储层 — `jarvis_user_credentials` 表

沿用现有 `src/shared/db.ts` 的 `db.exec` + `CREATE TABLE IF NOT EXISTS` 幂等建表模式，新增：

```sql
CREATE TABLE IF NOT EXISTS jarvis_user_credentials (
  id          TEXT PRIMARY KEY,            -- uuid，每个凭证一行
  user_id     TEXT NOT NULL,               -- 非主键，一个用户可多行
  label       TEXT NOT NULL,               -- 用户可读名，如 "DeepSeek Pro"
  tier        TEXT NOT NULL DEFAULT 'standard',  -- fast | standard | strong（能力档位，稳定英文值）
  api_key_enc TEXT NOT NULL,               -- 加密后的 key，格式 iv:authTag:ciphertext（全 hex）
  base_url    TEXT NOT NULL,               -- 明文（端点地址，非密钥）
  model       TEXT NOT NULL,               -- 明文（模型名）
  is_default  INTEGER NOT NULL DEFAULT 0,  -- 每用户恰好一个默认凭证
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_user_credentials_user ON jarvis_user_credentials(user_id);
```

**扁平建模（方案 A）**：一个凭证 = 完整的 {apiKey, baseUrl, model} 三元组 + tier。DeepSeek 的 flash（快弱）和 pro（强）是**两行**，各存一份加密 key。允许不同 provider 混用（如 Kimi 当 fast、DeepSeek 当 strong）。key 重复存储是早期可接受的代价；未来若「换 key 要改多行」成为痛点再 normalize（YAGNI）。

- `api_key` 加密存；`base_url`、`model`、`tier`、`label` 明文（非密钥）。
- `tier` 存稳定英文值，UI 显示中文（快速/标准/强力）；是推荐集，不做硬约束。
- 一个用户可有 0 到多行；没有任何行 → 回退平台默认。
- `is_default`：每用户恰好一个为 1（应用层保证：设新默认时先清旧默认）。

### ② 加密模块 — `src/shared/crypto.ts`（新建）

- **算法**：AES-256-GCM（含完整性校验，防篡改）。
- **主密钥**：从环境变量 `SETTINGS_SECRET` 读，`scryptSync` 派生 32 字节。
- **缺失处理**：与现有 `JWT_SECRET`（`src/auth/auth.ts:5`）风格一致——未设则用 dev 默认值 + 打 warning，生产必须设。
- **导出**：
  - `encrypt(plaintext: string): string` → 返回 `iv:authTag:ciphertext`（全 hex）
  - `decrypt(payload: string): string` → 还原明文

### ③ 数据访问 — `src/auth/credentials.ts`（新建）

全部按 `userId` 隔离，风格对齐现有 `src/auth/users.ts`：

- `listCredentials(userId): Credential[]` — 返回该用户所有凭证，**apiKey 字段脱敏/不含明文**（供 API GET 用）。
- `resolveCredential(userId, tier?): { apiKey, baseUrl, model } | null` — 解密后返回，**仅后端内部使用**。逻辑见组件④。
- `addCredential(userId, { label, tier, apiKey, baseUrl, model, isDefault })` — 加密 apiKey，插入。若 isDefault 则先清该用户其它默认。
- `updateCredential(userId, id, { label?, tier?, apiKey?, baseUrl?, model?, isDefault? })` — 只更新传入字段；apiKey 未传则保留原值（不覆盖）。
- `deleteCredential(userId, id)` — 删除。若删的是默认且还有其它凭证，自动指定一个新默认。

### ④ env 注入改造 — `src/shared/config.ts` + 两处执行入口

**config.ts**：保留全局 `agentEnv` 作为平台默认基座；新增函数：

```ts
export function buildUserEnv(userId: string, tier?: string): Record<string, string> {
  const c = resolveCredential(userId, tier)  // 来自 credentials.ts
  if (!c) return agentEnv                      // 无凭证 → 回退平台默认
  return {
    ...agentEnv,
    ANTHROPIC_API_KEY: c.apiKey,
    ANTHROPIC_BASE_URL: c.baseUrl,
    ANTHROPIC_MODEL: c.model,
  }
}
```

**`resolveCredential(userId, tier?)` 选择逻辑**：
- 该用户无任何凭证 → `null`（回退平台默认）。
- 传了 `tier` → 该 tier 的凭证（若多个取默认优先）；无匹配 tier 则落到用户默认凭证。
- 未传 `tier`（本次所有调用的情况）→ 用户默认凭证（`is_default=1`）。

**两处注入点**（均已有 userId，本次均不传 tier）：
- `src/a2a/client.ts` `dispatchToAgent` — 小弟执行任务：`queryOptions.env = buildUserEnv(userId)`
- `src/jarvis/brain.ts` `rawLlmCall` — Jarvis 大脑思考：同样替换为 `buildUserEnv(userId)`

**未来**：动态切换时由大脑决定 tier 并传入 `buildUserEnv(userId, tier)`，此处签名无需再改。

**特殊 userId `'system'`**（Jarvis 回答小弟请示时，见 `brain.ts:28`）：无真实用户，`resolveCredential('system')` 查无记录 → 回退平台默认。行为合理，无需特判。

> 注意：config.ts 引入 credentials.ts、credentials.ts 引入 db，注意避免循环依赖。若 config.ts 被 db 间接依赖，则把 `buildUserEnv` 放到独立模块（如 `src/shared/user-env.ts`），config.ts 只保留 `agentEnv` 基座。实现时确认依赖方向。

### ⑤ API 端点 — 挂 `authMiddleware`，RESTful CRUD

- `GET /api/credentials` → `Credential[]`（**脱敏**：不含 key 明文，key 字段只返回是否已设/掩码）。
- `POST /api/credentials` → body `{ label, tier, apiKey, baseUrl, model, isDefault? }`，调用 `addCredential`。
- `PUT /api/credentials/:id` → body 同上（字段可选），调用 `updateCredential`；apiKey 未传则保留原值。
- `DELETE /api/credentials/:id` → 调用 `deleteCredential`。
- 全部按 `req.userId` 隔离，`:id` 必须属于当前用户（否则 404）。

### ⑥ 前端 — 设置弹窗（`web/src/`）

**入口**：Header 右上角（现 username + 登出处）加齿轮图标 ⚙️。点击开弹窗，遮罩层覆盖，点遮罩或 × 关闭。

**打开时**：`GET /api/credentials` 拉列表。

**弹窗布局：凭证列表 + 增改删**
- 列表：每行显示 `label` + tier 徽章（快速/标准/强力）+ 默认标记（★），行内有「编辑」「删除」「设为默认」操作。
- 顶部/底部一个「+ 添加凭证」按钮 → 展开新增表单。
- 空列表时显示「当前使用平台默认」提示。

**新增/编辑表单字段**：
| 字段 | 类型 | 占位符/说明 |
|---|---|---|
| 名称 label | text | 如「DeepSeek Pro」 |
| 档位 tier | select | 快速 / 标准 / 强力 |
| API Key | password | `sk-...`（编辑态显示 `••••••` + 「更换」，点击才变输入框） |
| Base URL | text | 提示「填 Anthropic 兼容端点，如 `https://api.deepseek.com/anthropic`」 |
| 模型名 | text | 提示「如 `deepseek-v4-flash`」 |

**交互逻辑**：
- **新增**（POST）：填齐字段提交；勾选「设为默认」则后端清旧默认。
- **编辑**（PUT）：只提交改动字段。若未点「更换」，**不提交 apiKey**（避免把真 key 覆盖成占位符 `••••••`）。
- **删除**（DELETE）：二次确认。删默认且还有其它凭证时，后端自动指定新默认。
- **设为默认**：单独 PUT `{ isDefault: true }`。
- **取消/关闭**：丢弃改动，不提交。

**边界**：填了 baseUrl/model 但 apiKey 为空 —— 保存不拦截（YAGNI），任务执行时自然报错，不在弹窗做复杂校验。

## 安全边界

- key 明文只在 `PUT` 时进后端 → 立即加密 → 落库。
- 任何查询接口永不回传 key 明文。
- 传输安全依赖部署层 HTTPS。
- 数据库中 key 加密存储（AES-256-GCM），DB 文件或备份泄露不直接暴露明文。

## 明确不做（YAGNI）

- **不做**存 key 时的「实时验证 key 有效性」（多烧一次 token + 加复杂度）——让用户跑任务时自然发现。
- **不做** provider 预设下拉（DeepSeek/Kimi/Qwen 自动填充）——等确认用户主要用哪几家再固化。当前用自由文本字段覆盖所有情况。
- **不做** token 用量计量/计费——那是后续独立功能（阶段二托管版的前置），本次只做凭证配置。
- **不做**动态模型切换的**选择逻辑**——本次只建好多凭证数据模型 + `tier` 字段 + `buildUserEnv` 的 `tier?` 接口口子；大脑按任务难易选 tier 的逻辑是后续功能。

## 涉及文件清单

| 文件 | 操作 |
|---|---|
| `src/shared/db.ts` | 加 `jarvis_user_credentials` 建表语句 + `idx_jarvis_user_credentials_user` 索引 |
| `src/shared/crypto.ts` | 新建（AES-256-GCM 加解密） |
| `src/auth/credentials.ts` | 新建（凭证 CRUD + `resolveCredential`） |
| `src/shared/config.ts`（或新 `user-env.ts`） | 加 `buildUserEnv(userId, tier?)`，注意循环依赖 |
| `src/a2a/client.ts` | `dispatchToAgent` 的 env 改 `buildUserEnv(userId)` |
| `src/jarvis/brain.ts` | `rawLlmCall` 的 env 改 `buildUserEnv(userId)` |
| `src/jarvis/agent.ts` | 加 `/api/credentials` CRUD 端点（GET/POST/PUT/DELETE） |
| `web/src/`（Header + 新弹窗组件 + api 封装） | 设置入口 + 凭证列表弹窗 UI |

## 验证

```bash
npx tsc --noEmit                 # 类型通过
npm start
# 1. 未配置用户：正常跑任务（回退平台 key）
# 2. 配置 DeepSeek（api.deepseek.com/anthropic + deepseek-v4-flash）：能跑通
# 3. 两个账号各配不同 key：并发跑任务，互不串号（检查 debug 日志的 env 来源）
# 4. GET /api/credentials 不含 key 明文
# 5. 一个用户配多个凭证：设默认、切默认、删默认后自动补默认都正确
```
