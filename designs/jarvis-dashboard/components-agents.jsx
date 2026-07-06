function RunningAgentCard({ agent }) {
  const elapsed = Math.round((Date.now() - agent.startedAt) / 1000);
  const formatTime = (s) => s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`;

  return (
    <div className="card agent-card" style={{ borderLeft: '3px solid var(--blue)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="agent-name">{agent.name}</span>
        <span className="badge badge-running">running</span>
      </div>
      <div className="agent-url">{agent.recipeId} · {agent.url || 'direct'}</div>
      {agent.description && (
        <div className="agent-task">{agent.description}</div>
      )}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
        {formatTime(elapsed)} · subtask {agent.subtaskId?.slice(0, 6)}
      </div>
    </div>
  );
}

function RecipeCard({ recipe }) {
  const isBuiltin = recipe.createdBy === 'builtin';
  return (
    <div className="card agent-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="agent-name">{recipe.name}</span>
        <span className="badge" style={{ background: isBuiltin ? 'var(--bg-hover)' : 'var(--accent-light)', color: isBuiltin ? 'var(--text-muted)' : 'var(--accent)' }}>
          {isBuiltin ? '内置' : '沉淀'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
        {recipe.description}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
        <span>已执行 {recipe.usageCount} 次</span>
        <span>{recipe.lastUsedAt ? `最后: ${recipe.lastUsedAt.slice(0, 10)}` : '未使用'}</span>
      </div>
    </div>
  );
}

function HistoryCard({ session }) {
  const date = new Date(session.completedAt);
  const timeStr = `${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2,'0')}`;

  return (
    <div className="card agent-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="agent-name" style={{ fontSize: 13 }}>{session.recipeId}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{timeStr}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
        {session.lastTaskDescription.slice(0, 80)}{session.lastTaskDescription.length > 80 ? '...' : ''}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span>关键词: {session.topics.slice(0, 4).join(', ')}</span>
        <span>{session.taskCount}次</span>
      </div>
      <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-muted)', marginTop: 3 }}>
        session {session.sessionId.slice(0, 12)}...
      </div>
    </div>
  );
}

function AgentsPanel({ agents, history, recipes }) {
  const [tab, setTab] = React.useState('team');
  const [search, setSearch] = React.useState('');

  const filteredHistory = React.useMemo(() => {
    if (!history) return [];
    if (!search.trim()) return history;
    const q = search.toLowerCase();
    return history.filter(s =>
      s.lastTaskDescription.toLowerCase().includes(q) ||
      s.topics.some(t => t.toLowerCase().includes(q)) ||
      s.recipeId.toLowerCase().includes(q)
    );
  }, [history, search]);

  const filteredRecipes = React.useMemo(() => {
    if (!recipes) return [];
    if (!search.trim()) return recipes;
    const q = search.toLowerCase();
    return recipes.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q)
    );
  }, [recipes, search]);

  const runningCount = agents?.length || 0;
  const teamCount = recipes?.length || 0;
  const historyCount = history?.length || 0;

  return (
    <div>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '1px solid var(--border)' }}>
        {[
          { id: 'team', label: `团队 (${teamCount})` },
          { id: 'running', label: `运行中 (${runningCount})` },
          { id: 'history', label: `历史 (${historyCount})` },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? 'var(--accent)' : 'var(--text-muted)',
              background: 'none',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder="搜索 agent / 任务 / 关键词..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            fontSize: 12,
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg)',
            outline: 'none',
          }}
        />
      </div>

      {/* Tab content */}
      {tab === 'team' && (
        <div>
          {filteredRecipes.length > 0 ? (
            filteredRecipes.map((r, i) => <RecipeCard key={r.id || i} recipe={r} />)
          ) : (
            <div className="empty-state" style={{ padding: '16px 10px' }}>
              <div className="empty-icon">&#128101;</div>
              <div>暂无团队成员</div>
            </div>
          )}
        </div>
      )}

      {tab === 'running' && (
        <div>
          {agents && agents.length > 0 ? (
            agents.map((a, i) => <RunningAgentCard key={a.subtaskId || i} agent={a} />)
          ) : (
            <div className="empty-state" style={{ padding: '16px 10px' }}>
              <div className="empty-icon">&#9899;</div>
              <div>当前无运行中的 Agent</div>
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div>
          {filteredHistory.length > 0 ? (
            filteredHistory.slice().reverse().map((s, i) => (
              <HistoryCard key={s.sessionId || i} session={s} />
            ))
          ) : (
            <div className="empty-state" style={{ padding: '16px 10px' }}>
              <div className="empty-icon">&#128218;</div>
              <div>{search ? '没有匹配的记录' : '暂无历史记录'}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { AgentsPanel });
