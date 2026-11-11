import { useEffect, useState, type ReactNode } from 'react'
import { fetchJSON, postJSON } from '../../api/client'
import type { MessageOrigin } from '../../api/hooks'

/**
 * 运行面板(P6,原型 diagram/jarvis-runtime-panel/prototype.svg):
 * 消息处理流水(每条消息的入口/路由/上下文组装/机制命中/去向)+ 队列 + 事件源心跳 + 记忆构成。
 * 数据源:/api/traces(mtrace 文档表)、/api/queue、/api/heartbeat、/api/approvals、/api/agents。
 */

interface TraceStage {
  at: number
  stage: string
  detail?: string
  mech?: string
}

interface MessageTrace {
  id: string
  at: number
  channel: 'jdsme-group' | 'jdsme-dm' | 'web' | 'xingyun'
  chatName?: string
  sender?: string
  textPreview: string
  stages: TraceStage[]
  context?: Record<string, number>
  contextTotal?: number
  outcome?: string
  costMs?: number
}

interface ApprovalRecord {
  id: string
  title: string
  status: 'pending' | 'approved' | 'rejected'
  at: number
  policyVersion: string
}

const OUTCOME_BADGE: Record<string, { label: string; tone: 'blue' | 'cyan' | 'rose' | 'amber' | 'slate' }> = {
  'direct-through': { label: '直通 → 小弟', tone: 'blue' },
  'replied': { label: 'brain · 已回复', tone: 'cyan' },
  'dropped-gate': { label: 'gate 过滤', tone: 'rose' },
  'dropped-noise': { label: '噪音丢弃', tone: 'rose' },
  'dropped-greeting': { label: '寒暄静默', tone: 'rose' },
  'dropped-dup': { label: '重复丢弃', tone: 'slate' },
  'pending-approval': { label: '审批中', tone: 'amber' },
  'dispatched': { label: '已派工', tone: 'amber' },
  'error': { label: '执行出错', tone: 'rose' },
  'card-closed': { label: '卡片关闭收尾', tone: 'slate' },
}

const CHANNEL_LABEL: Record<string, string> = {
  'jdsme-group': '京ME群',
  'jdsme-dm': '京ME私聊',
  'web': 'web',
  'xingyun': '行云',
}

const KNOWN_MECHS = [
  'gate-explicit', 'gate-filter', 'gate-candidates', 'dm-bypass', 'dedup',
  '订阅直通', '订阅登记', '寒暄静默', 'LLM分诊', 'queue-wait',
  '接单门槛', 'handback', '审批', '审批-auto', '记忆检索(已下线)',
]

