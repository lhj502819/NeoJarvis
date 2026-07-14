# 桌面端 Jarvis v0.3 — Client-Server 架构设计 spec

> 日期:2026-07-14
> 状态:待 Sir 评审
> 前置:v0.1(现有 Web + PG 单机形态)· v0.2(Aurora UI + 技能体系)
> 作废:`docs/superpowers/specs/2026-07-12-desktop-jarvis-design.md` 的 SwiftUI + Node sidecar 方案。本 spec 直接跳过"本地 sidecar",走 Client-Server 分离。

---

## 1. 一句话定位

Jarvis 桌面 = **Electron 客户端(执行智能 + 承接 OS 权限)** + **CloudBase 云端服务器(数据/账号/多设备协同)**。用户在本机跑 agent 碰自己的文件/终端,数据存在自己的云账号里,多台设备登同一个账号能互看。

---

## 2. 心智模型:客户端跑智能,服务端只管数据

沿用 Jarvis 内核+多 view 哲学(见 positioning 记忆),但**分层重画**:

```
┌─────────────────────────────────────────────────────────────┐
│ Electron 客户端(用户 Mac)                                   │
│                                                             │
│  渲染进程 (web/ React,复用 v0.2 Aurora UI)                 │
│    ↕ IPC                                                    │
│  主进程 (Node,原 src/ 的智能层)                            │
│    · Jarvis brain(think / 派单 / 决策)                     │
│    · Agent SDK query()  —— 跑在本机,碰本机文件             │
│    · orchestrator / action-dispatcher / SSE bridge          │
│    · BYOK from keychain(用户自付 API 费)                   │
│    · 内存缓存 recipes/tasks(重启失效,不落地)               │
└────────────────────────┬────────────────────────────────────┘
                         │ REST + SSE (HTTPS)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ CloudBase 云托管服务器                                       │
│                                                             │
│  · 认证:CloudBase Auth(微信 / 邮箱 / OAuth)               │
│  · CRUD API:tasks / subtasks / recipes / messages /        │
│                artifacts / turns                            │
│  · SSE /events:跨设备同步 + push notification              │
│  · MySQL(体验版,后续可升 Postgres)                        │
│  · 对象存储(可选,大 artifact)                             │
└─────────────────────────────────────────────────────────────┘
```

**核心分层原则:**

| 归属 | 内容 | 判据 |
|------|------|------|
| **客户端** | brain / SDK / agent 执行 / 工具调用 / BYOK | 碰 OS(Bash/Read/Write)必须在客户端;API key 不上传服务端 |
| **服务端** | 数据 / 认证 / 跨设备协同 / recipe 分发 | 需要跨设备可见的都在服务端 |
| **纯 UI** | 渲染 / 交互 | 走 IPC 或 REST 从客户端主进程/服务端拿数据 |

---

## 3. 关键决策(评审确认)

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| D1 | 同步策略 | **服务端为唯一真相,客户端直读 API** | 无本地 DB / 无同步冲突,实现最简;网络代价可接受 |
| D2 | subtask turns 存储 | **完整上传服务端** | 多设备回看执行轨迹;存储成本值得 |
| D3 | BYOK 存储 | **客户端本地(keychain)** | 服务端拿不到明文,零信任 |
| D4 | Recipe 分发 | **服务端下发** | 系统 recipe 升级不需要重发 app |
| D5 | 通信协议 | **REST + SSE** | SSE 承担跨设备通知 + Jarvis 流式 token |
| D6 | Artifact 存储 | **全上服务端** | 多设备互看;超大文件走对象存储 |
| D7 | 部署 | **CloudBase 云托管** | Docker + PG/MySQL + SSE + Auth + HTTPS 一站式 |
| D8 | DB | **MySQL(体验版)** | PG 高级特性(JSONB/全文/Array)现在一个没用;体验版够;适配器保留切 PG 的能力 |
| D9 | 实例策略 | **最小实例=1(常驻)** | 无冷启动,SSE 长连接稳定 |
| D10 | 多用户 | **完整多用户** | 保留 CloudBase Auth 用户体系,面向公众发布时不重写 |
| D11 | 认证机制 | **CloudBase Auth(微信 / 邮箱)** | 免自建 JWT,享现成 OAuth |

---

## 4. 客户端/服务端边界(现有 src/ 拆分明细)

### 4.1 服务端(独立仓库或 monorepo `packages/server`)

