import { useEffect, useState, useRef } from 'react'
import { fetchJSON } from '../api/client'
import { useSSE, parseSubtaskEvent } from '../api/hooks'
import './MonitorPanel.css'

interface MonitorItem {
  subtaskId: string
  taskId: string
  agentName: string
  agentType: 'permanent' | 'adhoc'
  taskName: string
  status: 'running' | 'done' | 'failed'
  turnCount: number
  currentTool?: string
  startedAtMs: number
  doneAtMs?: number
  error?: string
  /** Watchdog 标记:该项触发了巡检信号(卡住/超时/僵尸/连环失败) */
  warned?: boolean
  warnReason?: string
  warnDetail?: string
}

interface RunningTaskInit {
  subtaskId: string
  taskId: string
  recipeId: string
  description: string
  startedAt: number
  name?: string
  agentType?: 'permanent' | 'adhoc'
  turnCount?: number
  currentTool?: string
}

const FADE_MS = 30_000  // done/failed 保留 30s 后淡出

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export function MonitorPanel({ onOpen }: { onOpen: (taskId: string, subtaskId: string) => void }) {
  const [items, setItems] = useState<Map<string, MonitorItem>>(new Map())
  const [fading, setFading] = useState<Set<string>>(new Set())
  const [_tick, setTick] = useState(0)
  const { events } = useSSE('/events')
  const lastSeqRef = useRef(0)

  // 初始拉在跑列表——与 SSE 事件合并,避免快照(空)覆盖 SSE 已加的项
  useEffect(() => {
    fetchJSON<RunningTaskInit[]>('/api/agents').then(list => {
      setItems(prev => {
        const next = new Map(prev)
        for (const r of list) {
          if (next.has(r.subtaskId)) continue  // SSE 已带更新的 turnCount/currentTool,不覆盖
          next.set(r.subtaskId, {
            subtaskId: r.subtaskId, taskId: r.taskId,
            agentName: r.name || r.recipeId,
            agentType: r.agentType || 'adhoc',
            taskName: r.description.slice(0, 60),
            status: 'running', turnCount: r.turnCount ?? 0,
            currentTool: r.currentTool,
            startedAtMs: r.startedAt,
          })
        }
        return next
      })
    }).catch(() => {})
  }, [])

  // 消费 SSE subtask 事件——按 _seq 去重(events 数组封顶后下标不可靠,会丢事件)
  useEffect(() => {
    for (const evt of events) {
      const seq = evt._seq ?? 0
      if (seq <= lastSeqRef.current) continue
      lastSeqRef.current = seq

      // Watchdog 巡检信号:标黄对应项;僵尸任务可能不在面板里(会话已不在),补一个合成项
      if (evt.type === 'watchdog') {
        try {
          const p = JSON.parse(evt.content) as { taskId: string; subtaskId: string; agentName: string; taskName: string; reason: string; detail: string }
          setItems(prev => {
            const next = new Map(prev)
            const existing = next.get(p.subtaskId)
            next.set(p.subtaskId, {
              subtaskId: p.subtaskId, taskId: p.taskId,
              agentName: p.agentName, agentType: existing?.agentType ?? 'adhoc',
              taskName: p.taskName.slice(0, 60),
              status: 'running', turnCount: existing?.turnCount ?? 0,
              startedAtMs: existing?.startedAtMs ?? Date.now(),
              warned: true, warnReason: p.reason, warnDetail: p.detail,
            })
            return next
          })
        } catch { /* payload 异常忽略 */ }
        continue
      }

      if (evt.type !== 'subtask') continue
      const p = parseSubtaskEvent(evt.content)
      if (!p) continue
      setItems(prev => {
        const next = new Map(prev)
        const existing = next.get(p.subtaskId)
        next.set(p.subtaskId, {
          subtaskId: p.subtaskId, taskId: p.taskId,
          agentName: p.agentName, agentType: p.agentType || 'adhoc',
          taskName: p.taskName,
          status: p.status, turnCount: p.turnCount,
          currentTool: p.currentTool,
          startedAtMs: existing?.startedAtMs || (Date.now() - (p.elapsedMs || 0)),
          doneAtMs: p.status !== 'running' ? Date.now() : undefined,
          error: p.error,
          // watchdog 标记跨事件保留(新进展不清除警示,直到任务终态淡出)
          warned: existing?.warned, warnReason: existing?.warnReason, warnDetail: existing?.warnDetail,
        })
        return next
      })
    }
  }, [events])

  // done/failed 项 30s 后淡出并删除
  useEffect(() => {
    const timers: number[] = []
    for (const [id, item] of items) {
      if (item.status === 'running') continue
      if (fading.has(id)) continue
      const fadeAt = (item.doneAtMs || Date.now()) + FADE_MS - 600
      const removeAt = (item.doneAtMs || Date.now()) + FADE_MS
      const now = Date.now()
      timers.push(window.setTimeout(() => setFading(s => new Set(s).add(id)), Math.max(0, fadeAt - now)))
      timers.push(window.setTimeout(() => {
        setItems(prev => { const n = new Map(prev); n.delete(id); return n })
        setFading(prev => { const n = new Set(prev); n.delete(id); return n })
      }, Math.max(0, removeAt - now)))
    }
    return () => { for (const t of timers) clearTimeout(t) }
  }, [items, fading])

  // 每秒 tick 驱动 elapsed 显示
  useEffect(() => {
    const timer = window.setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const list = Array.from(items.values()).sort((a, b) => {
    if (a.status === 'running' && b.status !== 'running') return -1
    if (b.status === 'running' && a.status !== 'running') return 1
    return b.startedAtMs - a.startedAtMs
  })
  const runningCount = list.filter(x => x.status === 'running').length

  // 空态也渲染(抽屉模式:用户点了开关就要看到面板,显示「暂无执行中任务」)

  return (
    <aside className="monitor">
      <div className="monitor-head">
        <span className="monitor-title">执行中</span>
        {runningCount > 0 && <span className="monitor-badge">{runningCount}</span>}
      </div>
      <div className="monitor-list">
        {list.length === 0 && <div className="mon-empty">暂无执行中任务</div>}
        {list.map(item => {
          const elapsed = item.status === 'running'
            ? Date.now() - item.startedAtMs
            : (item.doneAtMs || Date.now()) - item.startedAtMs
          return (
            <div
              key={item.subtaskId}
              className={`mon-item${fading.has(item.subtaskId) ? ' fading' : ''}${item.warned ? ' warned' : ''}`}
              data-state={item.status}
              onClick={() => onOpen(item.taskId, item.subtaskId)}
            >
              <div className="mon-row1">
                <span className="mon-dot"></span>
                <span className={`mon-type-badge ${item.agentType}`}>
                  {item.agentType === 'permanent' ? '正式' : '临时'}
                </span>
                <span className="mon-name">{item.agentName}</span>
                <span className="mon-spacer"></span>
                {item.warned && <span className="mon-warn" title={item.warnDetail}>⚠ {item.warnReason === 'zombie' ? '会话掉线' : item.warnReason === 'idle' ? '没动静' : item.warnReason === 'overtime' ? '跑太久' : '反复失败'}</span>}
                <span className="mon-status">
                  {item.status === 'running' ? '执行中' : item.status === 'done' ? '已完成' : '执行失败'}
                </span>
              </div>
              <div className="mon-task" title={item.taskName}>{item.taskName}</div>
              <div className="mon-meter">
                回合 <b>{item.turnCount}</b> · {fmtElapsed(elapsed)}
                {item.currentTool && <><span>·</span><span className="mon-tool">{item.currentTool}</span></>}
              </div>
              {item.status === 'running' && <div className="mon-pulse-bar"></div>}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
