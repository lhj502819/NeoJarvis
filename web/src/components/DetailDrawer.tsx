import type { ReactNode } from 'react'
import './DetailDrawer.css'

interface Props {
  /** 头部返回/上级页标签(如"团体"、"技能"),点击 = onBack */
  parentLabel?: string
  /** 右上角操作按钮组(可选),如编辑图标 */
  actions?: ReactNode
  /** 关闭回调(× 按钮触发) */
  onClose: () => void
  /** 返回上级回调(← + parentLabel 触发);无则不显示返回栏 */
  onBack?: () => void
  /** 主体内容 */
  children: ReactNode
  /** 额外 class 供页面微调 */
  className?: string
}

/**
 * 通用右侧详情抽屉外壳。玻璃卡背景 + 顶部返回/关闭条 + body slot。
 * 供 TeamPage/SkillsPage/(未来)ArtifactsPage 的"左列表+右详情"分屏模式复用。
 * 制品预览走 ArtifactPanel(有自己的展开/下载,不并入此壳)。
 */
export function DetailDrawer({ parentLabel, actions, onClose, onBack, children, className }: Props) {
  return (
    <div className={`detail-drawer ${className || ''}`}>
      <div className="detail-drawer-head">
        {onBack && parentLabel ? (
          <button className="detail-drawer-back" onClick={onBack} type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            <span>{parentLabel}</span>
          </button>
        ) : <span />}
        <div className="detail-drawer-actions">
          {actions}
          <button className="detail-drawer-close" onClick={onClose} title="关闭" type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div className="detail-drawer-body">{children}</div>
    </div>
  )
}
