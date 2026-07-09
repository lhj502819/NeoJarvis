import type { Recipe, AgentSession } from '../types'

export function AgentProfile({ recipe, sessions, onBack }: { recipe: Recipe; sessions: AgentSession[]; onBack: () => void }) {
  const mine = sessions.filter(s => s.recipeId === recipe.id || s.recipeId === recipe.name)
  return (
    <div>
      <button className="dash-back-btn" onClick={onBack}>← 返回团队</button>
      <div className="dash-section-title">{recipe.name}</div>
      <div className="dash-card">
        <div className="dash-agent-task">{recipe.description}</div>
        <div className="dash-profile-meta">
          <span>{recipe.createdBy === 'builtin' ? '内置' : '沉淀专家'}</span>
          <span>已执行 {recipe.usageCount} 次</span>
          <span>{recipe.lastUsedAt ? `最后: ${recipe.lastUsedAt.slice(0, 10)}` : '未使用'}</span>
        </div>
      </div>
      <div className="dash-section-title" style={{ marginTop: 16 }}>执行过的任务 ({mine.length})</div>
      {mine.length > 0 ? mine.map(s => (
        <div className="dash-card" key={s.sessionId}>
          <div className="dash-agent-task">{s.lastTaskDescription.slice(0, 100)}</div>
          <div className="dash-profile-meta">
            <span>领域: {s.domain || '—'}</span>
            <span>{s.taskCount} 次</span>
          </div>
        </div>
      )) : <div className="dash-empty-hint">暂无执行记录</div>}
    </div>
  )
}