function fmtTime(at?: number): string {
  if (!at) return '—'
  return new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtCost(ms?: number): string {
  if (ms === undefined) return '—'
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

export function RunningPage() {
  const [traces, setTraces] = useState<MessageTrace[]>([])
  const [selected, setSelected] = useState<MessageTrace | null>(null)
  const [queue, setQueue] = useState<{ pending: number; thinking: boolean } | null>(null)
  const [heartbeat, setHeartbeat] = useState<any>(null)
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([])
  const [runningTasks, setRunningTasks] = useState<Array<{ taskId: string; name: string }>>([])
  const [counts, setCounts] = useState<{ conversation: number; artifacts: number; tasks: number }>({ conversation: 0, artifacts: 0, tasks: 0 })
  const [filter, setFilter] = useState<'all' | 'dropped' | 'direct'>('all')

  const load = () => {
    fetchJSON<{ traces: MessageTrace[] }>('/api/traces').then(r => {
      setTraces(r.traces ?? [])
      if (r.traces?.length) setSelected(prev => prev ? (r.traces.find(t => t.id === prev.id) ?? prev) : r.traces[0])
      else setSelected(null)
    }).catch(() => {})
    fetchJSON<{ pending: number; thinking: boolean }>('/api/queue').then(setQueue).catch(() => {})
    fetchJSON<any>('/api/heartbeat').then(setHeartbeat).catch(() => {})
    fetchJSON<{ approvals: ApprovalRecord[] }>('/api/approvals').then(r => setApprovals(r.approvals ?? [])).catch(() => {})
    fetchJSON<any[]>('/api/agents').then(r => setRunningTasks(r ?? [])).catch(() => {})
    fetchJSON<any[]>('/api/conversation').then(r => setCounts(c => ({ ...c, conversation: r.length }))).catch(() => {})
    fetchJSON<{ total: number }>('/api/artifacts?limit=1').then(r => setCounts(c => ({ ...c, artifacts: r.total ?? 0 }))).catch(() => {})
    fetchJSON<{ tasks: any[] }>('/api/tasks').then(r => setCounts(c => ({ ...c, tasks: r.tasks?.length ?? 0 }))).catch(() => {})
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 10_000)
    return () => clearInterval(timer)
  }, [])

  const pendingApprovals = approvals.filter(a => a.status === 'pending')

  const decide = async (id: string, action: 'approve' | 'reject', withGroup = false) => {
    try {
      await postJSON(`/api/approvals/${encodeURIComponent(id)}/decide`, { action, withGroup })
      load()
    } catch { /* 静默,列表刷新见分晓 */ }
  }

  const clearMemory = async () => {
    if (!window.confirm('清空记忆:对话+执行痕迹+派生状态全部删除,不可逆。确认?')) return
    await postJSON('/api/memory/reset', {})
    load()
  }

  const filteredTraces = traces.filter(t => {
    if (filter === 'dropped') return t.outcome?.startsWith('dropped')
    if (filter === 'direct') return t.outcome === 'direct-through'
    return true
  })

  const c = heartbeat?.counters ?? {}
  const jdsme = heartbeat?.jdsme ?? {}

  return (
    <div className="run-page">
      <div className="run-head">
        <h2>运行面板</h2>
        <span className="run-refresh">10s 自动刷新</span>
      </div>

      {/* 概览条 */}
      <div className="run-metrics">
        <Metric num={runningTasks.length} label="运行中任务" tone="green" sub="watchdog 巡检中" />
        <Metric num={queue?.pending ?? 0} label="排队后台消息" tone="slate" sub="等当前对话结束" />
        <Metric num={pendingApprovals.length} label="待审批" tone="amber" sub="行云卡 · 审批模式" />
        <Metric num={(c['jdsme-passed'] ?? 0) + (c['direct-through'] ?? 0)} label="今日进消息" tone="white" sub={`京ME ${c['jdsme-passed'] ?? 0} · 直通 ${c['direct-through'] ?? 0}`} />
        <Metric num={c['direct-through'] ?? 0} label="直通命中" tone="blue" sub="不过 brain,直达小弟" />
        <Metric num={(c['jdsme-gate-filtered'] ?? 0) + (c['noise-dropped'] ?? 0) + (c['greeting-silent'] ?? 0)} label="噪音过滤" tone="rose" sub={`gate ${c['jdsme-gate-filtered'] ?? 0} · 寒暄 ${c['greeting-silent'] ?? 0} · 分诊 ${c['noise-dropped'] ?? 0}`} />
      </div>

      {/* 消息处理流水 */}
      <div className="run-card">
        <div className="run-card-head">
          <span className="run-card-title cyan">消息处理流水</span>
          <span className="run-hint">最近 {traces.length} 条 · 点开一行看处理链与上下文组装</span>
          <span className="run-filters">
            {([['all', '全部'], ['direct', '直通'], ['dropped', '被丢弃']] as const).map(([k, label]) => (
              <button key={k} className={`run-chip${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </span>
        </div>
        <div className="run-table">
          <div className="run-tr run-tr-head">
            <span>时间</span><span>信道</span><span>发送人</span><span>摘要</span><span>路由结果</span><span>耗时</span>
          </div>
          {filteredTraces.map(t => {
            const badge = OUTCOME_BADGE[t.outcome ?? ''] ?? { label: t.outcome ?? '处理中', tone: 'slate' as const }
            return (
              <div
                key={t.id}
                className={`run-tr${selected?.id === t.id ? ' selected' : ''}`}
                onClick={() => setSelected(t)}
              >
                <span>{fmtTime(t.at)}</span>
                <span>{CHANNEL_LABEL[t.channel] ?? t.channel}</span>
                <span>{t.sender ?? '—'}</span>
                <span className="run-summary">{t.textPreview}</span>
                <span><span className={`run-badge ${badge.tone}`}>{badge.label}</span></span>
                <span>{fmtCost(t.costMs)}</span>
              </div>
            )
          })}
          {filteredTraces.length === 0 && <div className="run-empty">暂无流水。发条消息(京ME/web)就会出现。</div>}
        </div>
      </div>

      {/* 详情抽屉(内联展开) */}
      {selected && <TraceDetail trace={selected} />}

      {/* 队列 + 待审批 */}
      <div className="run-grid2">
        <div className="run-card">
          <div className="run-card-head"><span className="run-card-title green">队列</span></div>
          {runningTasks.map(t => (
            <div key={t.taskId} className="run-kv"><span className="run-dot green" />{t.taskId} {t.name} — {t.agentName ?? ''} 执行中</div>
          ))}
          <div className="run-kv"><span className={`run-dot${queue?.pending ? ' amber' : ' slate'}`} />排队后台消息 {queue?.pending ?? 0}{queue?.thinking ? ' · think 进行中' : ''}</div>
          <div className="run-kv"><span className={`run-dot${pendingApprovals.length ? ' amber' : ' slate'}`} />审批队列 {pendingApprovals.length} 条</div>
        </div>
        <div className="run-card">
          <div className="run-card-head"><span className="run-card-title amber">待审批</span></div>
          {pendingApprovals.length === 0 && <div className="run-empty">队列为空。</div>}
          {pendingApprovals.map(a => (
            <div key={a.id} className="run-approval">
              <div>{a.title} <span className="run-hint">{a.id} · policy {a.policyVersion}</span></div>
              <div className="run-actions">
                <button className="run-btn primary" onClick={() => decide(a.id, 'approve', true)} title="建京ME 对接群并拉创建人,完成后汇报回群">批准并拉群</button>
                <button className="run-btn" onClick={() => decide(a.id, 'approve')}>仅批准</button>
                <button className="run-btn" onClick={() => decide(a.id, 'reject')}>驳回</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 心跳 */}
      <div className="run-grid2">
        <div className="run-card">
          <div className="run-card-head">
            <span className="run-card-title green">京ME 源 {jdsme?.running ? '● 运行中' : '○ 未运行'}</span>
          </div>
          <div className="run-kv">上次轮询 {jdsme?.lastPollAt ? `${Math.round((Date.now() - jdsme.lastPollAt) / 1000)}s 前` : '—'} · 游标 {jdsme?.cursor ?? '—'} · 无积压</div>
          <div className="run-kv dim">今日:放行 {c['jdsme-passed'] ?? 0} · gate 过滤 {c['jdsme-gate-filtered'] ?? 0} · 寒暄静默 {c['greeting-silent'] ?? 0} · 直通 {c['direct-through'] ?? 0}</div>
          <div className="run-kv dim">准入 {jdsme?.admission ?? 'explicit'} · 白名单 {jdsme?.whitelistGroups ? `${jdsme.whitelistGroups} 个` : '未配置(放行全部)'}</div>
        </div>
        <div className="run-card">
          <div className="run-card-head">
            <span className="run-card-title slate">行云端 {heartbeat?.xingyun?.running ? '● 运行中' : '○ 未启用'}</span>
          </div>
          <div className="run-kv dim">未配置 sprintId 时源不启动;配置页 → 事件源 → 行云需求卡开启</div>
          <div className="run-kv dim">上次轮询 {heartbeat?.xingyun?.lastPollAt ? `${Math.round((Date.now() - heartbeat.xingyun.lastPollAt) / 1000)}s 前` : '—'}</div>
        </div>
      </div>

      {/* 记忆构成 */}
      <div className="run-card violet">
        <div className="run-card-head">
          <span className="run-card-title violet">记忆构成</span>
          <span className="run-hint">EverOS 已下线 · 长期记忆自建规划中</span>
          <button className="run-btn rose" onClick={clearMemory}>清空记忆</button>
        </div>
        <div className="run-kv">
          对话 {counts.conversation} 条 · 工具轨迹(traces 分区见上) · 线程见 mtrace · 制品 {counts.artifacts} · 任务 {counts.tasks}
        </div>
      </div>
    </div>
  )
}

function Metric({ num, label, tone, sub }: { num: number; label: string; tone: 'green' | 'slate' | 'amber' | 'white' | 'blue' | 'rose'; sub: string }) {
  const color = { green: '#34d399', slate: '#94a3b8', amber: '#fbbf24', white: '#fff', blue: '#60a5fa', rose: '#fb7185' }[tone]
  return (
    <div className="run-metric">
      <div><span className="run-metric-num" style={{ color }}>{num}</span> <span className="run-metric-label">{label}</span></div>
      <div className="run-metric-sub">{sub}</div>
    </div>
  )
}

function TraceDetail({ trace }: { trace: MessageTrace }) {
  const o = trace.outcome ? OUTCOME_BADGE[trace.outcome] ?? { label: trace.outcome, tone: 'slate' as const } : { label: '处理中', tone: 'slate' as const }
  const mechs = new Set(trace.stages.map(s => s.mech).filter(Boolean) as string[])
  const ctx = trace.context ?? {}
  const total = trace.contextTotal ?? 0
  const max = Math.max(...Object.values(ctx), 1)
  const origin: MessageOrigin | undefined = trace.channel.startsWith('jdsme')
    ? { kind: trace.channel === 'jdsme-group' ? 'group' : 'dm', chatId: '', chatName: trace.chatName ?? '' }
    : undefined

  return (
    <div className="run-card detail">
      <div className="run-card-head">
        <span className="run-card-title cyan">消息详情 · {trace.id}</span>
        <span className="run-hint">{CHANNEL_LABEL[trace.channel]}{trace.chatName ? `「${trace.chatName}」` : ''} · {trace.sender ?? '—'} · {fmtTime(trace.at)}</span>
      </div>
      <div className="run-quote">"{trace.textPreview}"</div>

      <div className="run-sub-title cyan">处理链</div>
      <div className="run-chain">
        {trace.stages.map((s, i) => (
          <div key={i} className="run-stage">
            <span className="run-stage-dot" />
            <div>
              <div className="run-stage-text">
                {s.stage}
                {s.mech && <span className="run-mech">{s.mech}</span>}
              </div>
              {s.detail && <div className="run-stage-detail">{s.detail}</div>}
              <div className="run-stage-time">{fmtTime(s.at)}</div>
            </div>
          </div>
        ))}
        <div className="run-stage">
          <span className="run-stage-dot done" />
          <div><div className="run-stage-text">去向:<span className={`run-badge ${o.tone}`}>{o.label}</span> {fmtCost(trace.costMs)}</div></div>
        </div>
      </div>

      {Object.keys(ctx).length > 0 && (
        <>
          <div className="run-sub-title violet">上下文组装 · {total.toLocaleString()} 字符</div>
          <div className="run-bars">
            {Object.entries(ctx).map(([k, v]) => (
              <div key={k} className="run-bar-row">
                <span className="run-bar-label">{k}</span>
                <div className={`run-bar${k === 'msg' ? ' is-msg' : ''}`} style={{ width: `${Math.max(2, (v / max) * 240)}px` }} />
                <span className="run-bar-val">{v}</span>
              </div>
            ))}
            <div className="run-hint">memories = 0(EverOS 已下线)· 分区点开看预览:实现期</div>
          </div>
        </>
      )}

      <div className="run-sub-title green">机制命中</div>
      <div className="run-mechs">
        {KNOWN_MECHS.map(m => {
          const hit = mechs.has(m)
          return <span key={m} className={`run-mech-pill${hit ? ' hit' : ' miss'}`}>{hit ? '✓' : '—'} {m}</span>
        })}
      </div>
      {origin && <div className="run-hint">来源:{origin.chatName}</div>}
    </div>
  )
}

function SectionHead({ children }: { children: ReactNode }) {
  return <div className="run-sub-title">{children}</div>
}
