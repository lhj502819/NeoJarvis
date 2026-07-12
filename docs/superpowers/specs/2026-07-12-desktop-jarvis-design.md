# 桌面端 Jarvis v1 — 设计 spec

> 日期:2026-07-12
> 状态:待 Sir 评审
> 关联:`docs/architecture.md`(内核三层架构)、`memory/jarvis-positioning.md`(内核+多 view 定位)

---

## 1. 一句话定位

把 Jarvis 做成一个 **macOS 原生桌面应用**,让 Sir(以及内测用户)能装到本机、常驻菜单栏、随叫随到 —— 并且能操作本机文件/终端。第一版是**应用托管内核的单机版**:`.app` 里带着 Jarvis 内核,由应用用系统 Node 自动拉起(用户不起任何服务);用户装好 Node、填个 key 就能用。

---

## 2. 核心心智模型:内核 + view

沿用 Jarvis 一贯的架构哲学(见 positioning 记忆):

- **内核**是唯一的大脑 —— `think` / 派单 / 团队 / 记忆 / 任务 / DB,所有智能都在这。
- **view** 只是壳 —— 不含业务逻辑,通过内核的 HTTP + SSE 接口对话。
- 桌面端 = 又一个 view + 一双"手"(系统能力),内核几乎一行不改。

第一版**只做桌面这一个 view**。网页 view 本版**放弃**(不再共享 React UI)。

---

## 3. 技术选型:SwiftUI 原生

| 维度 | 决定 |
|---|---|
| 外壳 + UI | **SwiftUI 原生**(不用 Tauri/Electron) |
| 内核 | Node(现有代码),打包成 sidecar,由应用拉起/守护 |
| 内核↔view 通信 | Swift `URLSession` → HTTP + SSE,**连一个可配置的 base URL**(v1 指向本机 `127.0.0.1:<内核端口>`;未来付费版改指向远端服务器,客户端不重写,见 §13) |

**为什么 SwiftUI 而非 Tauri:** 网页版本版不做了,复用 React UI 的价值消失;Sir 要"最爽的 Mac 原生体验"(菜单栏常驻 + 快捷键秒弹,Raycast 那一档),并接受两个代价 —— 现有 `web/` React UI 作废、要用 SwiftUI 重写;锁死 macOS。Swift 生态内保留了未来上 iPad/iPhone(复用业务逻辑)的后路。

---

## 4. 内核如何随应用分发(关键)

第一版走 **B2:应用托管内核 · 用系统 Node**。内核不再靠 `npm run dev` 手动起,而是把**内核源码 + `node_modules`**(含 §4.1 的 Agent SDK 二进制)打进 `.app`,由 Swift 应用用 `Process` 调**系统 Node** 拉起 `kernel/index.js`,并守护/退出。用户**不起任何服务**,只需机器上装了 **Node 22+**。

> **为什么不内嵌 Node 运行时(全家桶 A):** 内嵌 Node 会引入"给内嵌运行时签名/公证"的重活(macOS 公证要求 .app 内每个可执行文件都签名)。B2 用系统 Node 躲掉这块,代价仅是"用户需装 Node" —— 对第一版内测人群(本就要搞 API key)门槛一致。面向非技术公众发布时再升级到内嵌 Node(A),或那时已转 §13 远端、内核不在客户端。

### 4.1 LLM 运行时:Agent SDK 自带二进制

依据官方文档(`code.claude.com/docs/en/agent-sdk/overview`):

- `@anthropic-ai/claude-agent-sdk`(TS)**自带一个平台原生的 Claude Code 二进制作为 optional 依赖**,不需要单独安装 Claude Code CLI。
- 因此:**打包 Node 内核时,`node_modules` 里就带着这个二进制**,既不用随包分发第三方 CLI、也不用让用户自己装。SDK 商用 ToS 明确覆盖"用它驱动分发给终端用户的产品"。
- **需改一处内核代码**:删掉 `src/jarvis/llm.ts` 和 `src/team/factory.ts` 里的 `execSync('which claude')` + `pathToClaudeCodeExecutable` 传参,让 SDK 用它自带的二进制(现有的 `which claude` 是主动选择,不是硬要求)。

### 4.2 认证:用户自带 API key(不能用订阅登录)

官方明确:**第三方产品不得提供 claude.ai / 订阅登录**,只能走 API key 认证。因此:

