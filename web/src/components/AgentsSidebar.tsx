import { postJSON } from '../api/client'

interface Agent {
  subtaskId: string
  name: string
  recipeId: string
  description: string
  startedAt: number
}

interface Recipe {
  id: string
  name: string
  description: string
  usageCount: number
  context: Record<string, unknown>
}

interface Props {
  running: Agent[] | null
  recipes: Recipe[] | null
}

export function AgentsSidebar({ running, recipes }: Props) {
  const handleInterrupt = async (subtaskId: string) => {
    await postJSON('/api/agent/interrupt', { subtaskId })
  }

  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-[#a0a0a0] uppercase tracking-wider mb-2">团队</h3>

      {running && running.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-blue-400 mb-1">运行中</p>
          {running.map(agent => (
            <div key={agent.subtaskId} className="p-2 rounded-lg bg-[#1a1a2e] mb-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-white">{agent.name}</span>
                <button
                  onClick={() => handleInterrupt(agent.subtaskId)}
                  className="text-xs text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded hover:bg-[#2a2a4a]"
                >
                  打断
                </button>
              </div>
              <p className="text-xs text-[#a0a0a0] truncate mt-0.5">{agent.description}</p>
            </div>
          ))}
        </div>
      )}

      {recipes && recipes.length > 0 ? (
        <div>
          <p className="text-xs text-[#a0a0a0] mb-1">小弟 ({recipes.length})</p>
          {recipes.map(r => (
            <div key={r.id} className="flex items-center gap-2 py-1 text-xs">
              <div className="w-5 h-5 rounded-full bg-[#2a4a8a] flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                {r.name[0]}
              </div>
              <div className="min-w-0">
                <span className="text-white">{r.name}</span>
                <span className="text-[#666] ml-1">×{r.usageCount}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[#666]">暂无小弟，执行任务后会自动沉淀</p>
      )}
    </div>
  )
}
