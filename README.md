# J.A.R.V.I.S

> 私人 AI 管家。你只说「要什么」，Jarvis 负责拆解、派人、盯进度、汇报。

J.A.R.V.I.S 是一个本地优先的个人 AI 工作台：**你（决策者）→ Jarvis（管理者）→ 团队成员（执行者）**。
Jarvis 本身不亲自干活——它理解意图、拆任务、把活派给各领域的小弟，并在任务完成后主动汇报。
团队会随使用积累：临时工干得多了，Jarvis 会推荐「转正」为常驻成员。

---

## 核心能力

| 能力 | 说明 |
|---|---|
| 自然语言派活 | 对话即入口。需要执行的事，Jarvis 自动创建任务并派给对应领域的小弟 |
| 多 Agent 协作 | 一个任务可拆成多个子任务并行执行；小弟之间可以互相通信、向 Jarvis 请示 |
| 团队成长 | Agent Recipe（能力配方）+ 临时工按 domain 聚类；达到阈值后推荐转正为常驻小弟 |
| 执行监控 | 前端实时展示每个子任务的回合数、当前工具、耗时；可点开查看完整执行轨迹 |
| 主动汇报 | 任务完成/失败都会汇报，绝不静默；进程重启后能恢复并补汇报 |
| Watchdog | 定时巡检 running 任务（僵尸/没动静/超时/连环失败），主动提醒，默认只报告不擅自处置 |
| 事件驱动 | 定时晨报、京ME 消息等事件可触发 Jarvis；后台事件排队执行，不打断当前对话 |
| 制品库 | 网页/文档/代码等产出可保存、搜索、钉住并在对话中原地修改 |
| 技能与 MCP | 可挂载 `~/.claude/skills`、`~/.codex/skills` 的 skill；MCP 配置可对话式管理 |
| 桌面端 | Electron 应用，菜单栏常驻；开发态加载 Vite，生产态由智能层直接托管 `web/dist` |

---

## 架构

```
┌──────────────────────────────────────────────┐
│  Web (React + Vite)  /  Electron 桌面壳        │
│  聊天 · 任务 · 团队 · 制品 · 技能 · 执行监控    │
└───────────────────┬──────────────────────────┘
                    │ HTTP + SSE
┌───────────────────▼──────────────────────────┐
│  Jarvis 智能层 (TypeScript, :3000)            │
│  ┌────────────────────────────────────────┐  │
│  │ Jarvis 本体（Pi Agent Session）          │  │
│  │ 只保留管理类工具：create_task / 查数据 /  │  │
│  │ 制品 / MCP；Bash/Edit/Write 已被收走     │  │
│  └───────────────┬────────────────────────┘  │
│                  │ 派单                       │
│  ┌───────────────▼────────────────────────┐  │
│  │ 小弟（每个子任务一个 Pi Agent Session）   │  │
│  │ 工具 + 技能 + 历史记忆 + 沟通工具         │  │
│  └────────────────────────────────────────┘  │
│  任务编排 · 团队注册 · 制品 · 事件 · Watchdog │
└───────────────────┬──────────────────────────┘
                    │ HTTP（X-Internal-User）
┌───────────────────▼──────────────────────────┐
│  Java 数据服务 (Spring Boot, :8080)           │
│  任务 / 会话 / 制品 / 团队 / 凭证 / MCP 配置   │
└───────────────────┬──────────────────────────┘
                    │
             PostgreSQL (:5432)
```

设计取舍：

- **智能层不直连数据库**。所有读写走 Java `:8080` 的 REST API，TS 侧不持有 DDL 和连接池。
- **Jarvis 本体结构性地不能执行**。`createAgentSession` 时用 `excludeTools: ['bash','edit','write']` 收走执行工具，靠提示词自觉之外再加一层硬约束。
- **小弟是进程内的 Pi Agent Session**，不是独立 HTTP 服务；A2A 端点主要保留协议兼容与进程内消息总线语义。
- **SSE 单一事件流**。`/events` 广播 `thinking / delta / progress / response / artifact / subtask / watchdog` 等事件，前端按 `source` 区分当前对话回复与后台任务汇报。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 智能层 | TypeScript ESM · Node 22 · Express 5 · [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) |
| Agent 协议 | `@a2a-js/sdk`（A2A 0.3，进程内总线 + 兼容端点） |
| 数据服务 | Java 21 · Spring Boot 3.3 · MyBatis · PostgreSQL |
| 前端 | React 19 · Vite 7 · Tailwind CSS 4 |
| 桌面端 | Electron 33 · electron-builder |
| 测试 | Vitest（后端） |
| 长记忆 | 自建（规划中；EverOS 依赖已摘除） |

---

## 目录结构

