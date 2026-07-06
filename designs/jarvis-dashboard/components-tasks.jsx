function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

function SubTaskItem({ subtask }) {
  return (
    <div className="subtask">
      <span className="subtask-name">{subtask.name}</span>
      <StatusBadge status={subtask.status} />
    </div>
  );
}

function TaskCard({ task }) {
  const [expanded, setExpanded] = React.useState(
    !['completed', 'failed', 'cancelled'].includes(task.status)
  );

  return (
    <div className="card task-card" onClick={() => setExpanded(!expanded)}>
      <div className="task-header">
        <span className="task-name">{task.name}</span>
        <StatusBadge status={task.status} />
      </div>
      <div className="task-desc">{task.description}</div>
      <span className="task-id">{task.id}</span>
      {expanded && task.subtasks && task.subtasks.length > 0 && (
        <div className="subtasks">
          {task.subtasks.map(st => <SubTaskItem key={st.id} subtask={st} />)}
        </div>
      )}
    </div>
  );
}

function TasksPanel({ tasks }) {
  if (!tasks || tasks.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">&#9745;</div>
        <div>没有任务</div>
      </div>
    );
  }

  const active = tasks.filter(t => !['completed', 'failed', 'cancelled'].includes(t.status));
  const done = tasks.filter(t => ['completed', 'failed', 'cancelled'].includes(t.status))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  return (
    <div>
      {active.length > 0 && (
        <div>
          <div className="section-title">进行中 ({active.length})</div>
          {active.map(t => <TaskCard key={t.id} task={t} />)}
        </div>
      )}
      <div style={{ marginTop: active.length > 0 ? 20 : 0 }}>
        <div className="section-title">历史任务 ({done.length})</div>
        {done.length > 0
          ? done.slice(0, 20).map(t => <TaskCard key={t.id} task={t} />)
          : <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>暂无</div>
        }
      </div>
    </div>
  );
}

Object.assign(window, { TasksPanel, TaskCard, StatusBadge });
