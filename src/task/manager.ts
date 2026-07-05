import { randomUUID } from 'crypto'
import type { Task, SubTask, TaskStatus, SubTaskStatus } from '../shared/types.js'
import { loadJson, saveJson } from '../shared/store.js'

const TASKS_FILE = 'tasks.json'

function load(): Task[] {
  return loadJson<Task[]>(TASKS_FILE, [])
}

function save(tasks: Task[]) {
  saveJson(TASKS_FILE, tasks)
}

export function createTask(name: string, description: string): Task {
  const tasks = load()
  const task: Task = {
    id: randomUUID().slice(0, 8),
    name,
    description,
    status: 'created',
    subtasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  tasks.push(task)
  save(tasks)
  return task
}

export function updateTask(taskId: string, updates: Partial<Pick<Task, 'status' | 'plan' | 'result' | 'error'>>): Task {
  const tasks = load()
  const task = tasks.find(t => t.id === taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)

  Object.assign(task, updates, { updatedAt: new Date().toISOString() })
  save(tasks)
  return task
}

export function addSubTask(taskId: string, params: { name: string; description: string; assignee: string; dependsOn?: string[] }): SubTask {
  const tasks = load()
  const task = tasks.find(t => t.id === taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)

  const subtask: SubTask = {
    id: randomUUID().slice(0, 8),
    taskId,
    name: params.name,
    description: params.description,
    assignee: params.assignee,
    status: 'pending',
    dependsOn: params.dependsOn,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  task.subtasks.push(subtask)
  task.updatedAt = new Date().toISOString()
  save(tasks)
  return subtask
}

export function updateSubTask(taskId: string, subtaskId: string, updates: Partial<Pick<SubTask, 'status' | 'progress' | 'result' | 'error' | 'blockedReason'>>): SubTask {
  const tasks = load()
  const task = tasks.find(t => t.id === taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)

  const subtask = task.subtasks.find(st => st.id === subtaskId)
  if (!subtask) throw new Error(`SubTask ${subtaskId} not found`)

  Object.assign(subtask, updates, { updatedAt: new Date().toISOString() })
  task.updatedAt = new Date().toISOString()
  save(tasks)
  return subtask
}

export function getTask(taskId: string): Task | undefined {
  return load().find(t => t.id === taskId)
}

export function listTasks(): Task[] {
  return load()
}

export function cleanupStaleTasks() {
  const tasks = load()
  let changed = false
  for (const task of tasks) {
    if (task.status === 'executing' || task.status === 'planning') {
      task.status = 'cancelled'
      task.error = '进程重启，任务自动取消'
      task.updatedAt = new Date().toISOString()
      changed = true
    }
    for (const st of task.subtasks) {
      if (st.status === 'running' || st.status === 'pending') {
        st.status = 'cancelled'
        st.updatedAt = new Date().toISOString()
        changed = true
      }
    }
  }
  if (changed) save(tasks)
}

export function getActiveTasks(): Task[] {
  return load().filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
}

export function getNextRunnableSubTask(taskId: string): SubTask | undefined {
  const task = getTask(taskId)
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

export function getAllRunnableSubTasks(taskId: string): SubTask[] {
  const task = getTask(taskId)
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

export function getTaskSummary(): string {
  const tasks = load()
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
