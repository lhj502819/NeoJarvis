-- Jarvis v0.3 MySQL schema (ported from src/shared/db.ts, PG -> MySQL).
-- Runs on every boot via spring.sql.init.mode=always, so it must be idempotent:
--   * CREATE TABLE IF NOT EXISTS  -> tables created once, preserved thereafter
--   * indexes defined INLINE (KEY / UNIQUE KEY) -> created with the table, never
--     re-issued (MySQL has no CREATE INDEX IF NOT EXISTS; inline keeps re-runs safe)
-- Index names are kept globally unique (H2 requires schema-global unique index names).
-- H2 (MySQL mode) ignores ENGINE/CHARSET clauses and honours INT AUTO_INCREMENT.

-- ═══ 用户表 ═══
CREATE TABLE IF NOT EXISTS jarvis_users (
  id VARCHAR(191) PRIMARY KEY,
  username VARCHAR(191) UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role VARCHAR(191) NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
  updated_at TEXT NOT NULL,
  KEY idx_jarvis_tasks_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
  KEY idx_jarvis_subtasks_task (task_id),
  FOREIGN KEY (task_id) REFERENCES jarvis_tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══ Agent Recipe 表(含 skills 补列) ═══
CREATE TABLE IF NOT EXISTS jarvis_recipes (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  tools TEXT NOT NULL,
  model VARCHAR(191) NOT NULL DEFAULT 'sonnet',
  context VARCHAR(191) NOT NULL DEFAULT '{}',
  persistent INT NOT NULL DEFAULT 0,
  usage_count INT NOT NULL DEFAULT 0,
  created_by VARCHAR(191) NOT NULL DEFAULT 'jarvis',
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  skills VARCHAR(191) DEFAULT '[]',
  KEY idx_jarvis_recipes_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══ Claude Code Session 登记簿 ═══
CREATE TABLE IF NOT EXISTS jarvis_claude_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  session_id VARCHAR(191) NOT NULL,
  recipe_id VARCHAR(191) NOT NULL,
  domain TEXT,
  cwd TEXT,
  topics VARCHAR(191) NOT NULL DEFAULT '[]',
  last_task_description TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  task_count INT NOT NULL DEFAULT 1,
  KEY idx_jarvis_claude_sessions_user (user_id),
  KEY idx_jarvis_claude_sessions_recipe (user_id, recipe_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══ 用户↔Jarvis 会话表 ═══
CREATE TABLE IF NOT EXISTS user_jarvis_sessions (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  KEY idx_user_jarvis_sessions_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══ 用户↔Jarvis 消息表(含 image_ids 补列) ═══
CREATE TABLE IF NOT EXISTS user_jarvis_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(191) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  role VARCHAR(191) NOT NULL,
  content TEXT NOT NULL,
  `timestamp` BIGINT NOT NULL,
  artifact_id VARCHAR(191),
  image_ids TEXT,
  KEY idx_user_jarvis_messages_session (session_id, `timestamp`),
  FOREIGN KEY (session_id) REFERENCES user_jarvis_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
  task_id VARCHAR(191),
  KEY idx_jarvis_artifacts_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══ Jarvis↔Agent 会话表 ═══
CREATE TABLE IF NOT EXISTS jarvis_agent_threads (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  participants VARCHAR(191) NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  KEY idx_jarvis_agent_threads_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══ Jarvis↔Agent 消息表 ═══
CREATE TABLE IF NOT EXISTS jarvis_agent_messages (
  id VARCHAR(191) PRIMARY KEY,
  thread_id VARCHAR(191) NOT NULL,
  sender VARCHAR(191) NOT NULL,
  receiver VARCHAR(191) NOT NULL,
  role VARCHAR(191) NOT NULL,
  parts TEXT NOT NULL,
  `timestamp` TEXT NOT NULL,
  metadata TEXT,
  KEY idx_jarvis_agent_messages_thread (thread_id),
  FOREIGN KEY (thread_id) REFERENCES jarvis_agent_threads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
  updated_at TEXT NOT NULL,
  KEY idx_jarvis_user_credentials_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
  updated_at TEXT NOT NULL,
  UNIQUE KEY idx_jarvis_user_mcp_name (user_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══ 子任务执行回合表(完整轨迹) ═══
CREATE TABLE IF NOT EXISTS jarvis_subtask_turns (
  id VARCHAR(191) PRIMARY KEY,
  subtask_id VARCHAR(191) NOT NULL,
  turn_index INT NOT NULL,
  text TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  KEY idx_jarvis_subtask_turns_subtask (subtask_id, turn_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══ 临时工(adhoc agent)聚合表 ═══
CREATE TABLE IF NOT EXISTS jarvis_adhoc_agents (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  domain VARCHAR(191) NOT NULL,
  task_count INT NOT NULL DEFAULT 0,
  last_task_description TEXT NOT NULL,
  cwd TEXT,
  topics VARCHAR(191) NOT NULL DEFAULT '[]',
  last_session_id TEXT,
  promoted INT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE KEY idx_jarvis_adhoc_user_domain (user_id, domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══ 对话图片(base64 存库供预览/回看) ═══
CREATE TABLE IF NOT EXISTS jarvis_chat_images (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  media_type VARCHAR(191) NOT NULL,
  data TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  KEY idx_jarvis_chat_images_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══ 技能启禁偏好(黑名单:有行=该用户禁用了此 skill) ═══
CREATE TABLE IF NOT EXISTS jarvis_skill_prefs (
  user_id VARCHAR(191) NOT NULL,
  skill_name VARCHAR(191) NOT NULL,
  PRIMARY KEY (user_id, skill_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══ MCP 启禁偏好(黑名单:有行=该用户禁用了此 MCP) ═══
-- 完全对称 jarvis_skill_prefs;name 可为 hub 里读到的本机 MCP,或 jarvis_user_mcp_servers 里"自加"的。
-- 只做启/禁,不存 hub MCP 的凭证(hub 的 env 仅在 TS 智能层内存中流转)。
CREATE TABLE IF NOT EXISTS jarvis_mcp_prefs (
  user_id VARCHAR(191) NOT NULL,
  mcp_name VARCHAR(191) NOT NULL,
  PRIMARY KEY (user_id, mcp_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
