# Per-User API Key 配置 — 设计文档

**日期**: 2026-07-06
**状态**: 设计已确认，待实现

## 目标

让每个用户配置自己的 LLM API 凭证（API Key + Base URL + 模型名），跑任务时用自己的凭证；未配置则回退平台默认。纯 BYOK（Bring Your Own Key）模型——平台不承担用户的 token 成本。

这是 Jarvis 商业化路径「阶段一：面向个人开发者」的核心前置功能。

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
用户在设置弹窗填 { apiKey, baseUrl, model }
  → PUT /api/settings （明文，仅传输时经 HTTPS）
  → 后端 setUserSettings()：apiKey 加密，baseUrl/model 明文
  → 存入 jarvis_user_settings 表（一个用户一行）

任务执行时：
  dispatchToAgent(userId) / rawLlmCall(userId)
  → buildUserEnv(userId)：查该用户设置，解密 apiKey
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

### ① 存储层 — `jarvis_user_settings` 表

沿用现有 `src/shared/db.ts` 的 `db.exec` + `CREATE TABLE IF NOT EXISTS` 幂等建表模式，新增：

```sql
CREATE TABLE IF NOT EXISTS jarvis_user_settings (
  user_id     TEXT PRIMARY KEY,
  api_key_enc TEXT,              -- 加密后的 key，格式 iv:authTag:ciphertext（全 hex）
  base_url    TEXT,              -- 明文（端点地址，非密钥）
  model       TEXT,              -- 明文（模型名）
  updated_at  TEXT NOT NULL
);
```

- `api_key` 加密存；`base_url`、`model` 明文（非密钥）。
- 一个用户一行，没配置就没这行。

### ② 加密模块 — `src/shared/crypto.ts`（新建）

- **算法**：AES-256-GCM（含完整性校验，防篡改）。
- **主密钥**：从环境变量 `SETTINGS_SECRET` 读，`scryptSync` 派生 32 字节。
- **缺失处理**：与现有 `JWT_SECRET`（`src/auth/auth.ts:5`）风格一致——未设则用 dev 默认值 + 打 warning，生产必须设。
- **导出**：
  - `encrypt(plaintext: string): string` → 返回 `iv:authTag:ciphertext`（全 hex）
  - `decrypt(payload: string): string` → 还原明文

### ③ 数据访问 — `src/auth/settings.ts`（新建）

全部按 `userId` 隔离，风格对齐现有 `src/auth/users.ts`：

- `getUserSettings(userId): { apiKey?: string; baseUrl?: string; model?: string }` — 解密后返回，**仅后端内部使用**。
- `setUserSettings(userId, { apiKey?, baseUrl?, model? })` — 加密 apiKey 后 upsert。只更新传入的字段。
- `clearUserApiKey(userId)` — 清除该用户凭证（回退平台默认）。

### ④ env 注入改造 — `src/shared/config.ts` + 两处执行入口

**config.ts**：保留全局 `agentEnv` 作为平台默认基座；新增函数：

```ts
export function buildUserEnv(userId: string): Record<string, string> {
  const s = getUserSettings(userId)   // 来自 settings.ts
  if (!s.apiKey) return agentEnv       // 未配置 → 回退平台默认
  return {
    ...agentEnv,
    ANTHROPIC_API_KEY: s.apiKey,
    ANTHROPIC_BASE_URL: s.baseUrl ?? '',
    ANTHROPIC_MODEL: s.model ?? '',
  }
}
```

**两处注入点**（均已有 userId）：
- `src/a2a/client.ts` `dispatchToAgent` — 小弟执行任务：`queryOptions.env = buildUserEnv(userId)`
- `src/jarvis/brain.ts` `rawLlmCall` — Jarvis 大脑思考：同样替换为 `buildUserEnv(userId)`

**特殊 userId `'system'`**（Jarvis 回答小弟请示时，见 `brain.ts:28`）：无真实用户，`getUserSettings('system')` 查无记录 → 回退平台默认。行为合理，无需特判。

> 注意：config.ts 引入 settings.ts、settings.ts 引入 db，注意避免循环依赖。若 config.ts 被 db 间接依赖，则把 `buildUserEnv` 放到独立模块（如 `src/shared/user-env.ts`），config.ts 只保留 `agentEnv` 基座。实现时确认依赖方向。