| 模块 | 来源 | 说明 |
|------|------|------|
| `src/shared/db.ts` + `db-driver.ts` | src/shared | 改 MySQL 驱动;详见 §5 |
| `src/task/manager.ts` · `scheduler.ts` | src/task | 任务/子任务 CRUD,只做存储,不派活 |
| `src/team/registry.ts` · `promoter.ts` | src/team | Recipe CRUD;`factory.ts` 里"实例化 agent"部分**留客户端** |
| `src/jarvis/skill-prefs.ts` | src/jarvis | 技能启禁黑名单 |
| `src/jarvis/state.ts` | src/jarvis | Jarvis 人格状态(mood/energy) |
| `src/jarvis/routes/*.ts` | src/jarvis/routes | Express 路由 —— CRUD 保留,`chat.ts` 里的调 LLM 部分挪走 |
| `src/auth/*` | src/auth | 改用 CloudBase Auth SDK 验证 token,不再自建 bcrypt+cookie |
| `src/memory/everos.ts` | src/memory | EverOS 代理 —— 保留,提供 `/api/memory/*` |
| `src/a2a/server.ts` | src/a2a | A2A server 端(Jarvis 接收小弟回执)—— 服务端只做转发 |

### 4.2 客户端主进程(`packages/desktop/main`)

| 模块 | 来源 | 说明 |
|------|------|------|
| `src/jarvis/brain.ts` | src/jarvis | Jarvis 思考;调 LLM SDK |
| `src/jarvis/llm.ts` | src/jarvis | 调 Anthropic SDK,读本地 keychain 拿 API key |
| `src/jarvis/action-dispatcher.ts` | src/jarvis | 解析/执行 action;派单调用 team/factory |
| `src/jarvis/orchestrator.ts` | src/jarvis | 消息队列 / 会话状态机 |
| `src/team/factory.ts` | src/team | 实例化 agent(调 SDK query),小弟跑在客户端 |
| `src/a2a/client.ts` | src/a2a | Jarvis 向小弟派单 |
| `src/jarvis/plugins/skills-hub/` | src/jarvis/plugins | 本机聚合 Claude/Codex skills |

**关键调用流程**:
1. 用户在渲染进程发消息 → IPC → 主进程 orchestrator
2. Brain 调本地 SDK think 出 action → 通过 HTTP POST **上报**到服务端 API(`POST /api/tasks`, `POST /api/subtasks`)
3. 主进程 fork 小弟 agent 进程,SDK query() 跑本地任务
4. 小弟每 turn 完成 → 上报 `POST /api/subtasks/:id/turns` → 服务端存 → SSE 广播给所有该用户在线的客户端
5. 客户端渲染进程订阅 `/events`,收到 SSE 事件更新 UI

### 4.3 渲染进程(`packages/desktop/renderer`,复用 web/)

保持 v0.2 Aurora UI,几乎不动。有 2 处小改:
- `api/client.ts` 的 baseURL 支持环境变量注入(dev 用 localhost,prod 用云端)
- 登录页替换为 CloudBase Auth SDK 组件

---

## 5. 数据库:MySQL(体验版)+ 兼容 PG 的薄适配器

### 5.1 现状与差异

**现有代码 PG 依赖(实测扫描)**:

| 差异点 | 数量 | 处理 |
|--------|------|------|
| `$1/$2` 占位符 | 302 处 | 适配器统一翻译成 `?`(0 侵入消费代码) |
| `SERIAL PRIMARY KEY` | 2 处(`jarvis_claude_sessions.id` / `user_jarvis_messages.id`) | DDL 改 `INTEGER AUTO_INCREMENT` |
| `ADD COLUMN IF NOT EXISTS` | 10 处 | catch 吞重复列错误(0 侵入) |
| `ON CONFLICT ... DO UPDATE` | 2 处(`state.ts:68` / `skill-prefs.ts:18`) | 改 `INSERT ... ON DUPLICATE KEY UPDATE`,或适配器语义翻译 |
| `pg_advisory_lock` | 1 处(建表锁) | MySQL 用 `GET_LOCK('name', timeout)`;适配器封装 |
| `BIGINT`/`TEXT` | 若干 | MySQL 兼容 |
| `information_schema` | 只测试用 | MySQL 兼容 |
| `RETURNING` | 0 处 | 无 |
| JSONB / Array / GIS / 全文 | 0 处用 | 未用 PG 高级特性 |

**结论:** PG 只有 5 类共 15 处差异,适配器 + 1 处 DDL + 2 处 SQL 手改就完事。

### 5.2 适配器方案

**新增 `src/shared/db-driver.ts`**(思路继承已作废的 Plan A):

