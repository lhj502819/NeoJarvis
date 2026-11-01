export interface SubTask {
  id: string
  name: string
  assignee: string
  domain?: string
  status: string
  progress?: string
  result?: string
  startedAt?: string
  turnCount?: number
  retryCount?: number
  tokensInput?: number
  tokensOutput?: number
  agentType?: 'permanent' | 'adhoc'
  agentName?: string
}

export interface Task {
  id: string
  name: string
  description: string
  status: string
  subtasks: SubTask[]
  result?: string
  createdAt: string
  updatedAt: string
}

export interface RunningAgent {
  taskId: string
  subtaskId: string
  name: string
  recipeId: string
  description: string
  startedAt: number
  url?: string
}

export interface Recipe {
  id: string
  name: string
  description: string
  persistent: boolean
  usageCount: number
  createdBy: string
  lastUsedAt: string
  avatar?: string
}

export interface AgentSession {
  sessionId: string
  recipeId: string
  domain: string
  topics: string[]
  lastTaskDescription: string
  completedAt: string
  taskCount: number
}

export interface JarvisState {
  mood: number
  energy: number
  confidence: number
  familiarity: number
  trustLevel: number
  tasksCompletedToday: number
  messagesHandledToday: number
}

export interface SubTaskTurn {
  id: string
  subtaskId: string
  turnIndex: number
  text: string
  startedAt: string
  endedAt?: string
  createdAt: string
}

export interface TaskArtifact {
  id: string
  type: string
  title: string
  language?: string
  version: number
  createdAt: number
}

export interface TaskDetail {
  task: Task
  turnsBySubtask: Record<string, SubTaskTurn[]>
  messagesBySubtask?: Record<string, Array<{ id: string; from: string; to: string; role: string; parts: Array<{ kind: string; text?: string }>; timestamp: string }>>
  conversation: {
    contextId: string
    participants: string[]
    messages: Array<{ id: string; from: string; to: string; role: string; parts: Array<{ kind: string; text?: string }>; timestamp: string }>
  } | null
  artifacts?: TaskArtifact[]
}

export interface SkillItem {
  name: string
  description: string
  category?: string
  icon?: string
  source: 'builtin' | 'personal'
  enabled: boolean
}

export type DashView = 'overview' | 'tasks' | 'team' | 'artifacts'
