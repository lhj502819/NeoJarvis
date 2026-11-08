import { useState, memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message, MessageArtifact, MsgTimelineEntry } from '../api/hooks'
import './JarvisOrb.css'

/** 京ME 图标(按官方图标复刻:红底圆角方块 + 白色 Me + 微笑弧线) */
export function JdmeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ flexShrink: 0, display: 'block' }}>
      <rect width="32" height="32" rx="9" fill="#FA3E5D" />
      <text
        x="16" y="15.5"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="13"
        fontWeight={800}
        fill="#fff"
        fontFamily="-apple-system, 'PingFang SC', 'Helvetica Neue', Arial, sans-serif"
      >Me</text>
      <path d="M5.5 20.5c3.2 4.2 7.4 6 10.5 6s7.3-1.8 10.5-6" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" fill="none" />
    </svg>
  )
}

/** 京ME 来源徽章:用户消息(来源)与 Jarvis 回复(同步去向)共用 */
function OriginChip({ message }: { message: Message }) {
  const o = message.origin!
  const isUser = message.role === 'user'
  // 群聊显示群名;私聊若是他人来件,亮出发件人(权限边界的可见信号)
  const who = !o.isOwner && o.sender ? ` · ${o.sender}` : ''
  return (
    <div className="msg-origin-chip" data-role={message.role} title={isUser ? `来自京ME${o.kind === 'group' ? '群' : '私聊'}` : `此回复已同步至京ME${o.kind === 'group' ? '群' : '私聊'}`}>
      <JdmeIcon />
      <span>{isUser ? '' : '已回 '}{o.chatName}{who}</span>
    </div>
  )
}

/**
 * 服务端给京ME来件打的标注文本 → 纯展示文本:
 * 头部【京ME…】行与尾部(此消息来自京ME…)说明段由来源徽章替代,不重复占屏。
 * 仅在消息带 origin 标记时调用;无标记的历史消息原样展示。
 */
function stripJdMeLabel(text: string): string {
  return text
    .replace(/^【京ME[^\n]*】\s*\n/, '')
    .replace(/\s*\(此消息来自京ME[\s\S]*\)\s*$/, '')
    .trim()
}

interface Props {
  message: Message
  onArtifactClick?: (artifact: MessageArtifact) => void
}

const TOOL_LABEL: Record<string, string> = {
  bash: '终端',
  read: '读取',
  edit: '编辑',
  write: '写入',
  grep: '搜索',
  find: '查找',
  ls: '列目录',
  list_tasks: '查任务',
  get_task: '查任务详情',
  list_team: '查团队',
  get_team_stats: '查统计',
  list_agent_history: '查历史',
  search_artifacts: '搜制品',
  pin_artifact: '钉制品',
  update_artifact: '改制品',
  cancel_task: '取消任务',
  create_task: '派任务',
  send_message: '发消息',
  interrupt_agent: '打断',
  promote_agent: '转正',
  get_agent_profile: '查分工',
  update_agent_profile: '改分工',
  message_jarvis: '汇报',
  message_peer: '找同事',
  check_inbox: '看收件箱',
  list_peers: '看同事',
  web: '联网',
}

type ToolIconKind = 'brain' | 'terminal' | 'file' | 'edit' | 'task' | 'settings' | 'tool'

function toolLabel(name: string): string {
  return TOOL_LABEL[name] ?? name
}

function toolKind(name: string): ToolIconKind {
  if (name === 'bash') return 'terminal'
  if (['read', 'ls', 'find', 'grep'].includes(name)) return 'file'
  if (['edit', 'write'].includes(name)) return 'edit'
  if (['create_task', 'cancel_task', 'list_tasks', 'get_task', 'send_message'].includes(name)) return 'task'
  if (['get_agent_profile', 'update_agent_profile', 'get_team_stats', 'list_team', 'list_agent_history'].includes(name)) return 'settings'
  return 'tool'
}

function fmtDur(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

function compact(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

function tail(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `…${clean.slice(-max)}` : clean
}

/** 工具入参只展示最有信息量的那个字段，避免把整段 JSON 糊在行里。 */
function formatToolArgs(raw?: string): string {
  if (!raw) return ''
  let obj: Record<string, unknown> | null = null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed as Record<string, unknown>
  } catch {
    return compact(raw)
  }
  if (!obj) return compact(raw)
  const keys = [
    'command', 'file_path', 'path', 'query', 'pattern', 'url',
    'content', 'message', 'description', 'name', 'title', 'subtitle',
    'taskId', 'subtaskId',
  ]
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return compact(value)
  }
  const body = JSON.stringify(obj)
  return body === '{}' ? '' : compact(body)
}