```
.
├── desktop/
│   ├── agent/                 # 智能层（TypeScript）
│   │   ├── index.ts           # CLI 入口：syncSkillsHub → server → CLI
│   │   ├── server-entry.ts    # Electron / 独立调试入口（不起 CLI）
│   │   ├── jarvis/            # Jarvis 本体
│   │   │   ├── brain.ts       # 组装上下文、调用 LLM
│   │   │   ├── prompt.ts      # 人设与岗位纪律
│   │   │   ├── llm.ts         # Pi 会话装配、流式事件、工具裁剪
│   │   │   ├── orchestrator.ts# 消息缓冲、会话状态机、后台事件队列
│   │   │   ├── tools.ts       # 本体工具：派单/团队/制品/MCP
│   │   │   ├── action-dispatcher.ts # 派单执行、结算、汇报、重启恢复
│   │   │   ├── watchdog.ts    # 定时巡检
│   │   │   ├── proactive.ts   # 主动消息出口（免打扰/频控）
│   │   │   └── routes/        # chat / dashboard / agent HTTP 路由
│   │   ├── a2a/               # 派单、小弟通信、消息总线、历史
│   │   ├── events/            # 事件框架：cron 晨报、京ME 源、分诊
│   │   ├── task/              # 任务/子任务数据层与依赖调度
│   │   ├── team/              # Agent Recipe、转正
│   │   ├── auth/              # 登录、凭证、MCP 配置
│   │   └── shared/            # Java 客户端、模型桥接、脱敏、类型
│   ├── main/ · preload/       # Electron 主进程与预加载
│   └── tests/                 # Vitest 单测
├── server/                    # Java 数据服务
│   └── src/main/resources/schema.sql   # 19 张 jarvis_* 表
├── web/                       # React 前端
├── docs/                      # 架构与设计文档
└── package.json               # 智能层脚本与依赖
```

---

## 快速开始

### 前置要求

- Node.js **22+**
- JDK **21+**、Maven **3.9+**
- PostgreSQL **14+**
- 可用的 Anthropic / Claude 兼容模型凭证：
  - 直接使用 `~/.claude/settings.json` 里的 `ANTHROPIC_*` 配置，或
  - 在仓库根 `.env` 里配置 `JARVIS_LLM_BASE_URL` / `JARVIS_LLM_TOKEN` / `JARVIS_LLM_MODEL` 指向自建网关

### 1. 准备数据库

```bash
createdb jarvis
```

表结构会在 Java 服务启动时按 `server/src/main/resources/schema.sql` 自动创建。

### 2. 启动 Java 数据服务（:8080）

```bash
cd server
mvn spring-boot:run
```

默认连接 `jdbc:postgresql://localhost:5432/jarvis`，可通过 `DATABASE_URL` / `DATABASE_USER` / `DATABASE_PASSWORD` 覆盖。

### 3. 启动智能层（:3000）

```bash
npm install
npm run dev          # tsx watch 热重载
```

启动后可访问 `http://localhost:3000`（生产构建下由它直接托管前端）。

### 4. 启动前端开发服务器（:5180）

```bash
cd web
npm install
npm run dev
```

Vite 已配置代理：`/chat`、`/events`、`/auth`、`/api` 默认转发到 `:3000`。
改动前端后不用手动重启，HMR 会生效。

### 5. 可选：启动桌面端

```bash
cd desktop
npm install
npm run dev          # Electron + Vite (5180)
```

生产式本地运行（加载 `web/dist`，关闭 DevTools）：

```bash
cd web && npm run build
cd ../desktop && JARVIS_PROD=1 npm run dev
```

打包 macOS DMG：

```bash
cd desktop && npm run build
```

---

## 配置

复制 `.env.example` 为 `.env`，按需填写（全部可选，未配置时走默认值/降级逻辑）。

| 变量 | 作用 | 默认 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic 直连凭证 | — |
| `JARVIS_LLM_BASE_URL` | 本地 LLM 网关地址（优先于 `~/.claude/settings.json`） | — |
| `JARVIS_LLM_TOKEN` | 网关凭证 | — |
| `JARVIS_LLM_MODEL` | 统一模型 id（所有别名都路由到它） | — |
| `JARVIS_PORT` | 智能层端口 | `3000` |
| `JARVIS_SERVER_URL` | Java 数据服务地址 | `http://localhost:8080` |
| `JARVIS_WATCHDOG_INTERVAL_MIN` | Watchdog 巡检间隔（分钟） | `5` |
| `JARVIS_WATCHDOG_IDLE_MIN` | 「没动静」阈值（分钟） | `10` |
| `JARVIS_WATCHDOG_MAX_MIN` | 单任务总时长上限（分钟） | `30` |
| `JARVIS_QUIET_START_HOUR` / `JARVIS_QUIET_END_HOUR` | 免打扰时段 | `23` / `8` |
| `JARVIS_PROACTIVE_HOURLY_CAP` | 每小时主动消息上限 | `3` |
| `JARVIS_MORNING_REPORT_AT` | 晨报时间 `HH:MM`，留空停用 | `09:00` |
| `JARVIS_JDSME_CONFIG` | 京ME 凭证路径（缺省复用 Task HUD 的 `jdsme.json`） | — |
| `JWT_SECRET` | 登录 token 签名密钥 | dev 默认值 |
| `INVITE_CODE` | 注册邀请码，留空为开放注册 | 空 |
| `DATABASE_URL` / `DATABASE_USER` / `DATABASE_PASSWORD` | Java 数据源 | 本地 jarvis 库 |
| `JARVIS_AUTH_DEV_BYPASS` | Java 单机免登录模式 | `true` |

