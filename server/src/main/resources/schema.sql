-- Jarvis v0.3 PostgreSQL schema (ported from MySQL).
-- Runs on every boot via spring.sql.init.mode=always, so it must be idempotent:
--   * CREATE TABLE IF NOT EXISTS
--   * indexes as separate CREATE INDEX IF NOT EXISTS (PG has no inline KEY like MySQL)
-- Index names are globally unique across the schema.

-- ═══ 用户表 ═══
CREATE TABLE IF NOT EXISTS jarvis_users (
  id VARCHAR(191) PRIMARY KEY,
  username VARCHAR(191) UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role VARCHAR(191) NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);

-- ═══ 任务表 ═══
CREATE TABLE IF NOT EXISTS jarvis_tasks (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(191) NOT NULL DEFAULT 'created',
  plan TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_tasks_user ON jarvis_tasks(user_id);

-- ═══ 子任务表(含 5 处执行元信息补列) ═══
CREATE TABLE IF NOT EXISTS jarvis_subtasks (
  id VARCHAR(191) PRIMARY KEY,
  task_id VARCHAR(191) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  assignee TEXT NOT NULL,
  domain TEXT,
  cwd TEXT,
  status VARCHAR(191) NOT NULL DEFAULT 'pending',
  progress TEXT,
  result TEXT,
  error TEXT,
  blocked_reason TEXT,
  depends_on TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  turn_count INT,
  retry_count INT,
  tokens_input INT,
  tokens_output INT,
  FOREIGN KEY (task_id) REFERENCES jarvis_tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_jarvis_subtasks_task ON jarvis_subtasks(task_id);

-- ═══ Agent Recipe 表(含 skills 补列) ═══
CREATE TABLE IF NOT EXISTS jarvis_recipes (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  tools TEXT NOT NULL,
  model VARCHAR(191) NOT NULL DEFAULT 'sonnet',
  context TEXT NOT NULL DEFAULT '{}',
  persistent INT NOT NULL DEFAULT 0,
  usage_count INT NOT NULL DEFAULT 0,
  created_by VARCHAR(191) NOT NULL DEFAULT 'jarvis',
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  skills TEXT DEFAULT '[]',
  avatar TEXT
);
-- 已存在的库补列(CREATE IF NOT EXISTS 对旧表是 no-op);ADD COLUMN IF NOT EXISTS 幂等
ALTER TABLE jarvis_recipes ADD COLUMN IF NOT EXISTS avatar TEXT;
CREATE INDEX IF NOT EXISTS idx_jarvis_recipes_user ON jarvis_recipes(user_id);

-- ═══ Claude Code Session 登记簿 ═══
CREATE TABLE IF NOT EXISTS jarvis_claude_sessions (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  session_id VARCHAR(191) NOT NULL,
  recipe_id VARCHAR(191) NOT NULL,
  domain TEXT,
  cwd TEXT,
  topics TEXT NOT NULL DEFAULT '[]',
  last_task_description TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  task_count INT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_jarvis_claude_sessions_user ON jarvis_claude_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_jarvis_claude_sessions_recipe ON jarvis_claude_sessions(user_id, recipe_id);

-- ═══ Jarvis 人格状态表 ═══
CREATE TABLE IF NOT EXISTS jarvis_state (
  user_id VARCHAR(191) PRIMARY KEY,
  mood INT NOT NULL DEFAULT 80,
  energy INT NOT NULL DEFAULT 90,
  confidence INT NOT NULL DEFAULT 70,
  tasks_completed_today INT NOT NULL DEFAULT 0,
  messages_handled_today INT NOT NULL DEFAULT 0,
  last_interaction_at TEXT,
  last_day_reset TEXT NOT NULL,
  familiarity INT NOT NULL DEFAULT 50,
  trust_level INT NOT NULL DEFAULT 45
);

-- ═══ 用户↔Jarvis 会话表 ═══
CREATE TABLE IF NOT EXISTS user_jarvis_sessions (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_jarvis_sessions_user ON user_jarvis_sessions(user_id);

-- ═══ 用户↔Jarvis 消息表(含 image_ids 补列) ═══
CREATE TABLE IF NOT EXISTS user_jarvis_messages (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(191) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  role VARCHAR(191) NOT NULL,
  content TEXT NOT NULL,
  "timestamp" BIGINT NOT NULL,
  artifact_id VARCHAR(191),
  image_ids TEXT,
  FOREIGN KEY (session_id) REFERENCES user_jarvis_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_jarvis_messages_session ON user_jarvis_messages(session_id, "timestamp");

-- ═══ Artifact 制品表(含 version/updated_at/task_id/uri 补列) ═══
-- content 允许 NULL:新数据把制品正文写到本机文件(uri 指向),content 存 NULL;
-- 旧数据 content 保留(uri 为 NULL),接口层兼容读取。
CREATE TABLE IF NOT EXISTS jarvis_artifacts (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  type VARCHAR(191) NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  uri VARCHAR(512),
  language TEXT,
  created_at BIGINT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  updated_at BIGINT,
  task_id VARCHAR(191)
);
CREATE INDEX IF NOT EXISTS idx_jarvis_artifacts_user ON jarvis_artifacts(user_id);

-- ═══ Jarvis↔Agent 会话表 ═══
CREATE TABLE IF NOT EXISTS jarvis_agent_threads (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  participants TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_agent_threads_user ON jarvis_agent_threads(user_id);

-- ═══ Jarvis↔Agent 消息表 ═══
CREATE TABLE IF NOT EXISTS jarvis_agent_messages (
  id VARCHAR(191) PRIMARY KEY,
  thread_id VARCHAR(191) NOT NULL,
  sender VARCHAR(191) NOT NULL,
  receiver VARCHAR(191) NOT NULL,
  role VARCHAR(191) NOT NULL,
  parts TEXT NOT NULL,
  "timestamp" TEXT NOT NULL,
  metadata TEXT,
  FOREIGN KEY (thread_id) REFERENCES jarvis_agent_threads(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_jarvis_agent_messages_thread ON jarvis_agent_messages(thread_id);

-- ═══ 用户凭证表(BYOK) ═══
CREATE TABLE IF NOT EXISTS jarvis_user_credentials (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  label TEXT NOT NULL,
  tier VARCHAR(191) NOT NULL DEFAULT 'standard',
  api_key_enc TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  is_default INT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_user_credentials_user ON jarvis_user_credentials(user_id);

-- ═══ 用户 MCP servers 表 ═══
CREATE TABLE IF NOT EXISTS jarvis_user_mcp_servers (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  name VARCHAR(191) NOT NULL,
  transport VARCHAR(191) NOT NULL,
  command TEXT,
  args_json TEXT,
  url TEXT,
  env_enc TEXT,
  description TEXT,
  enabled INT NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jarvis_user_mcp_name ON jarvis_user_mcp_servers(user_id, name);

-- ═══ 子任务执行回合表(完整轨迹) ═══
CREATE TABLE IF NOT EXISTS jarvis_subtask_turns (
  id VARCHAR(191) PRIMARY KEY,
  subtask_id VARCHAR(191) NOT NULL,
  turn_index INT NOT NULL,
  text TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_subtask_turns_subtask ON jarvis_subtask_turns(subtask_id, turn_index);

-- ═══ 临时工(adhoc agent)聚合表 ═══
CREATE TABLE IF NOT EXISTS jarvis_adhoc_agents (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  domain VARCHAR(191) NOT NULL,
  task_count INT NOT NULL DEFAULT 0,
  last_task_description TEXT NOT NULL,
  cwd TEXT,
  topics TEXT NOT NULL DEFAULT '[]',
  last_session_id TEXT,
  promoted INT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jarvis_adhoc_user_domain ON jarvis_adhoc_agents(user_id, domain);

-- ═══ 对话图片(v0.3 迁本机文件存储:uri 指向 ~/.jarvis/chat-images/{userId}/{id}.{ext}) ═══
-- data 允许 NULL:新数据把图片写到本机文件(uri 指向),data 存 NULL;
-- 旧数据 data 保留(base64 存库,uri 为 NULL),接口层兼容读取。
-- 完全对称 jarvis_artifacts 表的迁移策略 —— 避免 base64 图片撑爆 TEXT 64KB。
CREATE TABLE IF NOT EXISTS jarvis_chat_images (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  media_type VARCHAR(191) NOT NULL,
  data TEXT,
  uri VARCHAR(512),
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_chat_images_user ON jarvis_chat_images(user_id);

-- ═══ 技能启禁偏好(黑名单:有行=该用户禁用了此 skill) ═══
CREATE TABLE IF NOT EXISTS jarvis_skill_prefs (
  user_id VARCHAR(191) NOT NULL,
  skill_name VARCHAR(191) NOT NULL,
  PRIMARY KEY (user_id, skill_name)
);

-- ═══ MCP 启禁偏好(黑名单:有行=该用户禁用了此 MCP) ═══
-- 完全对称 jarvis_skill_prefs;name 可为 hub 里读到的本机 MCP,或 jarvis_user_mcp_servers 里"自加"的。
-- 只做启/禁,不存 hub MCP 的凭证(hub 的 env 仅在 TS 智能层内存中流转)。
CREATE TABLE IF NOT EXISTS jarvis_mcp_prefs (
  user_id VARCHAR(191) NOT NULL,
  mcp_name VARCHAR(191) NOT NULL,
  PRIMARY KEY (user_id, mcp_name)
);

-- ═══ 工具调用完整历史(Jarvis 本体 + 小弟 两端共用) ═══
-- 参考 Letta 的做法:tool_call/tool_result 作为一等公民存下来,LLM 下一轮能看到"我上一步调了什么、返回了什么"。
-- 一行 = 一次工具调用(tool_use)+ 匹配的返回(tool_result),用 tool_call_id 配对同一批 Anthropic API 事务。
-- scope 二选一:'jarvis' 挂在 user_jarvis_messages(通过 message_id) / 'subtask' 挂在子任务(通过 subtask_id + turn_index)。
-- 截断策略:入库 50K(在 ToolTraceService 里做);进 LLM 上下文时二次压缩到 5K(在 TS conversation.ts 组 prompt 时)。
CREATE TABLE IF NOT EXISTS jarvis_tool_traces (
  id             VARCHAR(191) PRIMARY KEY,
  user_id        VARCHAR(191) NOT NULL,
  scope          VARCHAR(16)  NOT NULL,
  message_id     BIGINT,
  subtask_id     VARCHAR(191),
  turn_index     INT,
  call_index     INT NOT NULL,
  tool_call_id   VARCHAR(191) NOT NULL,
  tool_name      VARCHAR(191) NOT NULL,
  args           JSONB NOT NULL,
  result         JSONB,
  result_text    TEXT,
  is_error       BOOLEAN NOT NULL DEFAULT FALSE,
  bytes_original INT,
  truncated      BOOLEAN NOT NULL DEFAULT FALSE,
  started_at     TIMESTAMPTZ NOT NULL,
  ended_at       TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((scope='jarvis'  AND message_id IS NOT NULL AND subtask_id IS NULL)
      OR (scope='subtask' AND subtask_id IS NOT NULL AND message_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_tt_message ON jarvis_tool_traces(message_id) WHERE scope='jarvis';
CREATE INDEX IF NOT EXISTS idx_tt_subtask ON jarvis_tool_traces(subtask_id, turn_index, call_index) WHERE scope='subtask';
CREATE INDEX IF NOT EXISTS idx_tt_user_created ON jarvis_tool_traces(user_id, created_at DESC);

-- ═══ 通用文档表(superagent-v2 P0,docs/superagent-design-v2.md) ═══
-- 智能层运行时状态的统一落点:承接原 JSON 侧车(task-origin/message-origin/jdsme游标/
-- timeline/comms)与后续 thread/trigger/subscription/approval/policy-version 等状态。
-- (user_id, kind, doc_key) 唯一 = upsert 语义;id 自增保留插入序(list 按 id 倒序取最新)。
-- data 一律 JSONB —— 键空间受控(数字 id/受控枚举),不存自由全文索引需求。
CREATE TABLE IF NOT EXISTS jarvis_agent_docs (
  id         BIGSERIAL PRIMARY KEY,
  user_id    VARCHAR(191) NOT NULL,
  kind       VARCHAR(64)  NOT NULL,
  doc_key    VARCHAR(191) NOT NULL,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, kind, doc_key)
);
CREATE INDEX IF NOT EXISTS idx_agent_docs_list ON jarvis_agent_docs(user_id, kind, id DESC);
