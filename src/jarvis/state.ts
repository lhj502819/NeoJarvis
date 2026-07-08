import pool from '../shared/db.js'

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

export async function getState(userId: string): Promise<JarvisState> {
  const { rows } = await pool.query('SELECT * FROM jarvis_state WHERE user_id = $1', [userId])
  if (!rows[0]) return resetIfNewDay({ ...DEFAULT_STATE })
  return resetIfNewDay(rowToState(rows[0]))
}

export async function updateState(userId: string, updates: Partial<JarvisState>): Promise<void> {
  const state = await getState(userId)
  const updated = { ...state, ...updates, lastInteractionAt: new Date().toISOString() }

  await pool.query(`
    INSERT INTO jarvis_state (user_id, mood, energy, confidence, tasks_completed_today, messages_handled_today, last_interaction_at, last_day_reset, familiarity, trust_level)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
  `, [userId, updated.mood, updated.energy, updated.confidence, updated.tasksCompletedToday, updated.messagesHandledToday, updated.lastInteractionAt, updated.lastDayReset, updated.familiarity, updated.trustLevel])
}

export async function onTaskCompleted(userId: string): Promise<void> {
  const state = await getState(userId)
  await updateState(userId, {
    mood: Math.min(100, state.mood + 3),
    confidence: Math.min(100, state.confidence + 2),
    tasksCompletedToday: state.tasksCompletedToday + 1,
  })
}

export async function onTaskFailed(userId: string): Promise<void> {
  const state = await getState(userId)
  await updateState(userId, {
    mood: Math.max(30, state.mood - 5),
    confidence: Math.max(20, state.confidence - 8),
  })
}

export async function onMessageHandled(userId: string): Promise<void> {
  const state = await getState(userId)
  await updateState(userId, {
    energy: Math.max(20, state.energy - 2),
    messagesHandledToday: state.messagesHandledToday + 1,
    familiarity: Math.min(100, state.familiarity + 1),
  })
}

export async function onUserTrustsMore(userId: string): Promise<void> {
  const state = await getState(userId)
  await updateState(userId, {
    trustLevel: Math.min(100, state.trustLevel + 5),
  })
}

export async function getStateDescription(userId: string): Promise<string> {
  const s = await getState(userId)
  const parts: string[] = []

  if (s.energy < 40) parts.push('精力偏低（高负荷运转中）')
  if (s.mood > 85) parts.push('状态很好')
  else if (s.mood < 50) parts.push('有些疲惫')

  if (s.tasksCompletedToday > 0) parts.push(`今天已完成 ${s.tasksCompletedToday} 个任务`)

  return parts.length > 0 ? parts.join('，') : '状态正常，待命中'
}
