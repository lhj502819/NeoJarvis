import type { Task, SubTask, SubTaskTurn, TaskDetail, SubtaskMessage } from '../shared/types.js'
import { serverGet, serverPost, serverPatch } from '../shared/server-client.js'
import { bus } from '../a2a/bus.js'

/**
 * v0.3: the task data layer no longer touches PostgreSQL directly — it calls the Java
 * server's REST API (see TaskController). The Java Task/SubTask/SubTaskTurn/TaskDetail
 * records are field-for-field identical to the TS types (camelCase JSON), so responses
 * deserialize directly with no row->object mapping. Id generation, the recipe join
 * (permanent/adhoc identity) and the summary text are all done server-side now.
 *
 * Signatures are unchanged from the old pool-based version. Functions that carry a
 * `userId` forward it as X-Internal-User; the few id-only writes (setSubtaskStarted /
 * recordTurn / finalizeSubtaskMeta / getSubtaskTurns) have no userId in their signature,
 * so they pass a 'local' placeholder purely to satisfy the dev-bypass auth filter.
 *
 * Runtime orchestration helpers (getActiveTasks / getNextRunnableSubTask /
 * getAllRunnableSubTasks) stay local: they run the same dependency logic as before over
 * the tasks returned by listTasks/getTask, not via a dedicated endpoint.
 */

/** Java 404 (NotFoundException) — server-client throws with the status in the message. */
function isNotFound(err: unknown): boolean {
  return err instanceof Error && / -> 404\b/.test(err.message)
}

/** GET /api/task/{id} → TaskDetail, mapping a 404 to undefined (mirrors the old `rows[0] ? ... : undefined`). */
async function fetchTaskDetail(userId: string, taskId: string): Promise<TaskDetail | undefined> {
  try {
    return await serverGet<TaskDetail>(userId, `/api/task/${encodeURIComponent(taskId)}`)
  } catch (err) {
    if (isNotFound(err)) return undefined
    throw err
  }
}

export async function createTask(userId: string, name: string, description: string): Promise<Task> {
  return serverPost<Task>(userId, '/api/tasks', { name, description })
}

export async function updateTask(userId: string, taskId: string, updates: Partial<Pick<Task, 'status' | 'plan' | 'result' | 'error'>>): Promise<Task> {
  // Java PATCH overlays only the provided fields and returns the fully-assembled Task
  // (with subtasks), so we return it directly instead of re-fetching.
  return serverPatch<Task>(userId, `/api/task/${encodeURIComponent(taskId)}`, updates)
}

export async function addSubTask(userId: string, taskId: string, params: { name: string; description: string; assignee: string; domain?: string; cwd?: string; dependsOn?: string[] }): Promise<SubTask> {
  return serverPost<SubTask>(userId, `/api/task/${encodeURIComponent(taskId)}/subtasks`, params)
}

export async function updateSubTask(userId: string, taskId: string, subtaskId: string, updates: Partial<Pick<SubTask, 'status' | 'progress' | 'result' | 'error' | 'blockedReason'>>): Promise<SubTask> {
  // The Java endpoint is keyed by subtask id only (taskId is kept in the signature for
  // callers but is not needed server-side — the row already knows its parent task).
  void taskId
  return serverPatch<SubTask>(userId, `/api/subtask/${encodeURIComponent(subtaskId)}`, updates)
}

export async function getTask(userId: string, taskId: string): Promise<Task | undefined> {
  const detail = await fetchTaskDetail(userId, taskId)
  return detail?.task
}

export async function listTasks(userId: string): Promise<Task[]> {
  // GET /api/tasks returns { summary, tasks }; the old TS listTasks returned just Task[].
  const { tasks } = await serverGet<{ summary: string; tasks: Task[] }>(userId, '/api/tasks')
  return tasks
}

export async function cleanupStaleTasks(userId: string): Promise<void> {
  await serverPost(userId, '/api/tasks/cleanup-stale')
}

export async function getActiveTasks(userId: string): Promise<Task[]> {
  // Runtime orchestration: filter the user's tasks to the non-terminal ones locally
  // (was `status NOT IN ('completed','failed','cancelled')`).
  const tasks = await listTasks(userId)
  return tasks.filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
}

