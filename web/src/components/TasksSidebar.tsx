interface Task {
  id: string
  name: string
  status: string
  subtasks: Array<{
    id: string
    name: string
    status: string
    assignee: string
    progress?: string
  }>
}

interface Props {
  data: { summary: string; tasks: Task[] } | null
}

const statusColors: Record<string, string> = {
  executing: 'text-blue-400',
  completed: 'text-green-400',
  failed: 'text-red-400',
  cancelled: 'text-gray-500',
  planning: 'text-yellow-400',
  pending: 'text-gray-400',
  running: 'text-blue-400',
}

const statusIcons: Record<string, string> = {
  executing: '⚡',
  completed: '✅',
  failed: '❌',
  cancelled: '⊘',
  planning: '📋',
  pending: '○',
  running: '●',
}

export function TasksSidebar({ data }: Props) {
  if (!data) return null

  const activeTasks = data.tasks.filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
  const recentDone = data.tasks.filter(t => t.status === 'completed').slice(-3)

  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-[#a0a0a0] uppercase tracking-wider mb-2">任务</h3>

      {activeTasks.length === 0 && recentDone.length === 0 && (
        <p className="text-xs text-[#666]">暂无任务</p>
      )}

      {activeTasks.map(task => (
        <div key={task.id} className="mb-3 p-2 rounded-lg bg-[#1a1a2e]">
          <div className="flex items-center gap-1.5">
            <span>{statusIcons[task.status] || '○'}</span>
            <span className={`text-xs font-medium ${statusColors[task.status] || ''}`}>
              {task.name}
            </span>
          </div>
          {task.subtasks.length > 0 && (
            <div className="mt-1.5 pl-4 space-y-1">
              {task.subtasks.map(st => (
                <div key={st.id} className="text-xs text-[#a0a0a0] flex items-center gap-1">
                  <span>{statusIcons[st.status] || '○'}</span>
                  <span className="truncate">{st.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {recentDone.length > 0 && (
        <div className="mt-2 border-t border-[#2a2a4a] pt-2">
          <p className="text-xs text-[#666] mb-1">最近完成</p>
          {recentDone.map(t => (
            <div key={t.id} className="text-xs text-[#a0a0a0] py-0.5 flex items-center gap-1">
              <span>✅</span>
              <span className="truncate">{t.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
