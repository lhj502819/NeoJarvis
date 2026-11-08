# superagent-v2 设计：上下文机制 + 双车道 + 审批流

参照 [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) 的机制，分六期（P0~P6）依次实现。
每期独立可交付、可验收、单独 commit+push。

## 0. 硬约束与已定决策

- **运行时状态一律进 PostgreSQL（经 Java REST），不再写 JSON 文件。** 新增通用文档表 `jarvis_agent_docs`
  承接原 JSON 侧车与后续新状态（P0 落地并迁移存量）。`config/defaults/**` 是随代码发布的模板，保持文件；
  `data/persona/**` 用户配置在 P4 随配置系统一起迁移。
- **双车道**：行云卡片 = 现成 Mandate（存在即授权，免评估直 accept）；京ME群聊 = 澄清车道（模糊不建单）。
- **京ME私聊不进 Thread 体系**，保持现有对话流。
- **Thread ↔ Task 多对多**；京ME群 Thread 划分 v1 规则：显式派发那一刻开 Thread（触发消息+其引用/回复链），
  其余消息归"群杂流"走 Gate；handback 是误判安全网。
- **反问轮不建 task**；意图确立那轮的 create 才是接单。
- 不搬 dsh 的 Policy/Mandate/Eval 完整域模型，只借机制；watchdog 职责不变（运行中任务健康），数据拉取是 Source 的事。

## P0 — 数据库状态基建（本文档约束的落地）

**做什么**
1. Java：`jarvis_agent_docs` 表（user_id, kind, doc_key, data JSONB, 唯一(user_id,kind,doc_key)，id 自增保证插入序）
   + `AgentDocMapper` + `AgentDocService` + `AgentDocController`：
   `GET /api/docs/{kind}?prefix=&limit=`（按 id 倒序）/ `GET /api/docs/{kind}/{key}` / `PUT` upsert / `DELETE`。
2. TS：`shared/docs.ts`（docGet/docPut/docDelete/docList，走 server-client，X-Internal-User）。
3. 迁移存量侧车（导出 API 不变，内部换存储；首次读取时从旧 JSON 导入一次，成功后删旧文件）：
   - `task-origins.json` → kind=`task-origin`
   - `message-origins.json` → kind=`message-origin`
   - `jdsme-source-state.json`（游标）→ kind=`jdsme-cursor`
   - `data/timeline/*`（每消息时间线）→ kind=`timeline`，key=messageId
   - `comms.jsonl`（沟通日志）→ kind=`comms`，key=`<at>-<seq>` 追加
4. 单测改为注入内存实现（存储接口化），不再依赖临时目录文件。

**验收**：mvn compile + 启动建表；vitest 绿；curl 文档端点 put/get/list/delete 通；
重启后端后 setTaskOrigin/setMessageOrigin/timeline/comms 行为不变；旧 JSON 被清掉。

## P1 — 上下文瘦身（卡片三元组 + 读资源表 + read_context）

**做什么**
1. `jarvis/context-resources.ts`：读资源路由表 —— `task/<id>`、`task/<id>/reports`、`task/<id>/report/<n>`、
   `thread/<key>`、`message/<id>`、`artifact/<id>`、`trace/<id>`、`conversation`。统一分页：列表默认 20 上限 50，
   文本默认 4000 上限 8000 字符；**页面上每个 ID 都必须经此表可读**。
2. `read_context(resource, offset?, limit?)` 工具：Jarvis 全量版；小弟受限版（只能读自己任务相关对象，
   其余 redact——借 dsh `executor: true` + 读时校验）。
3. think() 卡片化：任务摘要 → `{id,title,state,preview(160字),chars,read}`（≤8 张）；对话 → 最近 5 轮全文 +
   更早 stub `{ts,role,preview(50字),read}`；钉住制品保持全文。
4. 预算单测：断言卡片/预览尺寸上限，防漂移。

**验收**：think() prompt 长度显著下降（[perf] 日志前后对比）；Jarvis 能按指针读回全文并答对细节；
全部测试绿；消息链路零变化。

## P2 — Thread + 订阅直通 + handback

**做什么**
1. 文档表上建 `thread` / `trigger` / `subscription` 三个 kind 的存储与 intake 流程
   （`jarvis/a2a/intake.ts` 或并入 orchestrator 分流）。
2. 京ME群 Thread 划分 v1：显式派发开 Thread；订阅 kind=`origin`。
3. 订阅直通：命中订阅的消息 → `deliverToWorker(taskId, trigger)` 直接进小弟会话，不进 brain；
   Router 只收 follow_up 通知（event-reply 通道照常在 web 聊天可见）。
4. worker `handback(reason)` 工具 → 消息回流重评估；已结束任务收到人的消息 → resume。
5. Trigger 幂等：同 msgId 只入一次、只投一次。