```ts
interface Db {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>
  exec(sql: string): Promise<void>
}

// 按 DATABASE_URL 前缀选驱动
// mysql://... → MysqlDriver(mysql2)
// postgres://... → PgDriver(pg,保留能力,未来升级付费版切回)

class MysqlDriver implements Db {
  // $1 → ? 占位符翻译
  // ADD COLUMN IF NOT EXISTS → ADD COLUMN + catch dup-column
  // ON CONFLICT DO UPDATE → ON DUPLICATE KEY UPDATE
  // pg_advisory_lock → GET_LOCK
}
```

**消费文件 0 侵入**——110 处 `pool.query(sql, params)` 一行不改。

### 5.3 未来切 PG 的路径

任何时候升 CloudBase 付费版(199 元/月起,含 Postgres):
1. 改 `DATABASE_URL` 前缀 `mysql://` → `postgres://`
2. 用 `pg_dump` + `pgloader` 一次性迁数据
3. 应用代码零改动

**PG 值得升级的信号**:
- 需要 JSONB 索引查询(比如按 `turn.tools[].name` 过滤)
- 需要全文搜索(chat 记录搜索)
- 需要 CTE / Window function(复杂报表)

现在这些一个都不需要。**MySQL 足够 v0.3**。

---

## 6. API 契约概要

