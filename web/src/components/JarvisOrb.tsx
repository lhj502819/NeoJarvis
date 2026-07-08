import './JarvisOrb.css'

export type OrbMood = 'thinking' | 'happy' | 'idle'

interface Props {
  mood: OrbMood
}

const moodLabels: Record<OrbMood, string> = {
  thinking: '思考中...',
  happy: '从容',
  idle: '待命',
}

export function JarvisOrb({ mood }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0 12px', flexShrink: 0 }}>
      <div className="jarvis-orb" data-mood={mood}>
        <div className="jarvis-orb-wave" data-mood={mood}>
          <span></span><span></span><span></span><span></span><span></span>
        </div>
      </div>
      <div className="jarvis-orb-label">{moodLabels[mood]}</div>
    </div>
  )
}
