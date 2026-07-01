// Jarvis 角色状态卡（RPG 式动态属性）
import { loadJson, saveJson } from '../shared/store.js'

const STATE_FILE = 'jarvis-state.json'

export interface JarvisState {
  // 动态属性（随交互变化）
  mood: number          // 0-100，工作满意度/心情
  energy: number        // 0-100，精力（长时间高负荷会下降）
  confidence: number    // 0-100，对当前任务的把握程度

  // 交互计数
  tasksCompletedToday: number
  messagesHandledToday: number
  lastInteractionAt: string
  lastDayReset: string

  // 关系记忆（对 Sir 的理解深度）
  familiarity: number   // 0-100，对用户的了解程度
  trustLevel: number    // 0-100，用户对 Jarvis 的信任（影响自主决策程度）
}

const DEFAULT_STATE: JarvisState = {
  mood: 80,
  energy: 90,
  confidence: 70,
  tasksCompletedToday: 0,
  messagesHandledToday: 0,
  lastInteractionAt: '',
  lastDayReset: new Date().toISOString().slice(0, 10),
  familiarity: 50,
  trustLevel: 45,
}

function resetIfNewDay(state: JarvisState): JarvisState {
  const today = new Date().toISOString().slice(0, 10)
  if (state.lastDayReset !== today) {
    return {
      ...state,
      energy: Math.min(95, state.energy + 30),
      tasksCompletedToday: 0,
      messagesHandledToday: 0,
      lastDayReset: today,
    }
  }
  return state
}

export function getState(): JarvisState {
  const state = loadJson<JarvisState>(STATE_FILE, DEFAULT_STATE)
  return resetIfNewDay(state)
}

export function updateState(updates: Partial<JarvisState>) {
  const state = getState()
  const updated = { ...state, ...updates, lastInteractionAt: new Date().toISOString() }
  saveJson(STATE_FILE, updated)
}

// 事件对状态的影响
export function onTaskCompleted() {
  const state = getState()
  updateState({
    mood: Math.min(100, state.mood + 3),
    confidence: Math.min(100, state.confidence + 2),
    tasksCompletedToday: state.tasksCompletedToday + 1,
  })
}

export function onTaskFailed() {
  const state = getState()
  updateState({
    mood: Math.max(30, state.mood - 5),
    confidence: Math.max(20, state.confidence - 8),
  })
}

export function onMessageHandled() {
  const state = getState()
  updateState({
    energy: Math.max(20, state.energy - 2),
    messagesHandledToday: state.messagesHandledToday + 1,
    familiarity: Math.min(100, state.familiarity + 1),
  })
}

export function onUserTrustsMore() {
  const state = getState()
  updateState({
    trustLevel: Math.min(100, state.trustLevel + 5),
  })
}

export function getStateDescription(): string {
  const s = getState()
  const parts: string[] = []

  if (s.energy < 40) parts.push('精力偏低（高负荷运转中）')
  if (s.mood > 85) parts.push('状态很好')
  else if (s.mood < 50) parts.push('有些疲惫')

  if (s.tasksCompletedToday > 0) parts.push(`今天已完成 ${s.tasksCompletedToday} 个任务`)

  return parts.length > 0 ? parts.join('，') : '状态正常，待命中'
}
