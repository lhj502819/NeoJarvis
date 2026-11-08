import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'fs'
import { join } from 'path'

/**
 * 对话流时间线持久化(TS 文件存储,Java 零改动)。
 *
 *   data/timeline/<userId>/<messageId>.json  —— 每条 jarvis 消息的思考/工具时间线
 *   data/timeline/<userId>/comms.jsonl       —— 小弟 ↔ Jarvis 沟通日志(追加)
 *
 * 刷新后前端随历史一起拉取,思考过程与工具记录、沟通卡片在对话流里还原。
 * 数据为 UI 展示态;工具明细的权威副本仍在 jarvis_tool_traces(Java/PG)。
 */

const ROOT = join(process.cwd(), 'data', 'timeline')

export interface TimelineEntry {
  type: 'thought' | 'tool'
  text?: string
  name?: string
  args?: string
  status: 'running' | 'ok' | 'error'
  startedAt: number
  endedAt?: number
}

export interface CommsEntry {
  at: number
  dir: 'to_jarvis' | 'to_worker'
  agentName: string
  type?: string
  content: string
}

const userDir = (userId: string): string => join(ROOT, userId.replace(/[^a-zA-Z0-9_-]/g, '_'))

// ── 时间线采集器:think() 内部随 onEvent 累积(服务端权威副本) ──

export function createTimelineCollector(startedAt = Date.now()) {
  // 先放一个思考段占位：即使模型不吐 thought_delta，也能在刷新后还原“思考了多久”。
  // 纯文本、无工具、无思考文本的快速回复不会落盘（hasContent 为 false），避免噪音。
  const tl: TimelineEntry[] = [{ type: 'thought', text: '', status: 'running', startedAt }]
  return {
    onEvent(type: string, content: string): void {
      const now = Date.now()
      if (type === 'thought_delta') {
        const last = tl[tl.length - 1]
        if (last && last.type === 'thought' && last.status === 'running') {
          last.text = (last.text ?? '') + content
        } else {
          tl.push({ type: 'thought', text: content, status: 'running', startedAt: now })
        }
        return
      }
      if (type === 'tool_use') {
        try {
          const d = JSON.parse(content) as { name: string; args?: string }
          // 工具开始 = 思考段结束
          const last = tl[tl.length - 1]
          if (last && last.type === 'thought' && last.status === 'running') last.endedAt = now
          tl.push({ type: 'tool', name: d.name, args: d.args, status: 'running', startedAt: now })
        } catch { /* ignore */ }
        return
      }
      if (type === 'tool_done') {
        try {
          const d = JSON.parse(content) as { name: string; isError?: boolean }
          for (let k = tl.length - 1; k >= 0; k--) {
            const e = tl[k]
            if (e.type === 'tool' && e.name === d.name && e.status === 'running') {
              e.status = d.isError ? 'error' : 'ok'
              e.endedAt = now
              break
            }
          }
        } catch { /* ignore */ }
        return
      }
    },
    timeline(): TimelineEntry[] {
      // 返回前收敛:仍在 running 的段以当前时刻收尾
      const now = Date.now()
      return tl.map(e => e.status === 'running' ? { ...e, status: 'ok', endedAt: e.endedAt ?? now } : e)
    },
    hasContent(): boolean {
      // 只有占位思考段 → 不落盘；有工具或有思考文本才值得还原
      return tl.some(e => e.type === 'tool' || (e.type === 'thought' && (e.text ?? '').length > 0))
    },
  }
}

// ── 读写 ──

export function saveTimeline(userId: string, messageId: number, timeline: TimelineEntry[]): void {
  if (!timeline.length) return
  const dir = userDir(userId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${messageId}.json`), JSON.stringify(timeline), 'utf-8')
}

export function getAllTimelines(userId: string): Array<{ messageId: number; timeline: TimelineEntry[] }> {
  const dir = userDir(userId)
  if (!existsSync(dir)) return []
  const out: Array<{ messageId: number; timeline: TimelineEntry[] }> = []
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      try {
        const messageId = Number(f.replace('.json', ''))
        const timeline = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as TimelineEntry[]
        if (Number.isFinite(messageId) && Array.isArray(timeline)) out.push({ messageId, timeline })
      } catch { /* 单文件损坏跳过 */ }
    }
  } catch { /* ignore */ }
  return out.sort((a, b) => a.messageId - b.messageId)
}

export function getTimeline(userId: string, messageId: number): TimelineEntry[] {
  const file = join(userDir(userId), `${messageId}.json`)
  if (!existsSync(file)) return []
  try { return JSON.parse(readFileSync(file, 'utf-8')) as TimelineEntry[] } catch { return [] }
}

export function appendComms(userId: string, entry: CommsEntry): void {
  const dir = userDir(userId)
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, 'comms.jsonl'), `${JSON.stringify(entry)}\n`, 'utf-8')
}

export function getComms(userId: string, limit = 200): CommsEntry[] {
  const file = join(userDir(userId), 'comms.jsonl')
  if (!existsSync(file)) return []
  try {
    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean)
    return lines.slice(-limit).map(l => JSON.parse(l) as CommsEntry)
  } catch {
    return []
  }
}
