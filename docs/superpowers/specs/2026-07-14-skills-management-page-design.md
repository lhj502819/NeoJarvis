# 技能管理页 设计

> 状态:待批准
> 日期:2026-07-14

## 背景与问题

`c88d792` 落地了 skills-hub 地基:启动时把 `~/.claude/skills` 和 `~/.codex/skills` 里的 skill 软链进 `plugins/skills-hub/skills/`(当前 50 个),小弟派单时可挂载。但存在两个缺口:

1. **Sir 看不到、管不了这些 skill**。前端没有任何入口展示 hub 里有哪些 skill,更无法启用/禁用。
2. **`listHubSkills()` 是死代码**。`skills-hub.ts` 定义了它(读每个 SKILL.md 的 name/description),但**全代码库无调用方**。后果:Jarvis 挂 skill 时全靠猜名字(实测它猜中 `deep-research` 是运气)——skill 清单从未真正注入过 prompt。

本设计新增一个「技能管理」页,让 Sir 展示 + 启用/禁用 skill,并顺带补上 skill 注入 Jarvis prompt 的窟窿。

## 目标

1. 前端新增「技能」页:分组网格展示所有 skill(图标+名+描述+开关),支持搜索 + 全部/已启用/已禁用过滤。
2. 启用/禁用**按用户隔离**持久化;禁用后 **Jarvis 本体和小弟都不再使用**该 skill。
3. 补接 skill 注入:启用的 skill 清单进 Jarvis prompt,它挑 skill 不再靠猜。
4. 区分**内置 skill**(带分类+专属图标)与**个人 skill**(用户本地软链,归「个人」组 + 默认图标)。

## 非目标

- **不做增删改 skill 内容**(不写 SKILL.md、不做编辑器)。仅展示 + 启禁。
- **不做参考图里的「渠道」Tab**(那是别的产品的)。
- **不改 `settingSources`**(保持 `[]`,守住 token 红线)。启禁通过 Agent SDK `skills` 数组过滤实现,不走官方 `skillOverrides`(那要 settingSources)。
- 不引入 skill 市场/安装/下载(个人 skill 靠用户自己往 `~/.claude/skills` 放)。

## 业界实践对照

调研了 Claude Code 官方、VS Code 扩展、Raycast Store(见对话中 Sources):
- **官方 SKILL.md 标准无 `category`/`icon` 字段** → 我们的内置 skill 用**自定义 frontmatter** 扩展这两个字段。官方明确 malformed/多余字段会被忽略、body 照常加载,故安全。
- **官方禁用走 `skillOverrides`(settingSources)** → 我们不能用(红线),改用**黑名单表 + SDK `skills` 过滤**,语义等价于官方的 `off`。
- **VS Code 的 `@enabled/@disabled` 过滤器** → 印证顶部"全部/已启用/已禁用"下拉。
- **卡片 = 图标+名+描述** → Raycast/VSCode 一致,照做。

## 数据模型:内置 vs 个人

skill 现在全是**软链**进 hub 的。天然区分点(`lstatSync().isSymbolicLink()`):

| | 来源 | 分类 | 图标 |
|---|---|---|---|
| **个人 skill** | 软链(`~/.claude/skills`、`~/.codex/skills`) | 统一「个人」 | 默认星标图标 |
| **内置 skill** | 真实目录(直接 commit 进 hub) | 各自 frontmatter `category`(效率/开发/集成…) | 各自 frontmatter `icon` |

`syncSkillsHub` 已经只删 symlink、保留真实目录,所以内置 skill 放进去自动与软链共存。**当前内置数为 0,页面初始全在「个人」组**,以后加内置时前向兼容。

内置 skill 的扩展 frontmatter(示例):
```yaml
---
name: gh-cli
description: GitHub CLI 综合参考
category: 开发        # 自定义扩展字段
icon: github         # 自定义扩展字段,映射到前端内置图标集
---
```

`listHubSkills()` 扩展为解析 `category` 和 `icon`;软链项这两个字段为空,前端据空判定为「个人」+默认图标。

## 存储:黑名单表

```sql
CREATE TABLE IF NOT EXISTS jarvis_skill_prefs (
  user_id    TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  PRIMARY KEY (user_id, skill_name)
);
```

**语义:有行 = 该用户禁用了此 skill;空表 = 全部启用。** 按用户隔离。