### 6.1 REST(所有请求带 CloudBase Auth token)

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/auth/callback` | CloudBase 登录回调,换后端 session |
| GET | `/api/tasks?since=` | 拉任务列表(增量) |
| POST | `/api/tasks` | 客户端创建任务(brain 派单后调用) |
| PATCH | `/api/tasks/:id` | 改状态 |
| POST | `/api/subtasks/:id/turns` | 上报单个 turn 内容(高频) |
| GET | `/api/recipes` | 系统 recipe + 用户 recipe |
| POST | `/api/recipes` | 用户晋升 adhoc → 常驻 |
| GET/POST | `/api/artifacts` | 制品 CRUD;大内容 body 直接 upload |
| GET/POST | `/api/messages` | 用户↔Jarvis 对话记录 |
| GET/POST | `/api/skills/prefs` | 技能启禁黑名单 |
| GET/PATCH | `/api/state` | Jarvis 人格状态 |

### 6.2 SSE `/events`

事件类型(保留现有 `broadcast(type, content)` 语义):
- `chat.stream` —— Jarvis 流式 token(**同设备**回显,跨设备只推终版)
- `subtask.updated` —— subtask 状态变化
- `subtask.turn` —— 新一 turn 完成
- `artifact.created` —— 新制品
- `task.completed` —— 任务终结

**注意**:agent 跑在客户端,turn 事件从客户端上传 → 服务端广播 → **所有同用户在线设备**接收。同一台机器上,主进程可以走 IPC 直推渲染,不必绕服务端一圈(优化项)。

---

## 7. 认证:CloudBase Auth

- 客户端启动 → 打开 CloudBase Auth 登录页(微信/邮箱)→ 拿到 token
- 主进程存 token 到 keychain
- REST 每次请求带 `Authorization: Bearer <token>`
- 服务端用 CloudBase SDK 验证 token → 拿到 userId,注入 `req.userId`
- 保留现有 `authMiddleware` 骨架,只换验证实现

**用户表**:
- 保留 `jarvis_users` 表映射 `cloudbase_uid → 内部 userId`
- 首次登录自动创建对应记录

**BYOK 存储**:
- 完全在客户端 keychain,**不上传服务端**
- 主进程调 SDK 时读 keychain
- 换设备需重新填 key

---

## 8. Electron 打包

### 8.1 目录结构

```
packages/
├── server/         # 服务端(Docker 部署到 CloudBase)
│   ├── src/       # 原 src/ 的服务端部分(§4.1)
│   ├── Dockerfile
│   └── package.json
├── desktop/       # Electron 应用
│   ├── main/      # 主进程(§4.2)
│   ├── preload/   # preload 脚本
│   └── package.json
└── web/           # 渲染层(§4.3,vite 构建后 dist/ 打进 desktop)
```

### 8.2 主进程直连内核(D1 决策)

Electron main 进程 `require('./main/index.js')` 直接 spawn Jarvis brain,不走 sidecar 子进程。好处:
- 省一次进程创建
- 无 sidecar 生命周期问题
- Agent SDK 二进制随 Electron 打包(需 electron-rebuild 处理 native modules)

### 8.3 打包工具

- `electron-builder` 出 `.dmg`(macOS only)
- 用户机需装 Apple Developer 证书才能签名公证(内测可 `xattr -cr` 绕过)
- Auto-updater(electron-updater)从自建 OSS/GitHub Releases 拉更新

### 8.4 IPC 边界

- 渲染进程 → 主进程:`ipcMain.handle('chat.send', ...)`
- 主进程 → 渲染进程:`webContents.send('sse.event', ...)`
- 渲染进程不能直接访问 Node API(contextIsolation: true)

---

## 9. CloudBase 部署

### 9.1 云托管配置

- 镜像:`packages/server` 构建的 Docker
- 实例:最小 = 1(常驻,无冷启动)
- 规格:0.25 核 0.5GB(起步,按需扩)
- 域名:CloudBase 自动 HTTPS
- 环境变量:`DATABASE_URL`(MySQL)/ `EVEROS_API_KEY` / `CLOUDBASE_APPID` 等

### 9.2 MySQL 配置

- 云开发体验版数据库
- 表名前缀 `jarvis_*` / `user_jarvis_*` 保持不变
- 建表 DDL 由服务端 `initDb()` 首启动执行

### 9.3 预估月成本

- 云托管 0.25 核常驻:约 20-30 元
- MySQL 体验版:免费额度内
- 流量:内测规模可忽略
- **合计约 20-50 元/月** —— 内测阶段可接受

---

## 10. 风险与坑

| # | 项 | 级别 | 说明 |
|---|----|------|------|
| R1 | Agent SDK Node 版本 vs Electron 内嵌 Node ABI 不匹配 | 🔴 | Native module(better-sqlite3 等)需 electron-rebuild;需 spike |
| R2 | SSE 长连接稳定性 | 🟡 | CloudBase 云托管 SSE 支持但超时时长未明确;客户端自动重连兜底 |
| R3 | MySQL 迁移的 2 处 ON CONFLICT | 🟢 | 手改小事,但要单测覆盖 |
| R4 | agent 跑客户端 = 用户机器负载 | 🟡 | 用户机 CPU/内存要撑得住;正式发布前压测 |
| R5 | BYOK 首启引导 UX | 🟡 | 用户拿 API key 门槛;可预配 preset(DeepSeek 兼容 Anthropic 端点)降门槛 |
| R6 | Agent SDK 商用 ToS 灰区(第三方模型路由) | 🟡 | v1 只承诺 Anthropic;DeepSeek 支持"待验证",不在承诺范围 |
| R7 | macOS 签名公证费 | 🟢 | $99/年 Apple Dev;内测不签名走 xattr |
| R8 | 服务端和客户端两个 repo 的类型共享 | 🟡 | monorepo 共用 types 包,或 spec-first(OpenAPI/tRPC) |

---

## 11. 明确不做

- iOS / Android 客户端
- Web 端(v0.2 web/ 只作为 Electron 渲染层复用,不再对外提供纯网页版)
- 服务端跑 agent(agent 必须在客户端 = 用户 OS 权限所在处)
- 本地 SQLite 离线模式(选 D1 服务端唯一真相就放弃了)
- 多客户端主动同步冲突解决(唯一真相下不存在冲突)

---

## 12. 未来路径

**近期**(v0.3 后):
- iOS/Android 客户端(纯 UI,复用同一套 REST/SSE)—— agent 在云端由用户其他设备代跑,或降级为"只看/只派"

**远期**(变现):
- 转"服务端跑 agent"模式(付费池)—— 客户端退化成瘦壳,你代收 LLM 费用加价
- 现在的架构 base URL 可配置,客户端不重写即可切远端

---

## 13. Plan 拆分(v0.3 实现总纲)

本 spec 只画架构。具体实现拆 3 个独立 Plan,可并行也可串行:

- **Plan A · 服务端拆离**:packages/server 独立;MySQL 适配器;CloudBase Auth 接入
- **Plan B · Electron 壳**:packages/desktop main/preload;IPC 桥;打包 dmg
- **Plan C · 客户端接内核**:brain/orchestrator 挪主进程;调服务端 API;SSE 桥

依赖关系:C 依赖 A(需要服务端 API 契约稳定)+ B(需要 Electron 骨架)。**推荐顺序 A → B → C**。

---

## 14. 合规提醒

沿用 v0.1:Jarvis 落在《AI 拟人化互动服务管理暂行办法》排除项内(工作助手)。**产品化 + 向公众开放**是适用性翻转触发条件——正式对外前须重新自查。守则:"帮你办事"而非"陪你"。

BYOK 客户端存储 + 服务端不留明文 key,天然合规更低风险。