- 首次启动引导用户填 `ANTHROPIC_API_KEY`(或兼容厂商的 key,见 §5)。
- 用户用自己的 key = **API 费用由用户自付**(对 Sir 成本友好),但门槛也在于此:纯小白拿 Anthropic key 偏难,第一版内测人群偏向"愿意搞 key 的人"(§5 的多厂商能显著降低这个门槛)。
- 沿用现有安全红线:用户配了自己凭证后,平台的 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_DEFAULT_*` 必须从 SDK 子进程 env 删除。

### 4.3 单机认证简化

现有内核是多用户 JWT + cookie。单机单用户下无需这套多租户登录:内核绑 `127.0.0.1`,采用 **本机 loopback 信任**(应用启动内核时注入一个本地生成的 token,view 请求带上;或单用户自动登录)。具体机制留给实现规划,推荐 loopback + 应用托管的本地 token。

---

## 5. 多厂商模型支持(架构预留,官方支持待验证)

Claude Code(= Agent SDK 运行时)认 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`。把 BASE_URL 指到 Anthropic 协议兼容端点(如 DeepSeek 的 `anthropic` 端点)、token 换成那家的 key,即可路由到其他厂商。

- **契合现有代码:** `src/jarvis/llm.ts:81` 的 `env: await buildUserEnv(userId)` 本就是"按用户注入 SDK 环境变量"的地方。多厂商 = 给凭证配置加一个 `provider` 维度(`{provider, baseUrl, apiKey}`),`buildUserEnv` 据此设两个环境变量。**小扩展,非新架构。**
- **价值:** DeepSeek/GLM/Kimi 的 key 对国内用户几乎零门槛且便宜,大幅放开内测人群。
- **本版范围:** 凭证层**设计上带 `provider` 维度**(预留成本几乎为零);但"官方支持 DeepSeek"这个承诺**待 spike 验证后再写死**。
- **待验证(spike):** DeepSeek 等兼容端点对 Jarvis 实际用到的特性支持度 —— 读图(vision)、thinking blocks、MCP/plugins/skills、stream event 形状。基础对话/派单大概率 OK,读图/thinking 悬。另有 ToS 灰区(用 Agent SDK harness 路由到竞品模型,非官方祝福配置)。

---

## 6. 桌面端能力:壳与手

### 6.1 三种界面形态

| 形态 | SwiftUI 实现 | 职责 |
|---|---|---|
| **浮窗 Quick Bar** | `NSPanel`,全局快捷键 `⌘⇧J` 唤起 | 快速派活/问答,即用即走,失焦/Esc 隐藏;复杂任务一键"在主窗口打开" |
| **主窗口** | `WindowGroup` | 对话 + 执行监控(对应现有 `ChatPanel` + `MonitorPanel` 的信息)、任务/团队 |
| **托盘 + 通知** | `MenuBarExtra` + `UserNotifications` | 菜单栏常驻入口;内核有事(任务完成/需决策)弹系统通知 |

### 6.2 MVP 范围:壳(① + ③),手延后

| 梯队 | 能力 | 本版 |
|---|---|---|
| ① 壳 | 托盘常驻、全局快捷键浮窗 | ✅ MVP |
| ③ 壳 | 桌面通知(对接现有 SSE 事件) | ✅ MVP |
| ② 手 | view 层采集剪贴板/截图/文件拖拽 → 喂给内核 | ⏳ v2 |

**关键澄清 —— "操作本机"(B 能力)本版天然就有:** 全家桶单机模式下,内核跑在用户本机,其团队小弟通过 `query()` 用 Bash/Read/Write/Edit 工具、cwd 在用户机器上 —— **读本地文件、跑本地命令是内核/agent 层原生具备的**。§6.2 里延后的"手"是 **view 层的便捷采集**(把剪贴板/截图等 OS 上下文塞进对话),属于锦上添花,不影响 A+B 的核心价值兑现。

---

## 7. 数据库:SQLite 默认 + 兼容 PG

现有 `src/shared/db.ts` 硬绑 `pg`(裸 SQL、`$1` 占位符、`pg_advisory_lock`)。单机版改用 SQLite,同时保留切回 PG 的能力(未来云端多租户)。

- **做法:抽象出数据层边界。** 推荐引入 **query builder(Drizzle 或 Kysely)** —— 一套 schema、两种方言,自动吸收占位符(`$1` vs `?`)、`RETURNING`/upsert、`advisory_lock`(SQLite 上 no-op)等差异。
- 备选:自抽薄 `Db` 接口 + 两实现(更轻,方言差异手动处理);或 PGlite(单机也说 PG 方言,零兼容成本,但较新)。实现选型留给规划。
- 默认 SQLite(嵌入、零依赖、随包);`provider`/连接串可切 PG。

