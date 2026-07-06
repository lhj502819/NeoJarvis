// ─── Task Types ───

export type TaskStatus =
  | 'created'
  | 'planning'
  | 'confirming'
  | 'executing'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type SubTaskStatus =
  | 'pending'
  | 'running'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface Task {
  id: string
  name: string
  description: string
  status: TaskStatus
  plan?: string
  subtasks: SubTask[]
  result?: string
  error?: string
  createdAt: string
  updatedAt: string
}

export interface SubTask {
  id: string
  taskId: string
  name: string
  description: string
  assignee: string
  /** 语义领域标签（聚类主键）——如「技术调研」「差旅出行」「jarvis开发」。专家按此维度沉淀。 */
  domain?: string
  /** 门牌号辅料——仅开发/改代码类任务需要，标明去哪个仓库干活。 */
  cwd?: string
  status: SubTaskStatus
  progress?: string
  result?: string
  error?: string
  blockedReason?: string
  dependsOn?: string[]
  createdAt: string
  updatedAt: string
}

// ─── Agent Recipe Types ───

export interface AgentRecipe {
  id: string
  name: string
  description: string
  systemPrompt: string
  tools: string[]
  model: string
  context: Record<string, unknown>
  persistent: boolean
  usageCount: number
  createdBy: 'builtin' | 'jarvis'
  createdAt: string
  lastUsedAt: string
}

// ─── Message Types ───

export interface JarvisMessage {
  id: string
  role: 'user' | 'jarvis' | 'system'
  content: string
  taskRef?: string
  timestamp: string
}

// ─── Intent Types ───

export type IntentType =
  | 'new_task'
  | 'query_progress'
  | 'provide_input'
  | 'cancel_task'
  | 'adjust_task'
  | 'confirm'
  | 'casual_chat'

export interface Intent {
  type: IntentType
  taskId?: string
  detail?: string
}
