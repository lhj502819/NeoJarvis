import { randomUUID } from 'crypto'
import type { Task, SubTask, TaskStatus, SubTaskStatus } from '../shared/types.js'
import pool from '../shared/db.js'

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

async function loadSubTasks(taskId: string): Promise<SubTask[]> {
  const { rows } = await pool.query('SELECT * FROM jarvis_subtasks WHERE task_id = $1', [taskId])
  return rows.map(rowToSubTask)
}

async function rowToTask(row: any): Promise<Task> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    plan: row.plan || undefined,
    subtasks: await loadSubTasks(row.id),
    result: row.result || undefined,
    error: row.error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function createTask(userId: string, name: string, description: string): Promise<Task> {
  const id = randomUUID().slice(0, 8)
  const now = new Date().toISOString()

  await pool.query(`
    INSERT INTO jarvis_tasks (id, user_id, name, description, status, created_at, updated_at)
    VALUES ($1, $2, $3, $4, 'created', $5, $6)
  `, [id, userId, name, description, now, now])

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

export async function updateTask(userId: string, taskId: string, updates: Partial<Pick<Task, 'status' | 'plan' | 'result' | 'error'>>): Promise<Task> {
  const { rows: taskRows } = await pool.query('SELECT * FROM jarvis_tasks WHERE id = $1 AND user_id = $2', [taskId, userId])
  if (!taskRows[0]) throw new Error(`Task ${taskId} not found`)

  const now = new Date().toISOString()
  let paramIdx = 1
  const sets: string[] = [`updated_at = $${paramIdx++}`]
  const values: any[] = [now]

  if (updates.status !== undefined) { sets.push(`status = $${paramIdx++}`); values.push(updates.status) }
  if (updates.plan !== undefined) { sets.push(`plan = $${paramIdx++}`); values.push(updates.plan) }
  if (updates.result !== undefined) { sets.push(`result = $${paramIdx++}`); values.push(updates.result) }
  if (updates.error !== undefined) { sets.push(`error = $${paramIdx++}`); values.push(updates.error) }

  values.push(taskId, userId)
  await pool.query(`UPDATE jarvis_tasks SET ${sets.join(', ')} WHERE id = $${paramIdx++} AND user_id = $${paramIdx++}`, values)

  return (await getTask(userId, taskId))!
}

export async function addSubTask(userId: string, taskId: string, params: { name: string; description: string; assignee: string; domain?: string; cwd?: string; dependsOn?: string[] }): Promise<SubTask> {
  const { rows: taskRows } = await pool.query('SELECT id FROM jarvis_tasks WHERE id = $1 AND user_id = $2', [taskId, userId])
  if (!taskRows[0]) throw new Error(`Task ${taskId} not found`)

  const id = randomUUID().slice(0, 8)
  const now = new Date().toISOString()

  await pool.query(`
    INSERT INTO jarvis_subtasks (id, task_id, user_id, name, description, assignee, domain, cwd, status, depends_on, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11)
  `, [id, taskId, userId, params.name, params.description, params.assignee, params.domain || null, params.cwd || null, params.dependsOn ? JSON.stringify(params.dependsOn) : null, now, now])

  await pool.query('UPDATE jarvis_tasks SET updated_at = $1 WHERE id = $2', [now, taskId])

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

export async function updateSubTask(userId: string, taskId: string, subtaskId: string, updates: Partial<Pick<SubTask, 'status' | 'progress' | 'result' | 'error' | 'blockedReason'>>): Promise<SubTask> {
  const { rows: stRows } = await pool.query('SELECT * FROM jarvis_subtasks WHERE id = $1 AND task_id = $2', [subtaskId, taskId])
  if (!stRows[0]) throw new Error(`SubTask ${subtaskId} not found`)

  const now = new Date().toISOString()
  let paramIdx = 1
  const sets: string[] = [`updated_at = $${paramIdx++}`]
  const values: any[] = [now]

  if (updates.status !== undefined) { sets.push(`status = $${paramIdx++}`); values.push(updates.status) }
  if (updates.progress !== undefined) { sets.push(`progress = $${paramIdx++}`); values.push(updates.progress) }
  if (updates.result !== undefined) { sets.push(`result = $${paramIdx++}`); values.push(updates.result) }
  if (updates.error !== undefined) { sets.push(`error = $${paramIdx++}`); values.push(updates.error) }
  if (updates.blockedReason !== undefined) { sets.push(`blocked_reason = $${paramIdx++}`); values.push(updates.blockedReason) }

  values.push(subtaskId, taskId)
  await pool.query(`UPDATE jarvis_subtasks SET ${sets.join(', ')} WHERE id = $${paramIdx++} AND task_id = $${paramIdx++}`, values)

  await pool.query('UPDATE jarvis_tasks SET updated_at = $1 WHERE id = $2', [now, taskId])

  const { rows: updatedRows } = await pool.query('SELECT * FROM jarvis_subtasks WHERE id = $1', [subtaskId])
  return rowToSubTask(updatedRows[0])
}

export async function getTask(userId: string, taskId: string): Promise<Task | undefined> {
  const { rows } = await pool.query('SELECT * FROM jarvis_tasks WHERE id = $1 AND user_id = $2', [taskId, userId])
  return rows[0] ? await rowToTask(rows[0]) : undefined
}

export async function listTasks(userId: string): Promise<Task[]> {
  const { rows } = await pool.query('SELECT * FROM jarvis_tasks WHERE user_id = $1 ORDER BY created_at DESC', [userId])
  return Promise.all(rows.map(rowToTask))
}

export async function cleanupStaleTasks(userId: string): Promise<void> {
  const now = new Date().toISOString()
  await pool.query(`
    UPDATE jarvis_tasks SET status = 'cancelled', error = '进程重启，任务自动取消', updated_at = $1
    WHERE user_id = $2 AND status IN ('executing', 'planning')
  `, [now, userId])

  await pool.query(`
    UPDATE jarvis_subtasks SET status = 'cancelled', updated_at = $1
    WHERE user_id = $2 AND status IN ('running', 'pending')
  `, [now, userId])
}

export async function getActiveTasks(userId: string): Promise<Task[]> {
  const { rows } = await pool.query(`SELECT * FROM jarvis_tasks WHERE user_id = $1 AND status NOT IN ('completed', 'failed', 'cancelled')`, [userId])
  return Promise.all(rows.map(rowToTask))
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
  const tasks = await listTasks(userId)
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
