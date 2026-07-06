import db from '../shared/db.js'

export interface JarvisState {
  mood: number
  energy: number
  confidence: number
  tasksCompletedToday: number
  messagesHandledToday: number
  lastInteractionAt: string
  lastDayReset: string
  familiarity: number
  trustLevel: number
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

function rowToState(row: any): JarvisState {
  return {
    mood: row.mood,
    energy: row.energy,
    confidence: row.confidence,
    tasksCompletedToday: row.tasks_completed_today,
    messagesHandledToday: row.messages_handled_today,
    lastInteractionAt: row.last_interaction_at || '',
    lastDayReset: row.last_day_reset,
    familiarity: row.familiarity,
    trustLevel: row.trust_level,
  }
}

export function getState(userId: string): JarvisState {
  const row = db.prepare('SELECT * FROM jarvis_state WHERE user_id = ?').get(userId) as any
  if (!row) return resetIfNewDay({ ...DEFAULT_STATE })
  return resetIfNewDay(rowToState(row))
}

export function updateState(userId: string, updates: Partial<JarvisState>) {
  const state = getState(userId)
  const updated = { ...state, ...updates, lastInteractionAt: new Date().toISOString() }

  db.prepare(`
    INSERT INTO jarvis_state (user_id, mood, energy, confidence, tasks_completed_today, messages_handled_today, last_interaction_at, last_day_reset, familiarity, trust_level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      mood = excluded.mood,
      energy = excluded.energy,
      confidence = excluded.confidence,
      tasks_completed_today = excluded.tasks_completed_today,
      messages_handled_today = excluded.messages_handled_today,
      last_interaction_at = excluded.last_interaction_at,
      last_day_reset = excluded.last_day_reset,
      familiarity = excluded.familiarity,
      trust_level = excluded.trust_level
  `).run(userId, updated.mood, updated.energy, updated.confidence, updated.tasksCompletedToday, updated.messagesHandledToday, updated.lastInteractionAt, updated.lastDayReset, updated.familiarity, updated.trustLevel)
}

export function onTaskCompleted(userId: string) {
  const state = getState(userId)
  updateState(userId, {
    mood: Math.min(100, state.mood + 3),
    confidence: Math.min(100, state.confidence + 2),
    tasksCompletedToday: state.tasksCompletedToday + 1,
  })
}

export function onTaskFailed(userId: string) {
  const state = getState(userId)
  updateState(userId, {
    mood: Math.max(30, state.mood - 5),
    confidence: Math.max(20, state.confidence - 8),
  })
}

export function onMessageHandled(userId: string) {
  const state = getState(userId)
  updateState(userId, {
    energy: Math.max(20, state.energy - 2),
    messagesHandledToday: state.messagesHandledToday + 1,
    familiarity: Math.min(100, state.familiarity + 1),
  })
}

export function onUserTrustsMore(userId: string) {
  const state = getState(userId)
  updateState(userId, {
    trustLevel: Math.min(100, state.trustLevel + 5),
  })
}

export function getStateDescription(userId: string): string {
  const s = getState(userId)
  const parts: string[] = []

  if (s.energy < 40) parts.push('精力偏低（高负荷运转中）')
  if (s.mood > 85) parts.push('状态很好')
  else if (s.mood < 50) parts.push('有些疲惫')

  if (s.tasksCompletedToday > 0) parts.push(`今天已完成 ${s.tasksCompletedToday} 个任务`)

  return parts.length > 0 ? parts.join('，') : '状态正常，待命中'
}