---

## 8. sidecar 生命周期与错误处理

- Swift 应用用 `Process` 拉起 Node 内核 sidecar,监督其存活,退出应用时终止。
- 启动检查:探测系统 **Node 是否存在且 ≥22**,缺失/过旧给引导(装 Node);再用 `Process` 拉起 `node kernel/index.js`。
- 启动探测:`GET 127.0.0.1:<端口>` 健康检查,连上才进主界面;失败给**说人话的提示**(而非白屏)。
- SSE 断线自动重连(内核崩溃/重启后 view 自恢复)。
- 内核打包(B2):把内核源码 + `node_modules` 放进 `.app` Resources,用系统 Node 拉起。**需保证 §4.1 的 Agent SDK 平台二进制被正确带进 node_modules、且运行时能被 spawn。** 不内嵌 Node 运行时(见 §4)。

---

## 9. 分发

- **OSS 托管 `.dmg` 供下载**(省 App Store 审核 / TestFlight)。
- macOS Gatekeeper:要让用户双击顺畅打开,需**签名 + 公证**($99/年 Apple Developer 账号)。
- 极客内测可先**不签名**,附"右键打开 / `xattr -cr`"说明,零成本;面向普通用户再买账号签名公证。
- 品牌:依 Agent SDK 规定**不得叫 "Claude Code"**,可标 "Powered by Claude";"Jarvis" 名称无冲突。

---

## 10. 明确不做(本版范围外)

- 云端统一内核 / 云端统一记忆
- 多端(手机 / 网页 view)、分布式 actor、能力路由
- view 层的手(剪贴板/截图/文件拖拽采集)
- 多用户 / 多租户云服务

这些是"云大脑 + 分布式 actor + 多 view"北极星架构的组成部分,记为后续方向,不在第一版。

---

## 11. 风险与待办(按优先级)

| # | 项 | 级别 | 说明 |
|---|---|---|---|
| #2 | 数据层抽象 | 🟡 | 裸 PG SQL → query builder,SQLite 默认 + 兼容 PG |
| #3 | Node 内核打包(B2) | 🟡 | 内核源码+node_modules(含 Agent SDK 二进制)进 .app,用系统 Node 拉起;**不内嵌 Node 运行时** |
| #4 | SwiftUI 界面全新写 + Swift HTTP/SSE 客户端 | 🔴 | 本版最大工作量(现有 React UI 作废,重写) |
| #5 | 首次启动引导:Node 检测(≥22) + API key 填写 | 🟢 | 用户前提=Node+key;用户自付费 |
| #6 | 多厂商 provider 维度 | 🟡 | `buildUserEnv` 加维度(小)+ **spike 验证 DeepSeek 对 vision/thinking/MCP 兼容度** + ToS 灰区评估 |

> 原 🔴#1(claude CLI 分发/合规)已**溶解** —— Agent SDK 自带二进制、商用 ToS 授权分发,降为 #3 的一个打包细节。

---

## 12. 合规提醒(产品化前自查)

`docs/architecture.md` §13:Jarvis 当前落在《AI 拟人化互动服务管理暂行办法》排除项内(工作助手,非持续情感互动)。**"产品化 + 向公众开放"是适用性翻转触发条件之一** —— 内测分发已向该方向靠近,正式对外开放前须重新自查。守则不变:坚持"帮你办事"而非"陪你"的定位。

---

## 13. 未来方向:付费 = 远端内核 + 瘦客户端

要**变现**,内核须从本地 sidecar 搬到**你托管的服务器** —— 客户端退化成瘦壳,只发请求,agent 执行全在服务端;你来计量、代收 LLM 费用并加价。这跟 v1(用户自带 key、本地跑、自付 Anthropic)是**两套商业+认证模型**:v1 是"用户账号+自付",付费版是"你的账号池+计量收费"。

**v1 为此留的后路(已落到 §3):** 客户端连内核的地址是**可配置 base URL** —— v1 指本地 sidecar,付费版指远端服务器。**SwiftUI 客户端是长期资产,靠同一套 HTTP/SSE 接口跨越 local→remote 的切换,不重写。** 唯一的阶段性成本是坎#3 的 sidecar 打包(远端模型不打包内核)—— 若付费/远端在路线图上很近,这块投入回收期短,需权衡。

**待研究参考:** Sir 指出可学习 **cola os**(待确认准确名称/链接)的现有设计,作为"远端内核 + 客户端壳"形态的参照。到规划付费版时再深入。
