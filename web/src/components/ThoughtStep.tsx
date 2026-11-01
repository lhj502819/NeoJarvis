import { useState } from 'react'

/**
 * 时间线里的"思考"块:默认收起(只显示首行 + 展开按钮),点击展开全文。
 * 小弟一轮思考常有几百字,全展开会把时间线拉得很长,故默认折叠。
 * TaskDetail 与 ExecutionModal 共用,保证两处行为一致。
 */
export function ThoughtStep({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false)
  // 超过这个长度才需要折叠;短思考直接全显示,不加按钮。
  const COLLAPSE_AT = 90
  const collapsible = text.length > COLLAPSE_AT
  const shown = open || !collapsible ? text : text.slice(0, COLLAPSE_AT) + '…'
  return (
    <div className={`tl-thought${open ? ' expanded' : ''} ${className || ''}`}>
      {shown}
      {collapsible && (
        <button
          className="tl-thought-toggle"
          onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
          type="button"
        >{open ? '收起' : '展开'}</button>
      )}
    </div>
  )
}
