import { useState } from 'react'
import Markdown from 'react-markdown'
import './ArtifactPanel.css'

export interface Artifact {
  type: 'html' | 'markdown' | 'code' | 'mermaid'
  title: string
  content: string
  language?: string
}

interface Props {
  artifact: Artifact
  onClose: () => void
}

const typeIcons: Record<string, string> = {
  html: '🌐',
  markdown: '📄',
  code: '💻',
  mermaid: '📊',
}

export function ArtifactPanel({ artifact, onClose }: Props) {
  return (
    <div className="artifact-panel">
      <div className="artifact-panel-header">
        <div className="artifact-panel-title">
          <span className="icon">{typeIcons[artifact.type] || '📎'}</span>
          <span className="name">{artifact.title}</span>
          <span className="type-badge">{artifact.type}</span>
        </div>
        <button className="artifact-panel-close" onClick={onClose}>×</button>
      </div>
      <div className="artifact-panel-body">
        {artifact.type === 'html' && <HtmlPreview content={artifact.content} />}
        {artifact.type === 'markdown' && <MarkdownPreview content={artifact.content} />}
        {artifact.type === 'code' && <CodePreview code={artifact.content} language={artifact.language || 'text'} />}
        {artifact.type === 'mermaid' && <CodePreview code={artifact.content} language="mermaid" />}
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
