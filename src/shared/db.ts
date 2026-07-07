import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync } from 'fs'

const PROJECT_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const DB_DIR = join(PROJECT_ROOT, 'data')
mkdirSync(DB_DIR, { recursive: true })

const DB_PATH = join(DB_DIR, 'jarvis.db')

const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
-- ═══ 用户表 ═══
CREATE TABLE IF NOT EXISTS jarvis_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);

-- ═══ 任务表 ═══
CREATE TABLE IF NOT EXISTS jarvis_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  plan TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_tasks_user ON jarvis_tasks(user_id);

-- ═══ 子任务表 ═══
CREATE TABLE IF NOT EXISTS jarvis_subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES jarvis_tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  assignee TEXT NOT NULL,
  domain TEXT,
  cwd TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  progress TEXT,
  result TEXT,
  error TEXT,
  blocked_reason TEXT,
  depends_on TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_subtasks_task ON jarvis_subtasks(task_id);

-- ═══ Agent Recipe 表 ═══
CREATE TABLE IF NOT EXISTS jarvis_recipes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  tools TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'sonnet',
  context TEXT NOT NULL DEFAULT '{}',
  persistent INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'jarvis',
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jarvis_recipes_user ON jarvis_recipes(user_id);

-- ═══ Claude Code Session 登记簿 ═══
CREATE TABLE IF NOT EXISTS jarvis_claude_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  domain TEXT,
  cwd TEXT,
  topics TEXT NOT NULL DEFAULT '[]',
  last_task_description TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  task_count INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_jarvis_claude_sessions_user ON jarvis_claude_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_jarvis_claude_sessions_recipe ON jarvis_claude_sessions(user_id, recipe_id);

-- ═══ Jarvis 人格状态表 ═══
CREATE TABLE IF NOT EXISTS jarvis_state (
  user_id TEXT PRIMARY KEY,
  mood INTEGER NOT NULL DEFAULT 80,
  energy INTEGER NOT NULL DEFAULT 90,
  confidence INTEGER NOT NULL DEFAULT 70,
  tasks_completed_today INTEGER NOT NULL DEFAULT 0,
  messages_handled_today INTEGER NOT NULL DEFAULT 0,
  last_interaction_at TEXT,
  last_day_reset TEXT NOT NULL,
  familiarity INTEGER NOT NULL DEFAULT 50,
  trust_level INTEGER NOT NULL DEFAULT 45
);

-- ═══ 用户↔Jarvis 会话表 ═══
CREATE TABLE IF NOT EXISTS user_jarvis_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_jarvis_sessions_user ON user_jarvis_sessions(user_id);

-- ═══ 用户↔Jarvis 消息表 ═══
CREATE TABLE IF NOT EXISTS user_jarvis_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES user_jarvis_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_jarvis_messages_session ON user_jarvis_messages(session_id, timestamp);

-- ═══ Jarvis↔Agent 会话表 ═══
CREATE TABLE IF NOT EXISTS jarvis_agent_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  participants TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_agent_threads_user ON jarvis_agent_threads(user_id);

-- ═══ Jarvis↔Agent 消息表 ═══
CREATE TABLE IF NOT EXISTS jarvis_agent_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES jarvis_agent_threads(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  receiver TEXT NOT NULL,
  role TEXT NOT NULL,
  parts TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_jarvis_agent_messages_thread ON jarvis_agent_messages(thread_id);

-- ═══ 用户凭证表（BYOK：API Key/Base URL/模型名，支持多凭证 + 能力档位）═══
CREATE TABLE IF NOT EXISTS jarvis_user_credentials (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  label       TEXT NOT NULL,
  tier        TEXT NOT NULL DEFAULT 'standard',
  api_key_enc TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  model       TEXT NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_user_credentials_user ON jarvis_user_credentials(user_id);

-- ═══ 用户 MCP servers 表（全局共享给该用户所有小弟，按需使用）═══
CREATE TABLE IF NOT EXISTS jarvis_user_mcp_servers (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,           -- 用户可见名，Jarvis 按此增删改
  transport    TEXT NOT NULL,           -- 'stdio' | 'sse' | 'http'
  command      TEXT,                    -- stdio: 可执行命令
  args_json    TEXT,                    -- stdio: JSON 数组字符串
  url          TEXT,                    -- sse/http: 端点 URL
  env_enc      TEXT,                    -- 加密 JSON，含 token 等敏感 env
  description  TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jarvis_user_mcp_name ON jarvis_user_mcp_servers(user_id, name);
`)

export default db
