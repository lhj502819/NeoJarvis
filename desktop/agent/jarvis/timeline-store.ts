import { existsSync, readdirSync, readFileSync, renameSync } from 'fs'
import { join } from 'path'
import { docGet, docList, docPut } from '../shared/docs.js'

/**
 * 对话流时间线持久化(superagent-v2 P0):
 * 原 data/timeline/<userId>/ 下的 JSON/JSONL 文件已迁入通用文档表 jarvis_agent_docs ——
 *   kind='timeline'  key=messageId → 思考/工具时间线数组
 *   kind='comms'     key=`<at>-<rand>` → 小弟 ↔ Jarvis 沟通日志条目(追加即 put)
 * 运行时状态一律进数据库;首次访问时旧文件一次性导入,旧用户目录改名 .migrated 留档。
 * 数据为 UI 展示态;工具明细的权威副本仍在 jarvis_tool_traces(Java/PG)。
 */

const LEGACY_ROOT = join(process.cwd(), 'data', 'timeline')

const TIMELINE_KIND = 'timeline'
const COMMS_KIND = 'comms'

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

// 旧目录名的净化规则必须与历史版本一致(非 [a-zA-Z0-9_-] → '_'),否则导入找不到旧文件
const legacyUserDir = (userId: string): string => join(LEGACY_ROOT, userId.replace(/[^a-zA-Z0-9_-]/g, '_'))

/** 旧文件目录一次性导入当前用户的时间线与沟通日志;完成后目录改名 .migrated-<ts>。 */
async function migrateLegacy(userId: string): Promise<void> {
  const dir = legacyUserDir(userId)
  if (!existsSync(dir)) return
  let timelines = 0
  let comms = 0
  try {
    for (const f of readdirSync(dir)) {
      try {
        if (f.endsWith('.json')) {
          const messageId = Number(f.replace('.json', ''))
          const timeline = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as TimelineEntry[]
          if (Number.isFinite(messageId) && Array.isArray(timeline)) {
            await docPut(userId, TIMELINE_KIND, String(messageId), timeline)
            timelines++
          }
        } else if (f === 'comms.jsonl') {
          for (const line of readFileSync(join(dir, f), 'utf-8').split('\n').filter(Boolean)) {
            const entry = JSON.parse(line) as CommsEntry
            await docPut(userId, COMMS_KIND, `${entry.at}-${Math.random().toString(36).slice(2, 7)}`, entry)
            comms++
          }
        }
      } catch { /* 单文件损坏跳过 */ }
    }
    renameSync(dir, `${dir}.migrated-${Date.now()}`)
    console.log(`[timeline] 旧文件已导入文档表(timeline ${timelines} 条,comms ${comms} 条)`)
  } catch (err) {
    console.error(`[timeline] 旧文件导入失败(忽略,走空状态): ${err instanceof Error ? err.message : err}`)
  }
}

// ── 时间线采集器:think() 内部随 onEvent 累积(服务端权威副本,纯函数不动) ──

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

// ── 读写(全部异步,落 jarvis_agent_docs) ──

export async function saveTimeline(userId: string, messageId: number, timeline: TimelineEntry[]): Promise<void> {
  if (!timeline.length) return
  await docPut(userId, TIMELINE_KIND, String(messageId), timeline)
}

export async function getAllTimelines(userId: string): Promise<Array<{ messageId: number; timeline: TimelineEntry[] }>> {
  let items = await docList<TimelineEntry[]>(userId, TIMELINE_KIND)
  if (items.length === 0 && existsSync(legacyUserDir(userId))) {
    await migrateLegacy(userId)
    items = await docList<TimelineEntry[]>(userId, TIMELINE_KIND)
  }
  return items
    .map(({ key, data }) => ({ messageId: Number(key), timeline: data }))
    .filter(it => Number.isFinite(it.messageId) && Array.isArray(it.timeline))
    .sort((a, b) => a.messageId - b.messageId)
}

export async function getTimeline(userId: string, messageId: number): Promise<TimelineEntry[]> {
  return await docGet<TimelineEntry[]>(userId, TIMELINE_KIND, String(messageId)) ?? []
}

export async function appendComms(userId: string, entry: CommsEntry): Promise<void> {
  await docPut(userId, COMMS_KIND, `${entry.at}-${Math.random().toString(36).slice(2, 7)}`, entry)
}

export async function getComms(userId: string, limit = 200): Promise<CommsEntry[]> {
  let items = await docList<CommsEntry>(userId, COMMS_KIND, '', limit)
  if (items.length === 0 && existsSync(join(legacyUserDir(userId), 'comms.jsonl'))) {
    await migrateLegacy(userId)
    items = await docList<CommsEntry>(userId, COMMS_KIND, '', limit)
  }
  // 文档表按 id 倒序(最新在前);沟通日志消费方按时间正序归位,这里反转回正序
  return items.map(i => i.data).reverse()
}