export async function getNextRunnableSubTask(userId: string, taskId: string): Promise<SubTask | undefined> {
  const task = await getTask(userId, taskId)
  if (!task) return undefined

  return task.subtasks.find(st => {
    if (st.status !== 'pending') return false
    if (!st.dependsOn || st.dependsOn.length === 0) return true
    return st.dependsOn.every(depId => {
      const dep = task.subtasks.find(d => d.id === depId)
      return dep?.status === 'completed'
    })
  })
}

export async function getAllRunnableSubTasks(userId: string, taskId: string): Promise<SubTask[]> {
  const task = await getTask(userId, taskId)
  if (!task) return []

  return task.subtasks.filter(st => {
    if (st.status !== 'pending') return false
    if (!st.dependsOn || st.dependsOn.length === 0) return true
    return st.dependsOn.every(depId => {
      const dep = task.subtasks.find(d => d.id === depId)
      return dep?.status === 'completed'
    })
  })
}

export async function getTaskSummary(userId: string): Promise<string> {
  // Java already computes the active-task overview string (same rules as the old TS),
  // returned as the `summary` field of GET /api/tasks.
  const { summary } = await serverGet<{ summary: string; tasks: Task[] }>(userId, '/api/tasks')
  return summary
}

export async function setSubtaskStarted(subtaskId: string, startedAt: string): Promise<void> {
  await serverPatch('local', `/api/subtask/${encodeURIComponent(subtaskId)}/started`, { startedAt })
}

export async function recordTurn(subtaskId: string, turnIndex: number, text: string, startedAt: string, endedAt: string): Promise<void> {
  await serverPost('local', `/api/subtask/${encodeURIComponent(subtaskId)}/turns`, { turnIndex, text, startedAt, endedAt })
}

export async function finalizeSubtaskMeta(subtaskId: string, meta: { turnCount: number; retryCount: number; tokensInput: number; tokensOutput: number }): Promise<void> {
  await serverPatch('local', `/api/subtask/${encodeURIComponent(subtaskId)}/meta`, meta)
}

export async function getSubtaskTurns(subtaskId: string): Promise<SubTaskTurn[]> {
  return serverGet<SubTaskTurn[]>('local', `/api/subtask/${encodeURIComponent(subtaskId)}/turns`)
}

export async function listSubtasksByAssignee(userId: string, assignee: string): Promise<Array<{ id: string; taskId: string; name: string; description: string; status: string; domain?: string; turnCount?: number; createdAt: string }>> {
  return serverGet(userId, `/api/recipe/${encodeURIComponent(assignee)}/subtasks`)
}

export async function getTaskDetail(userId: string, taskId: string): Promise<TaskDetail | undefined> {
  const detail = await fetchTaskDetail(userId, taskId)
  if (!detail) return undefined

  // Java assembles task + turnsBySubtask + artifacts, but has no A2A bus, so it returns
  // messagesBySubtask empty and conversation null. The bus lives in this process, so we
  // re-populate the conversation view locally (same mapping as the old direct-PG path).
  const messagesBySubtask: Record<string, SubtaskMessage[]> = {}
  for (const st of detail.task.subtasks) {
    const stConv = await bus.getConversation(st.id)
    messagesBySubtask[st.id] = stConv ? stConv.messages.map(m => ({
      id: m.id, from: m.from, to: m.to, role: m.role,
      parts: m.parts.map(p => ({ kind: p.kind, text: p.text })),
      timestamp: m.timestamp,
    })) : []
  }

  const conv = await bus.getConversation(taskId)
  const conversation = conv ? {
    contextId: conv.contextId,
    participants: conv.participants,
    messages: conv.messages.map(m => ({
      id: m.id, from: m.from, to: m.to, role: m.role,
      parts: m.parts.map(p => ({ kind: p.kind, text: p.text })),
      timestamp: m.timestamp,
    })),
  } : null

  return { ...detail, messagesBySubtask, conversation }
}