**验收**：群里同任务后续消息不再触发 brain think（日志验证）；handback 后重新路由正确；
私聊行为与 P1 完全一致。

## P3 — 评估窗口 + 结构化 Decision（车道B 大脑）

**做什么**
1. `threadWindow`：候选评估上下文 = Thread 前 5 条 + 触发消息前后各 5 条（400字/邻位1200字，
   `omitted_before/after` 计数）+ related_tasks 卡（≤8）。
2. 评估专用 prompt（改造 message-router 内置 skill）：输出结构化 Decision `{accept|attach|ignore, intent_evidence}`。
3. **反问轮不建 task** 硬规则进 prompt 与代码双重约束；连续消息即自然澄清，最后一条才接单。

**验收**：模糊群聊消息不建任务、少 token；意图确立后才建；决策带证据可追溯。

## P4 — Source 可配置 + Gate 标准化

**做什么**
1. Source kind/instance 模型：kind 声明 configSchema，instance 存文档表（kind=`source-instance`）；
   jdsme.json 配置迁入。
2. ConfigPage"事件源"分区按 schema 渲染表单（启停/监听范围/准入格）。
3. Gate 统一输出 `{strength: explicit|inferred|filtered, basis, reason}`；
   准入表（每来源：仅显式/视为候选/忽略）进配置。
4. `data/persona/**` 用户配置迁文档表（kind=`persona-config`）。

**验收**：页面改京ME白名单/准入策略即时生效；Gate 输出可观测（日志/审计）。

## P5 — 行云 Source + Policy 版本化 + 审批队列（双车道合流）

**做什么**
1. `events/sources/xingyun.ts`：复用 task-hud 通道拉行云需求（卡片创建/评论/状态流转 = Trigger；
   卡片线程 = Thread）。卡片关闭 → 绑定任务自动收尾。
2. 行云卡片 = Mandate：`basis=xingyun_card`，免评估直 accept；同卡片事件幂等归一 Ticket。
3. Policy 版本化：规则哈希 `policyVersion`；Mandate 记录依据（版本/规则/来源）。
4. 审批队列：accept mode 分 `auto | approval | observe`（全局/每 Source 两层粒度）；
   approval → PendingApproval（kind=`approval`）→ 审批卡 UI + 京ME推送 + 超时策略；
   批准 → 原子建任务（Mandate.basis=审批记录ID）；拒绝 → 记录理由可审计。

**验收**：行云建卡→自动派单；需审批的走队列，批准后派单；卡片关闭→任务结束；审批记录可审计。

## P6 — 收尾

worker 读边界 redact 补全（跨任务/决策不可见）；`conversation` 资源化打磨；预算监控进 CI；
（可选）watchdog 会话化；（可选）推测执行（静默复现修复）。

## 里程碑纪律

- 每期：实现 → vitest + tsc（不接管道）→ 手工冒烟 → commit+push。P2/P3 动消息链路，回退点必须干净。
- 每期验收不过不进下一期。

---

## 实施记录(2026-11-08)

| 期 | 提交 | 内容 | 状态 |
|---|---|---|---|
| P0 | 52179fa | jarvis_agent_docs 通用文档表 + TS docs 客户端;task-origin/message-origin/jdsme游标/timeline/comms 全部迁 DB | ✅ |
| P1 | 5a70576 | 读资源表 + read_context 工具(Jarvis 全量/小弟受限) + think() 卡片化(任务/对话/技能目录);prompt 27612→11802 字符(-57%) | ✅ |
| P2 | 83fb3bf | Thread/Trigger/Subscription + 京ME群订阅直通 + handback 防乒乓 + Trigger 幂等 | ✅ |
| P3 | 10bf01c | 评估窗口(线程最近消息+omitted计数) + 接单门槛(三事实/反问轮不建任务) | ✅ |
| P4 | 13e301d | persona 配置迁 DB(写入库读缓存) + Source kind/instance 注册表 + Gate 结构化判定(explicit/candidates/ignore) + ConfigPage 事件源分区 | ✅ |
| P5 | 745046f | 行云需求源(车道A:卡片=Mandate) + 审批队列(approval/auto)+ Policy 版本 + 卡片关闭自动收尾 | ✅ |
| P6 | (本次) | skillCatalogLines 预算函数化 + 预算单测;实施记录 | ✅ |

### 遗留与说明
- **agent-profile(研发分身)仍文件存储**:该模块把配置物化成 skill 目录供 Pi SDK 加载,
  文件是其运行接口而非单纯存储;迁移=源头入库+物化落盘双写,牵动用户自建模块,待与作者对齐后单独做。
- watchdog 会话化 / 推测执行(静默复现修复) / 行云卡片评论同步 / Thread 细化聚类:设计文档标注的可选项,未排期。
- 行云轮询默认关闭(enabled+sprintId 需在配置页→事件源里开启);审批模式默认 approval。