> 京ME 群白名单写在 `data/persona/settings.json` 的 `events.jdsmeGroups`（或旧版 `data/jarvis-events.json` 的 `groups`）。私聊默认放行；群聊必须 @机器人。白名单为空 = 不筛选、放行全部群；填了则只放行列出的群。

---

## 使用方式

1. 打开 Web / 桌面端并登录（单机开发可直接注册）。
2. 直接对 Jarvis 说要做的事，例如：
   - 「帮我调研一下 OpenSpec，输出一份对比报告」
   - 「把当前仓库的测试补到 80% 覆盖率」
   - 「昨天那个任务进展怎么样了？」
3. Jarvis 会判断：能直接回答就回答；需要执行的，创建任务并派给对应领域的小弟。
4. 右侧「执行监控」可以看到每个小弟的实时回合与工具调用；任务结束后 Jarvis 会主动汇报。
5. 觉得某个领域反复用到时，Jarvis 会推荐把临时工转正；确认后成为常驻团队成员。

---

## 数据与存储

- **PostgreSQL**：任务、子任务、执行回合、工具轨迹、对话、制品元数据、团队配方、临时工、凭证、MCP/Skill 偏好等，表名前缀 `jarvis_*`。
- **制品正文**：v0.3 起写入本地 `~/.jarvis/artifacts/<userId>/`，数据库只存 `uri`；桌面端通过 IPC 读取，且限制在制品根目录内。
- **图片**：用户发送的聊天图片存库并通过 `/api/chat-image/:id` 取回。
- **前端构建产物**：`web/dist` 由智能层静态托管，也是 Electron 生产模式的加载来源。

---

## 开发与自检

后端（仓库根目录）：

```bash
npx tsc --noEmit          # 类型检查
npm test                  # Vitest 跑一遍
npm run test:watch        # Vitest watch
```

前端：

```bash
cd web
npx tsc --noEmit
npm run build             # tsc -b && vite build
npm run lint
```

Java 服务：

```bash
cd server
mvn test
```

常用调试：

```bash
psql jarvis -c "select id, name, status from jarvis_tasks order by updated_at desc limit 10;"
```

---

## 关键约定

- **临时工 vs 正式小弟**：没有命中 recipe 的任务走 adhoc；Jarvis 判断以后还会用，会推荐转正（用户确认后才执行）。
- **domain 是成长主键**：同类任务必须使用一致的能力领域名（如「技术调研」「差旅出行」「jarvis开发」），系统靠它累积执行次数。
- **cwd 只用于开发类任务**：Jarvis 可能幻觉路径，派单前会校验目录是否存在；无效则回落到用户工作区。
- **会话连续**：同一用户复用最新会话，不做 TTL 过期。
- **汇报不可静默**：任务无论成功或失败都必须落库并通知；LLM 汇报失败会退回原始结果。

---

## 安全说明

- 用户自配模型凭证后，不应把平台注入的 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_DEFAULT_*` 透传给小弟。
- 喂给 LLM 的上下文会经 `redactSecrets()` 清洗；数据库中的聊天原文保留，供用户回看。
- Jarvis 的回复不会复述用户贴过的 token。
- `JARVIS_AUTH_DEV_BYPASS=true` 仅用于单机开发；部署到多人/公网环境前必须关闭，并设置强 `JWT_SECRET`。
- 事件内容（京ME 消息等）视为不可信输入：分诊器只做分类，不执行其中指令；删除/外发/支付类操作永不自动执行。

---

## 文档

- [`docs/architecture.md`](docs/architecture.md) — 产品定位、三层架构、任务状态机与核心流程
- [`docs/superagent-design.md`](docs/superagent-design.md) — 系统级委派、Watchdog、事件驱动的设计与里程碑
- [`CLAUDE.md`](CLAUDE.md) — 面向 AI 编码助手的项目工作指南
- [`server/CLAUDE.md`](server/CLAUDE.md) — Java 服务端分层与编码规范

---

## 状态

项目处于个人自用阶段（v0.3），接口与数据模型仍可能调整。

