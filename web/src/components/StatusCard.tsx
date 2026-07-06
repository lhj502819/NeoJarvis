interface JarvisState {
  mood: number
  energy: number
  confidence: number
  tasksCompletedToday: number
  messagesHandledToday: number
  familiarity: number
  trustLevel: number
}

interface Props {
  state: JarvisState | null
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-full h-1.5 bg-[#2a2a4a] rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
    </div>
  )
}

export function StatusCard({ state }: Props) {
  if (!state) return null

  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-[#a0a0a0] uppercase tracking-wider mb-2">Jarvis 状态</h3>
      <div className="space-y-2 p-2 rounded-lg bg-[#1a1a2e]">
        <div>
          <div className="flex justify-between text-xs mb-0.5">
            <span className="text-[#a0a0a0]">精力</span>
            <span className="text-white">{state.energy}</span>
          </div>
          <Bar value={state.energy} color="bg-green-400" />
        </div>
        <div>
          <div className="flex justify-between text-xs mb-0.5">
            <span className="text-[#a0a0a0]">心情</span>
            <span className="text-white">{state.mood}</span>
          </div>
          <Bar value={state.mood} color="bg-yellow-400" />
        </div>
        <div>
          <div className="flex justify-between text-xs mb-0.5">
            <span className="text-[#a0a0a0]">信任度</span>
            <span className="text-white">{state.trustLevel}</span>
          </div>
          <Bar value={state.trustLevel} color="bg-blue-400" />
        </div>
        <div className="flex justify-between text-xs pt-1 border-t border-[#2a2a4a]">
          <span className="text-[#a0a0a0]">今日完成</span>
          <span className="text-white">{state.tasksCompletedToday} 任务 / {state.messagesHandledToday} 消息</span>
        </div>
      </div>
    </div>
  )
}