function TimelineIcon({ kind }: { kind: ToolIconKind }) {
  const props = {
    width: 15,
    height: 15,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (kind) {
    case 'brain':
      return (
        <svg {...props}>
          <path d="M12 5.5a3 3 0 0 0-5.2 1.6A2.8 2.8 0 0 0 4 9.9c0 1 .5 1.9 1.4 2.4A2.9 2.9 0 0 0 8 17.5h4V5.5Z" />
          <path d="M12 5.5a3 3 0 0 1 5.2 1.6A2.8 2.8 0 0 1 20 9.9c0 1-.5 1.9-1.4 2.4A2.9 2.9 0 0 1 16 17.5h-4V5.5Z" />
          <path d="M12 9.5v5M9.5 10h1.3M14.5 10h-1.3M9.5 13.5h1.3M14.5 13.5h-1.3" />
        </svg>
      )
    case 'terminal':
      return (
        <svg {...props}>
          <rect x="3.5" y="5" width="17" height="14" rx="2" />
          <path d="M7.5 9.5l2.5 2.5-2.5 2.5M13 15h4" />
        </svg>
      )
    case 'file':
      return (
        <svg {...props}>
          <path d="M6 3.5h7l5 5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
          <path d="M13 3.5V9h5M9 14h6M9 17h4" />
        </svg>
      )
    case 'edit':
      return (
        <svg {...props}>
          <path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" />
          <path d="M13.5 7.5l3 3" />
        </svg>
      )
    case 'task':
      return (
        <svg {...props}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M8 9l1.5 1.5L12 8M8 15l1.5 1.5L12 14M14 9.5h4M14 15.5h4" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...props}>
          <path d="M4 7h16M4 12h16M4 17h16" />
          <circle cx="8" cy="7" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="10" cy="17" r="2" />
        </svg>
      )
    default:
      return (
        <svg {...props}>
          <path d="M14.5 6.5a4 4 0 0 0-5.2 5.2l-5 5a2 2 0 1 0 2.8 2.8l5-5a4 4 0 0 0 5.2-5.2l-2.2 2.2-2.8-2.8 2.2-2.2Z" />
        </svg>
      )
  }
}

function ThinkingIndicator({ content }: { content: string }) {
  const text = content && content !== '正在思考...' ? content : '推理中'
  return (
    <div className="msg-tl">
      <div className="msg-tl-row" data-active="true">
        <TimelineIcon kind="brain" />
        <span className="msg-tl-label running">正在思考</span>
        <span className="msg-tl-sep">·</span>
        <span className="msg-tl-snippet dim">{text}</span>
      </div>
    </div>
  )
}

/**
 * 时间线行：参考 Claude Code / Codex 的极简灰度排版。
 *   思考中：脑图标 + 正在思考 · <实时片段>
 *   思考完：脑图标 + 思考 · 持续了 N 秒（有文本时点击展开）
 *   工具中：spinner + 工具名 + 参数 + · 执行中
 *   工具完：工具图标 + 工具名 + 参数 + · 已完成 / 失败
 */
function TimelineRows({ message }: { message: Message }) {
  const tl = message.timeline ?? []
  const [openThought, setOpenThought] = useState<number | null>(null)

  if (tl.length === 0) return null

  // 正文开始流式后,运行中的思考行不再显示尾部片段:
  // 模型思考的结尾常是回复草稿,与流出的正文语义重复,页面上就成了「最后一段重复展示」。
  // 纯思考期(正文还没开始)保留片段——那时没有重复,且是「它在想什么」的唯一可见信号。
  const streaming = message.status === 'streaming'

  return (
    <div className="msg-tl">
      {tl.map((e: MsgTimelineEntry, i) => {
        const isRunning = e.status === 'running'
        const dur = (e.endedAt ?? Date.now()) - e.startedAt

        if (e.type === 'thought') {
          const text = (e.text ?? '').trim()
          const canOpen = !isRunning && text.length > 0
          const isOpen = openThought === i
          const showSnippet = isRunning && !streaming
          return (
            <div className="msg-tl-item" key={i}>
              <button
                type="button"
                className={`msg-tl-row msg-tl-thought${isRunning ? ' is-running' : ''}`}
                data-active={isRunning}
                data-open={isOpen}
                aria-expanded={canOpen ? isOpen : undefined}
                disabled={!canOpen}
                onClick={() => canOpen && setOpenThought(o => (o === i ? null : i))}
                title={canOpen ? (isOpen ? '收起思考' : '查看思考') : undefined}
              >
                <TimelineIcon kind="brain" />
                <span className={`msg-tl-label${isRunning ? ' running' : ''}`}>
                  {isRunning ? '正在思考' : '思考'}
                </span>
                <span className="msg-tl-sep">·</span>
                {showSnippet ? (
                  <span className="msg-tl-snippet">{tail(text) || '推理中'}</span>
                ) : (
                  <span className="msg-tl-meta">{isRunning ? '草稿已成' : `持续了 ${fmtDur(dur)}`}</span>
                )}
                {canOpen && <span className="msg-tl-caret">{isOpen ? '⌃' : '⌄'}</span>}
              </button>
              {isOpen && canOpen && <div className="msg-tl-thought-text">{text}</div>}
            </div>
          )
        }

        const name = e.name ?? ''
        const args = formatToolArgs(e.args)
        return (
          <div className="msg-tl-row msg-tl-tool-row" key={i} data-active={isRunning}>
            {isRunning ? <span className="msg-tl-spinner" /> : <TimelineIcon kind={toolKind(name)} />}
            <span className="msg-tl-label">{toolLabel(name)}</span>
            {args && <span className="msg-tl-args" title={e.args}>{args}</span>}
            <span className="msg-tl-status" data-status={e.status}>
              {isRunning ? '执行中' : e.status === 'error' ? '失败' : '已完成'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** 小弟 ↔ Jarvis 的沟通卡片(独立气泡,方向图标 + 类型徽标) */
function CommsCard({ message }: { message: Message }) {
  const [open, setOpen] = useState(message.content.length > 120)
  const toWorker = message.commsDir === 'to_worker'
  return (
    <div className="msg-comms" data-dir={message.commsDir}>
      <div className="msg-comms-head">
        <span className="msg-comms-ico">{toWorker ? '📤' : '📨'}</span>
        <span className="msg-comms-title">
          {toWorker ? 'Jarvis → ' : ''}
          {message.agentName}
          {toWorker ? '' : ' → Jarvis'}
        </span>
        {message.commsType && (
          <span className="msg-comms-type">{STEP_LABEL[message.commsType] ?? message.commsType}</span>
        )}
        <span className="msg-spacer" />
        {message.content.length > 120 && (
          <button className="msg-comms-toggle" onClick={() => setOpen(o => !o)} type="button">
            {open ? '收起' : '展开'}
          </button>
        )}
      </div>
      <div className={`msg-comms-body${open ? ' open' : ''}`}>{message.content}</div>
    </div>
  )
}

const STEP_LABEL: Record<string, string> = {
  progress: '进展',
  question: '请示',
  deliverable: '交付',
  blocked: '受阻',
  jarvis: 'Jarvis 决策',
}

/**
 * Codex 式消息布局:
 *   user  → 右侧浅灰圆角气泡(无头像),用 --bubble-user-* 变量
 *   jarvis → 无气泡纯文本,占满栏宽,靠排版区分
 *   system → 居中灰 pill
 *   kind=comms → 小弟 ↔ Jarvis 沟通卡片
 */
export const MessageBubble = memo(function MessageBubble({ message, onArtifactClick }: Props) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            background: 'var(--bg-subtle)',
            padding: '4px 12px',
            borderRadius: 'var(--radius-full)',
          }}
        >
          {message.content}
        </div>
      </div>
    )
  }

  if (message.kind === 'comms') {
    return (
      <div style={{ marginBottom: 12, animation: 'msg-fade-in 0.3s ease-out' }}>
        <CommsCard message={message} />
      </div>
    )
  }

  if (isUser) {
    const display = message.origin ? stripJdMeLabel(message.content) : message.content
    return (
      <div style={{
        marginBottom: 20,
        animation: 'msg-fade-in 0.3s ease-out',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
      }}>
        {message.origin && <OriginChip message={message} />}
        <div
          style={{
            maxWidth: '70%',
            padding: message.imageUrls?.length ? '10px 14px' : '10px 16px',
            borderRadius: 22,
            background: 'var(--bubble-user-bg)',
            color: 'var(--bubble-user-fg)',
            border: '1px solid var(--bubble-user-border)',
            boxShadow: 'var(--bubble-user-shadow)',
            fontSize: 14,
            lineHeight: 1.65,
          }}
        >
          {message.imageUrls && message.imageUrls.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: message.content ? 8 : 0 }}>
              {message.imageUrls.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer">
                  <img
                    src={url}
                    style={{ maxWidth: 180, maxHeight: 180, borderRadius: 12, display: 'block' }}
                  />
                </a>
              ))}
            </div>
          )}
          {display}
        </div>
      </div>
    )
  }

  // Jarvis:无气泡纯文本(Codex 风),思考/工具步骤折叠行在正文上方
  return (
    <div style={{
      marginBottom: 24,
      animation: 'msg-fade-in 0.3s ease-out',
      fontSize: 14.5,
      lineHeight: 1.7,
      color: 'var(--text)',
    }}>
      {message.origin && <OriginChip message={message} />}
      <TimelineRows message={message} />
      {message.status === 'thinking' && !(message.timeline ?? []).length ? (
        <ThinkingIndicator content={message.content} />
      ) : (
        message.content && (
          <div className="markdown-body">
            <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
          </div>
        )
      )}

      {message.artifact && onArtifactClick && (
        <button
          onClick={() => onArtifactClick(message.artifact!)}
          style={{
            marginTop: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            width: '100%',
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            cursor: 'pointer',
            fontSize: 13,
            color: 'var(--text)',
            fontFamily: 'inherit',
            textAlign: 'left',
            transition: 'background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border-focus)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-subtle)'; e.currentTarget.style.borderColor = 'var(--border)' }}
        >
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--text-muted)',
            flexShrink: 0,
          }} />
          <span style={{ fontWeight: 600, flex: 1 }}>{message.artifact.title}</span>
          <span style={{ opacity: 0.6, fontSize: 12 }}>→</span>
        </button>
      )}
    </div>
  )
})