**为何黑名单而非全量状态表**:skill 是动态聚合的(装新 CC skill 就多、删了就少)。全量表要持续跟文件系统同步(新 skill 插行+定默认、删的清孤儿、挑同步时机),把一张表绑死到一个一直在变的目录。黑名单把这层同步彻底解耦——权威数据是文件系统(hub 目录),DB 只存"用户偏好差量"(不想要哪几个)。回显时后端一次 `Set` 查表标好 `enabled`,前端零便利匹配。

## 组件与数据流

### 后端

**新模块 `src/jarvis/skill-prefs.ts`**
- `getDisabledSkills(userId): Promise<Set<string>>` — 查黑名单表
- `setSkillEnabled(userId, name, enabled)` — enabled=false 则 INSERT(ON CONFLICT DO NOTHING),true 则 DELETE
- `listSkillsForUser(userId)` — 合并 `listHubSkills()` + symlink 判定 source + `enabled` 标注,返回:
  ```ts
  { name, description, category, icon, source: 'builtin'|'personal', enabled }[]
  ```

**`src/jarvis/skills-hub.ts`** — `listHubSkills` 扩展解析 `category`/`icon`;新增 `isBuiltinSkill(name)`(lstat 判 symlink)。

**`src/jarvis/routes/dashboard.ts`** — 2 个接口:
- `GET /api/skills` → `listSkillsForUser(req.userId)`
- `POST /api/skills/:name/toggle` body `{ enabled: boolean }` → `setSkillEnabled` → `{ ok: true }`

### 启用/禁用真正生效(三处联动 + 补注入窟窿)

- **`src/jarvis/llm.ts:81`**:`skills: 'all'` → 改为查禁用集后传数组:`skills: [管道skill..., ...启用的 hub skill 名]`。需要 userId(llmCall 已有)。管道类 skill(如 promote-agent)恒在,不受开关影响。
- **`src/jarvis/brain.ts`**:`think()` 组 prompt 时注入「## 可用技能」区块(只列启用的 name+description),Jarvis 挑 skill 有据可依,不再猜。
- **`src/a2a/client.ts:167`**:派单 merge skills 后再按禁用集过滤一遍(防御性,防止 Jarvis 挂了已禁用的)。

> 三处共用 `getDisabledSkills(userId)`。

### 前端

- **`web/src/components/Layout.tsx`**:`View` 加 `'skills'`;NAV_ITEMS 加 `{ id:'skills', icon:'✦', label:'技能' }`;MainArea 加分支渲染 `<SkillsPage />`。
- **`web/src/pages/dashboard/SkillsPage.tsx`**(新):
  - `usePolling<SkillItem[]>('/api/skills', 10000)` 或首屏 fetch
  - 顶部:搜索框(按 name/description 过滤)+ 过滤下拉(全部/已启用/已禁用)
  - 按 `category` 分组(个人组排最后),响应式两列网格
  - 卡片:`SkillIcon`(按 `icon` 字段映射内置 SVG,空则默认星标) + name + 截断 description + 右侧 `<Toggle>`
  - Toggle 点击 → `POST /api/skills/:name/toggle` + 乐观更新
- **图标**:内置图标集 = 少量内联 SVG(github/apple/google/wechat/星标…),`icon` 字段做键。默认图标 = 用户给的四角星带小十字(内联 SVG 复刻)。**不引外部资源**。
- **`web/src/pages/dashboard/types.ts`**:加 `SkillItem` 类型。
- **CSS**:复用 dashboard.css 卡片风,新增 skill 网格/开关样式(或并入 dashboard.css)。

## 关键约束

- **管道 skill 不进管理页**:promote-agent 等 Jarvis 内部机制 skill 恒加载、不受禁用影响、页面不展示。判定方式:维护一个 `PIPELINE_SKILLS` 常量集,`listSkillsForUser` 和注入逻辑都排除它。
- **默认全启用**:黑名单为空时所有 skill 可用,符合"skill 生态默认开放"心智。
- **禁用作用域 = Jarvis + 小弟全局**(单开关,不分层)。

## 验证

1. `npx tsc --noEmit`(前后端)+ 重启后端(DB migration 建表)。
2. 打开「技能」页 → 确认 50 个 skill 全在「个人」组、默认图标、开关默认全开。
3. 搜索/过滤(已启用/已禁用)工作正常。
4. 禁用某 skill(如 deep-research)→ 刷新确认状态持久;派一个调研任务 → 后端日志确认该 skill **未**挂给小弟。
5. 重新启用 → 派任务确认恢复挂载。
6. 手动放一个带 `category`/`icon` frontmatter 的真实目录 skill 进 hub → 确认它进对应分类组、显示专属图标(验证内置路径)。
7. 多账号验证隔离:A 禁的 skill 不影响 B。