### ⑤ API 端点 — 挂 `authMiddleware`

- `GET /api/settings` → `{ hasApiKey: boolean, baseUrl: string, model: string }`
  - **绝不回传 key 明文**，只告知「配没配」+ 非密钥字段。
- `PUT /api/settings` → body `{ apiKey?, baseUrl?, model? }`，调用 `setUserSettings`。
- `DELETE /api/settings/api-key` → 调用 `clearUserApiKey`。

### ⑥ 前端 — 设置弹窗（`web/src/`）

**入口**：Header 右上角（现 username + 登出处）加齿轮图标 ⚙️。点击开弹窗，遮罩层覆盖，点遮罩或 × 关闭。

**打开时**：`GET /api/settings` 拉状态，按 `hasApiKey` 渲染两种情况。

**字段**（三个，均必填）：
| 字段 | 类型 | 占位符/说明 |
|---|---|---|
| API Key | password | `sk-...` |
| Base URL | text | 提示「填 Anthropic 兼容端点，如 `https://api.deepseek.com/anthropic`」 |
| 模型名 | text | 提示「如 `deepseek-v4-flash`」 |

**交互逻辑**：
- **未配置（hasApiKey=false）**：三个空输入框；状态显示「当前使用平台默认」。
- **已配置（hasApiKey=true）**：状态显示「已配置 ✓」；API Key 显示占位符 `••••••` + 「更换」按钮（点击才变输入框）；baseUrl、model 回显（非密钥）。
- **保存**（PUT）：只提交用户实际改动的字段。若已配置且未点「更换」，**不提交 apiKey**（避免把真 key 覆盖成占位符）。
- **清除**（仅已配置显示，DELETE）：二次确认后清除，回到未配置态。
- **取消/关闭**：丢弃改动，不提交。

**边界**：填了 baseUrl/model 但没填 apiKey —— 保存不拦截（YAGNI），让任务执行时自然报错，不在弹窗做复杂校验。

## 安全边界

- key 明文只在 `PUT` 时进后端 → 立即加密 → 落库。
- 任何查询接口永不回传 key 明文。
- 传输安全依赖部署层 HTTPS。
- 数据库中 key 加密存储（AES-256-GCM），DB 文件或备份泄露不直接暴露明文。

## 明确不做（YAGNI）

- **不做**存 key 时的「实时验证 key 有效性」（多烧一次 token + 加复杂度）——让用户跑任务时自然发现。
- **不做** provider 预设下拉（DeepSeek/Kimi/Qwen 自动填充）——等确认用户主要用哪几家再固化。当前用自由文本字段覆盖所有情况。
- **不做** token 用量计量/计费——那是后续独立功能（阶段二托管版的前置），本次只做凭证配置。

## 涉及文件清单

| 文件 | 操作 |
|---|---|
| `src/shared/db.ts` | 加 `jarvis_user_settings` 建表语句 |
| `src/shared/crypto.ts` | 新建（AES-256-GCM 加解密） |
| `src/auth/settings.ts` | 新建（数据访问） |
| `src/shared/config.ts`（或新 `user-env.ts`） | 加 `buildUserEnv`，注意循环依赖 |
| `src/a2a/client.ts` | `dispatchToAgent` 的 env 改 `buildUserEnv(userId)` |
| `src/jarvis/brain.ts` | `rawLlmCall` 的 env 改 `buildUserEnv(userId)` |
| `src/jarvis/agent.ts` | 加 3 个 `/api/settings` 端点 |
| `web/src/`（Header + 新弹窗组件 + api 封装） | 设置入口 + 弹窗 UI |

## 验证

```bash
npx tsc --noEmit                 # 类型通过
npm start
# 1. 未配置用户：正常跑任务（回退平台 key）
# 2. 配置 DeepSeek（api.deepseek.com/anthropic + deepseek-v4-flash）：能跑通
# 3. 两个账号各配不同 key：并发跑任务，互不串号（检查 debug 日志的 env 来源）
# 4. GET /api/settings 不含 key 明文
```
