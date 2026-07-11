# Jarvis — 项目工作指南

私人 AI 管家。三层架构:**你(决策者) → Jarvis(管理者,调度团队) → 团队成员(执行者)**。
你只说"要什么",Jarvis 负责拆解、派活、协调、汇报。完整设计见 `docs/architecture.md`。

## 技术栈

TypeScript ESM(`"type": "module"`,import 带 `.js` 后缀)· Node 22 · Claude Agent SDK ·
A2A(`@a2a-js/sdk`)· Express · PostgreSQL(`pg`)· 前端 Vite + React 18。

## 命令

后端(仓库根目录):
- `npm run dev` — tsx watch 热重载启动(端口 **3000**)
- `npm start` — 单次启动
- `npm test` — vitest 跑一遍(**只有后端有测试**,前端无)
- `npm run test:watch` — vitest watch

前端(`web/` 目录):
- `npm run dev` — vite dev server(端口 **5180**)
- `npm run build` — `tsc -b && vite build`
- 改前端后**不要手动重启**,vite HMR 已生效

改动后的自检:后端 `npx tsc --noEmit` + `npx vitest run`;前端 `cd web && npx tsc --noEmit`。

## 架构指针(改代码先看这里)

后端 `src/`:
- `index.ts` — 入口:initDb → 启动 A2A server → CLI
- `jarvis/brain.ts` — Jarvis 大脑:`think()` 组装 system prompt + 上下文,调 LLM,解析 action
- `jarvis/prompt.ts` — 静态 system prompt(人设、决策规则、action 协议)
- `jarvis/action-dispatcher.ts` — 解析并执行 LLM 返回的 action(create_task / respond / cancel / send_message 等);后台跑子任务、广播进度
- `jarvis/orchestrator.ts` — 用户消息队列、会话状态机(buffering/thinking)、思考生命周期
- `jarvis/sse.ts` — `broadcast(type, content, userId)` 向前端 `/events` 推事件
- `jarvis/routes/` — HTTP 路由(chat / dashboard / agent)
- `a2a/client.ts` — Jarvis 向团队成员派单(`dispatchToAgent`,含 `onProgress` 逐 turn 回调)
- `task/manager.ts` · `task/scheduler.ts` — 任务/子任务 CRUD + 依赖编排
- `team/registry.ts` · `team/factory.ts` · `team/promoter.ts` — Agent Recipe 库、实例化、晋升
- `memory/everos.ts` — 长记忆(外部 EverOS API)
- `shared/db.ts` — PostgreSQL 连接 + 建表
- `shared/redact.ts` — 敏感 token 清洗

前端 `web/src/`:
- `App.tsx` — 路由(hash)、登录态、ChatView 两栏布局
- `components/MonitorPanel.tsx` — 右侧常驻执行监控栏(消费 SSE `subtask` 事件)
- `components/ExecutionModal.tsx` — 点击监控项放大查看轨迹(复用 `/api/task/:id`)
- `api/hooks.ts` — `useSSE` / `useChat` / `parseSubtaskEvent`

## 数据库

- 连接 `DATABASE_URL` 或默认 `postgresql://localhost:5432/jarvis`,表名前缀 `jarvis_*`
- **schema 演进用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`**,不写迁移脚本
- `initDb()` 用 advisory lock 序列化 DDL,避免并发启动死锁
- 直接用 `psql jarvis -tAc "..."` 查数据调试

## 关键约定

- **临时工 vs 正式小弟**:临时任务派给临时 agent(recipe 为空,走 adhoc);Jarvis 判断以后还会用 → 通过 `promote_agent` 工具晋升为常驻 recipe(`persistent=true`)。晋升是 **Jarvis 推荐 + 用户确认**,不自动晋升。
- **相似任务优先复用有经验的历史 agent**,而非每次全新创建(`findMatchingSession`)。
- **会话连续**:`getOrCreateSession` 总是复用最新会话,已去掉 4 小时 TTL。
- **cwd 填写**:Jarvis 生成子任务 cwd 可能幻觉(编错用户名)。两层防线——system prompt 注入真实 `userInfo/homedir/workspace`(brain.ts 的 runtimeEnv),派单前 `sanitizeCwd` 校验路径存在(cwd-guard.ts)。没把握就留空,小弟去用户工作区跑。
- **SSE 事件 JSON-in-content**:结构化事件(`subtask`/`artifact`)把 JSON 塞进 `content` 字段广播,前端 parse。

## 安全红线(勿违反)

- 用户配了自己的凭证后,平台的 `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_DEFAULT_*` 必须从 env 删除,不能泄漏给小弟进程。
- Token 清洗:`redactSecrets()` 只过滤喂给 **LLM 上下文**和发去 **EverOS** 的副本;落 DB 的聊天原文保留(用户可回看)。
- **Jarvis 的回复里不能把 token 复述出来**。

## 运行前提

- **依赖本机 claude CLI**:SDK 通过 `which claude` 找到二进制并 spawn(stdin/stdout stream-json)。没装 claude code CLI 无法运行。
- 环境变量见 `.env.example`(`ANTHROPIC_API_KEY`、`EVEROS_API_KEY`)。

## 搜代码

搜代码用 **semble MCP**(`search` / `find_related`),不要 spawn Agent/Explore。
