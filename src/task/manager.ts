import { randomUUID } from 'crypto'
import type { Task, SubTask, TaskStatus, SubTaskStatus } from '../shared/types.js'
import db from '../shared/db.js'

function rowToSubTask(row: any): SubTask {
  return {
    id: row.id,
    taskId: row.task_id,
    name: row.name,
    description: row.description,
    assignee: row.assignee,
    domain: row.domain || undefined,
    cwd: row.cwd || undefined,
    status: row.status,
    progress: row.progress || undefined,
    result: row.result || undefined,
    error: row.error || undefined,
    blockedReason: row.blocked_reason || undefined,
    dependsOn: row.depends_on ? JSON.parse(row.depends_on) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function loadSubTasks(taskId: string): SubTask[] {
  const rows = db.prepare('SELECT * FROM jarvis_subtasks WHERE task_id = ?').all(taskId) as any[]
  return rows.map(rowToSubTask)
}

function rowToTask(row: any): Task {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    plan: row.plan || undefined,
    subtasks: loadSubTasks(row.id),
    result: row.result || undefined,
    error: row.error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createTask(userId: string, name: string, description: string): Task {
  const id = randomUUID().slice(0, 8)
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO jarvis_tasks (id, user_id, name, description, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'created', ?, ?)
  `).run(id, userId, name, description, now, now)

  return {
    id,
    name,
    description,
    status: 'created',
    subtasks: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function updateTask(userId: string, taskId: string, updates: Partial<Pick<Task, 'status' | 'plan' | 'result' | 'error'>>): Task {
  const row = db.prepare('SELECT * FROM jarvis_tasks WHERE id = ? AND user_id = ?').get(taskId, userId) as any
  if (!row) throw new Error(`Task ${taskId} not found`)

  const now = new Date().toISOString()
  const sets: string[] = ['updated_at = ?']
  const values: any[] = [now]

  if (updates.status !== undefined) { sets.push('status = ?'); values.push(updates.status) }
  if (updates.plan !== undefined) { sets.push('plan = ?'); values.push(updates.plan) }
  if (updates.result !== undefined) { sets.push('result = ?'); values.push(updates.result) }
  if (updates.error !== undefined) { sets.push('error = ?'); values.push(updates.error) }

  values.push(taskId, userId)
  db.prepare(`UPDATE jarvis_tasks SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...values)

  return getTask(userId, taskId)!
}

export function addSubTask(userId: string, taskId: string, params: { name: string; description: string; assignee: string; domain?: string; cwd?: string; dependsOn?: string[] }): SubTask {
  const taskRow = db.prepare('SELECT id FROM jarvis_tasks WHERE id = ? AND user_id = ?').get(taskId, userId)
  if (!taskRow) throw new Error(`Task ${taskId} not found`)

  const id = randomUUID().slice(0, 8)
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO jarvis_subtasks (id, task_id, user_id, name, description, assignee, domain, cwd, status, depends_on, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(id, taskId, userId, params.name, params.description, params.assignee, params.domain || null, params.cwd || null, params.dependsOn ? JSON.stringify(params.dependsOn) : null, now, now)

  db.prepare('UPDATE jarvis_tasks SET updated_at = ? WHERE id = ?').run(now, taskId)

  return {
    id,
    taskId,
    name: params.name,
    description: params.description,
    assignee: params.assignee,
    domain: params.domain,
    cwd: params.cwd,
    status: 'pending',
    dependsOn: params.dependsOn,
    createdAt: now,
    updatedAt: now,
  }
}

export function updateSubTask(userId: string, taskId: string, subtaskId: string, updates: Partial<Pick<SubTask, 'status' | 'progress' | 'result' | 'error' | 'blockedReason'>>): SubTask {
  const row = db.prepare('SELECT * FROM jarvis_subtasks WHERE id = ? AND task_id = ?').get(subtaskId, taskId) as any
  if (!row) throw new Error(`SubTask ${subtaskId} not found`)

  const now = new Date().toISOString()
  const sets: string[] = ['updated_at = ?']
  const values: any[] = [now]

  if (updates.status !== undefined) { sets.push('status = ?'); values.push(updates.status) }
  if (updates.progress !== undefined) { sets.push('progress = ?'); values.push(updates.progress) }
  if (updates.result !== undefined) { sets.push('result = ?'); values.push(updates.result) }
  if (updates.error !== undefined) { sets.push('error = ?'); values.push(updates.error) }
  if (updates.blockedReason !== undefined) { sets.push('blocked_reason = ?'); values.push(updates.blockedReason) }

  values.push(subtaskId, taskId)
  db.prepare(`UPDATE jarvis_subtasks SET ${sets.join(', ')} WHERE id = ? AND task_id = ?`).run(...values)

  db.prepare('UPDATE jarvis_tasks SET updated_at = ? WHERE id = ?').run(now, taskId)

  return rowToSubTask(db.prepare('SELECT * FROM jarvis_subtasks WHERE id = ?').get(subtaskId) as any)
}

export function getTask(userId: string, taskId: string): Task | undefined {
  const row = db.prepare('SELECT * FROM jarvis_tasks WHERE id = ? AND user_id = ?').get(taskId, userId) as any
  return row ? rowToTask(row) : undefined
}

export function listTasks(userId: string): Task[] {
  const rows = db.prepare('SELECT * FROM jarvis_tasks WHERE user_id = ? ORDER BY created_at DESC').all(userId) as any[]
  return rows.map(rowToTask)
}

export function cleanupStaleTasks(userId: string) {
  const now = new Date().toISOString()
  db.prepare(`
    UPDATE jarvis_tasks SET status = 'cancelled', error = '进程重启，任务自动取消', updated_at = ?
    WHERE user_id = ? AND status IN ('executing', 'planning')
  `).run(now, userId)

  db.prepare(`
    UPDATE jarvis_subtasks SET status = 'cancelled', updated_at = ?
    WHERE user_id = ? AND status IN ('running', 'pending')
  `).run(now, userId)
}

export function getActiveTasks(userId: string): Task[] {
  const rows = db.prepare(`SELECT * FROM jarvis_tasks WHERE user_id = ? AND status NOT IN ('completed', 'failed', 'cancelled')`).all(userId) as any[]
  return rows.map(rowToTask)
}

export function getNextRunnableSubTask(userId: string, taskId: string): SubTask | undefined {
  const task = getTask(userId, taskId)
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

export function getAllRunnableSubTasks(userId: string, taskId: string): SubTask[] {
  const task = getTask(userId, taskId)
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

export function getTaskSummary(userId: string): string {
  const tasks = listTasks(userId)
  if (tasks.length === 0) return '当前没有任何任务。'

  return tasks
    .filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
    .map(t => {
      const subtaskLines = t.subtasks
        .map(st => `  - ${st.name} [${st.status}]${st.progress ? ` ${st.progress}` : ''}`)
        .join('\n')
      return `[${t.status}] ${t.name} (id: ${t.id})\n  ${t.description}\n${subtaskLines}`
    })
    .join('\n\n') || '当前没有活跃任务。'
}
