import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { loadArtifactContent } from '../api/artifact-content'
import './ArtifactPanel.css'

export interface Artifact {
  type: 'html' | 'markdown' | 'code' | 'mermaid'
  title: string
  /** 老数据 / SSE 推送 / PATCH 回显里已就绪的正文;新数据 v0.3 起可能只有 uri。 */
  content?: string
  /** v0.3 file-store: `file://…/.jarvis/artifacts/…` 或未来的 OSS `https://…`。 */
  uri?: string
  language?: string
}

interface Props {
  artifact: Artifact
  fullscreen?: boolean
  onToggleFullscreen?: () => void
  onClose: () => void
}

const typeIcons: Record<string, string> = {
  html: '🌐',
  markdown: '📄',
  code: '💻',
  mermaid: '📊',
}

// 代码语言 → 扩展名
const langExt: Record<string, string> = {
  typescript: 'ts', javascript: 'js', tsx: 'tsx', jsx: 'jsx',
  python: 'py', java: 'java', go: 'go', rust: 'rs', ruby: 'rb',
  json: 'json', yaml: 'yaml', bash: 'sh', shell: 'sh', sql: 'sql',
  css: 'css', html: 'html', markdown: 'md',
}

function extFor(artifact: Artifact): string {
  switch (artifact.type) {
    case 'html': return 'html'
    case 'markdown': return 'md'
    case 'mermaid': return 'mmd'
    case 'code': return langExt[(artifact.language || '').toLowerCase()] || 'txt'
    default: return 'txt'
  }
}

function mimeFor(artifact: Artifact): string {
  if (artifact.type === 'html') return 'text/html'
  if (artifact.type === 'markdown') return 'text/markdown'
  return 'text/plain'
}

function download(artifact: Artifact, resolvedContent: string) {
  const safeTitle = (artifact.title || 'artifact').replace(/[/\\?%*:|"<>]/g, '_').trim() || 'artifact'
  const filename = `${safeTitle}.${extFor(artifact)}`
  const blob = new Blob([resolvedContent], { type: `${mimeFor(artifact)};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ArtifactPanel({ artifact, fullscreen, onToggleFullscreen, onClose }: Props) {
  // v0.3 file-store: 老数据/SSE 推送里 content 已就绪,直接用;新数据只带 uri,
  // 触发 loadArtifactContent 走 IPC(Electron)/fetch(OSS)拿回正文再渲染。
  // 每次 artifact 变化都重置一次,避免残留旧内容。
  const [resolved, setResolved] = useState<string | null>(
    typeof artifact.content === 'string' ? artifact.content : null,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    if (typeof artifact.content === 'string') {
      setResolved(artifact.content)
      return
    }
    setResolved(null)
    loadArtifactContent({ uri: artifact.uri, content: artifact.content })
      .then(text => { if (!cancelled) setResolved(text) })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => { cancelled = true }
  }, [artifact.content, artifact.uri])

  return (
    <div className="artifact-panel">
      <div className="artifact-panel-header">
        <div className="artifact-panel-title">
          <span className="icon">{typeIcons[artifact.type] || '📎'}</span>
          <span className="name">{artifact.title}</span>
          <span className="type-badge">{artifact.type}</span>
        </div>
        <div className="artifact-panel-actions">
          {onToggleFullscreen && (
            <button className="artifact-panel-fullscreen" onClick={onToggleFullscreen} title={fullscreen ? '退出全屏' : '全屏'}>
              {fullscreen ? '⊡' : '⊞'}
            </button>
          )}
          <button
            className="artifact-panel-download"
            onClick={() => resolved !== null && download(artifact, resolved)}
            disabled={resolved === null}
            title="下载文件"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <button className="artifact-panel-close" onClick={onClose}>×</button>
        </div>
      </div>
      <div className="artifact-panel-body">
        {error && (
          <div style={{ padding: 20, color: 'var(--danger, #ff6363)', fontSize: 13 }}>
            加载制品失败:{error}
          </div>
        )}
        {!error && resolved === null && (
          <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
            正在加载制品内容…
          </div>
        )}
        {!error && resolved !== null && artifact.type === 'html' && <HtmlPreview content={resolved} />}
        {!error && resolved !== null && artifact.type === 'markdown' && <MarkdownPreview content={resolved} />}
        {!error && resolved !== null && artifact.type === 'code' && <CodePreview code={resolved} language={artifact.language || 'text'} />}
        {!error && resolved !== null && artifact.type === 'mermaid' && <CodePreview code={resolved} language="mermaid" />}
      </div>
    </div>
  )
}

function HtmlPreview({ content }: { content: string }) {
  return (
    <iframe
      srcDoc={content}
      sandbox="allow-scripts"
      style={{ width: '100%', height: '100%', border: 'none' }}
    />
  )
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="markdown-body" style={{ padding: '24px 28px', fontSize: 14, lineHeight: 1.8 }}>
      <Markdown>{content}</Markdown>
    </div>
  )
}

function CodePreview({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="artifact-code-header">
        <span className="artifact-code-lang">{language}</span>
        <button className="artifact-code-copy" onClick={handleCopy}>
          {copied ? '✓ 已复制' : '复制'}
        </button>
      </div>
      <pre className="artifact-code-body">
        <code>{code}</code>
      </pre>
    </div>
  )
}
