import { serverGet, serverPatch } from '../shared/server-client.js'

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

export async function getState(userId: string): Promise<JarvisState> {
  // Java (StateService.getState) already applies the new-day reset server-side.
  // We re-apply resetIfNewDay here as an idempotent safety net: on the same day it is a
  // no-op, so behaviour matches the old direct-PG path without depending on server timezone.
  const state = await serverGet<JarvisState>(userId, '/api/state')
  return resetIfNewDay(state)
}

export async function updateState(userId: string, updates: Partial<JarvisState>): Promise<void> {
  // Old PG path: read-merge-write all fields + lastInteractionAt=now.
  // Java PATCH /api/state overlays only the provided fields over the stored state, so we
  // forward the caller's partial `updates` plus a fresh lastInteractionAt (StatePatchRequest
  // accepts it). Untouched fields keep their stored values — same net result as the merge.
  await serverPatch<JarvisState>(userId, '/api/state', {
    ...updates,
    lastInteractionAt: new Date().toISOString(),
  })
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
