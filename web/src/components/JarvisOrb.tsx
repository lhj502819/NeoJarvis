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
        {/* Outer HUD ring with tick marks */}
        <svg className="jarvis-hud-ring jarvis-hud-outer" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="47" className="ring-line" />
          {/* Tick marks - 60 ticks around the circle */}
          {Array.from({ length: 60 }, (_, i) => {
            const angle = (i * 6) * Math.PI / 180
            const isMajor = i % 5 === 0
            const r1 = isMajor ? 43.5 : 44.5
            const r2 = 47
            return (
              <line
                key={i}
                x1={50 + r1 * Math.cos(angle)}
                y1={50 + r1 * Math.sin(angle)}
                x2={50 + r2 * Math.cos(angle)}
                y2={50 + r2 * Math.sin(angle)}
                className={isMajor ? 'tick-major' : 'tick-minor'}
              />
            )
          })}
        </svg>

        {/* Inner HUD ring */}
        <svg className="jarvis-hud-ring jarvis-hud-inner" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" className="ring-line" />
        </svg>

        {/* Globe sphere - wireframe earth with network */}
        <svg className="jarvis-globe" viewBox="0 0 80 80">
          {/* Glow filter */}
          <defs>
            <filter id="globe-glow">
              <feGaussianBlur stdDeviation="1.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g filter="url(#globe-glow)">
            {/* Latitude lines (horizontal ellipses) */}
            <ellipse cx="40" cy="40" rx="28" ry="28" className="globe-line globe-equator" />
            <ellipse cx="40" cy="40" rx="28" ry="10" className="globe-line globe-lat" />
            <ellipse cx="40" cy="40" rx="28" ry="20" className="globe-line globe-lat" />
            <ellipse cx="40" cy="33" rx="24" ry="6" className="globe-line globe-lat-upper" />
            <ellipse cx="40" cy="48" rx="24" ry="6" className="globe-line globe-lat-lower" />

            {/* Longitude lines (vertical ellipses) */}
            <ellipse cx="40" cy="40" rx="10" ry="28" className="globe-line globe-lon" />
            <ellipse cx="40" cy="40" rx="20" ry="28" className="globe-line globe-lon" />
            <ellipse cx="40" cy="40" rx="4" ry="28" className="globe-line globe-lon-center" />

            {/* Network triangulation lines */}
            <g className="globe-network">
              <line x1="18" y1="30" x2="30" y2="20" />
              <line x1="30" y1="20" x2="45" y2="22" />
              <line x1="45" y1="22" x2="58" y2="30" />
              <line x1="58" y1="30" x2="55" y2="45" />
              <line x1="55" y1="45" x2="62" y2="38" />
              <line x1="18" y1="30" x2="22" y2="45" />
              <line x1="22" y1="45" x2="35" y2="50" />
              <line x1="35" y1="50" x2="55" y2="45" />
              <line x1="30" y1="20" x2="22" y2="45" />
              <line x1="45" y1="22" x2="55" y2="45" />
              <line x1="35" y1="50" x2="45" y2="60" />
              <line x1="45" y1="60" x2="55" y2="45" />
              <line x1="22" y1="45" x2="25" y2="58" />
              <line x1="25" y1="58" x2="35" y2="50" />
              <line x1="45" y1="60" x2="25" y2="58" />
            </g>

            {/* Particle dots scattered on the globe surface */}
            <g className="globe-dots">
              <circle cx="18" cy="30" r="1.2" />
              <circle cx="30" cy="20" r="1" />
              <circle cx="45" cy="22" r="1.2" />
              <circle cx="58" cy="30" r="1" />
              <circle cx="62" cy="38" r="0.8" />
              <circle cx="55" cy="45" r="1.2" />
              <circle cx="45" cy="60" r="1" />
              <circle cx="35" cy="50" r="1.2" />
              <circle cx="22" cy="45" r="1" />
              <circle cx="25" cy="58" r="1" />
              {/* Extra surface dots */}
              <circle cx="33" cy="28" r="0.7" />
              <circle cx="50" cy="35" r="0.8" />
              <circle cx="28" cy="38" r="0.7" />
              <circle cx="42" cy="42" r="0.8" />
              <circle cx="38" cy="55" r="0.7" />
              <circle cx="52" cy="52" r="0.7" />
              <circle cx="15" cy="40" r="0.6" />
              <circle cx="65" cy="40" r="0.6" />
              <circle cx="40" cy="13" r="0.6" />
              <circle cx="40" cy="67" r="0.6" />
              <circle cx="26" cy="25" r="0.6" />
              <circle cx="54" cy="25" r="0.6" />
              <circle cx="54" cy="55" r="0.6" />
              <circle cx="26" cy="55" r="0.6" />
            </g>
          </g>
        </svg>

        {/* Central glow backdrop */}
        <div className="jarvis-orb-glow"></div>
      </div>
      <div className="jarvis-orb-label">{moodLabels[mood]}</div>
    </div>
  )
}
