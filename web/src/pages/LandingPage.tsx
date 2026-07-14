import { useEffect, useRef } from 'react'
import './LandingPage.css'

function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let animId: number

    const particles: { x: number; y: number; vx: number; vy: number; r: number; alpha: number }[] = []

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    for (let i = 0; i < 80; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.5 + 0.5,
        alpha: Math.random() * 0.4 + 0.1,
      })
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0) p.x = canvas.width
        if (p.x > canvas.width) p.x = 0
        if (p.y < 0) p.y = canvas.height
        if (p.y > canvas.height) p.y = 0

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(124, 106, 255, ${p.alpha})`
        ctx.fill()
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 150) {
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.strokeStyle = `rgba(124, 106, 255, ${0.06 * (1 - dist / 150)})`
            ctx.lineWidth = 0.5
            ctx.stroke()
          }
        }
      }
      animId = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className="landing-particles" />
}

function useReveal() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        el.classList.add('visible')
        obs.disconnect()
      }
    }, { threshold: 0.15 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return ref
}

function RevealSection({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useReveal()
  return <div ref={ref} className={`landing-reveal ${className}`}>{children}</div>
}

const CAPABILITIES = [
  { icon: '🧩', title: '任务拆解与分派', desc: '一句话需求 → 自动拆子任务 → 匹配最合适的 Agent 执行' },
  { icon: '🧠', title: '跨会话记忆', desc: '记住你的偏好、项目背景、历史决策，不需要每次重复交代' },
  { icon: '👥', title: '团队自动成长', desc: '同一领域任务做满 3 次，自动沉淀专属 Agent（"小弟转正"）' },
  { icon: '🔌', title: 'MCP 生态接入', desc: '对话式添加 GitHub / Slack / 任意 MCP，全团队共享' },
  { icon: '🔐', title: 'BYOK 多凭证', desc: '自带 Key，按 tier 动态路由（fast / standard / strong）' },
  { icon: '📊', title: '进度可观测', desc: '实时仪表盘：任务流水、Agent 状态、执行历史' },
]

const COMPARE = [
  { name: 'ChatGPT / Claude', tag: '工具', rows: [['心智模型', '一问一答'], ['上下文', '单次会话'], ['协作', '你 ↔ AI'], ['执行力', '建议为主']], hl: false },
  { name: 'Manus / OpenClaw', tag: '自动化', rows: [['心智模型', '任务流水线'], ['上下文', '预设 workflow'], ['协作', '触发 → 执行'], ['执行力', '固定流程']], hl: false },
  { name: 'Jarvis', tag: '管家', rows: [['心智模型', '管理层'], ['上下文', '跨会话记忆'], ['协作', '你 → 管家 → 团队'], ['执行力', '自主决策 + 团队']], hl: true },
]

const ARCH = [
  { label: 'Layer 1', name: 'Sir (你)', desc: '说意图', hl: false },
  { label: 'Layer 2', name: 'Jarvis Brain', desc: '理解 → 决策 → 分派', hl: true },
  { label: 'Layer 3', name: 'Agent Team', desc: '各领域执行', hl: false },
]

export function LandingPage() {
  return (
    <div className="landing-root">
      <ParticleCanvas />

      {/* Nav */}
      <nav className="landing-nav">
        <div className="landing-nav-logo">
          <img src="/jarvis-logo.png" alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />
          Jarvis
        </div>
        <div className="landing-nav-links">
          <a href="#capabilities">能力</a>
          <a href="#compare">对比</a>
          <a href="#demo">演示</a>
          <a href="#architecture">架构</a>
        </div>
        <div className="landing-nav-actions">
          <a className="landing-nav-cta" href="#cta">开始使用</a>
        </div>
      </nav>

      {/* Hero */}
      <section className="landing-hero">
        <div className="landing-hero-glow" />
        <div className="landing-light-sweep" />

        <div className="landing-fade-in">
          <div className="landing-hero-badge">v0.1 · Private Beta</div>
        </div>
        <h1 className="landing-fade-in landing-fade-in-d1">
          你不再需要<br />亲自用 AI
        </h1>
        <p className="landing-hero-sub landing-fade-in landing-fade-in-d2">
          Jarvis 是你的私人 AI 管家——一句话下达意图，<br />他替你拆解、分派、执行、交付。
        </p>
        <div className="landing-hero-ctas landing-fade-in landing-fade-in-d3">
          <a className="landing-btn-primary" href="#cta">部署你的管家 →</a>
          <a className="landing-btn-ghost" href="#demo">看一段对话</a>
        </div>
      </section>

      {/* Capabilities */}
      <section className="landing-section" id="capabilities">
        <RevealSection>
          <div className="landing-section-label">CAPABILITIES</div>
          <h2>一位称职的管家<br />能替你做什么？</h2>
        </RevealSection>

        <div className="landing-cap-grid">
          {CAPABILITIES.map((c, i) => (
            <RevealSection key={i}>
              <div className="landing-cap-card">
                <div className="landing-cap-icon">{c.icon}</div>
                <div className="landing-cap-title">{c.title}</div>
                <div className="landing-cap-desc">{c.desc}</div>
              </div>
            </RevealSection>
          ))}
        </div>
      </section>

      {/* Compare */}
      <section className="landing-section" id="compare">
        <RevealSection>
          <div className="landing-section-label">COMPARISON</div>
          <h2>三种路线，三种哲学</h2>
        </RevealSection>

        <RevealSection>
          <div className="landing-vs-grid">
            {COMPARE.map((col, ci) => (
              <div key={ci} className={`landing-vs-col ${col.hl ? 'highlight' : ''}`}>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: col.hl ? 'var(--landing-accent)' : 'var(--landing-text)' }}>{col.name}</div>
                <div style={{ fontSize: 11, fontFamily: 'var(--landing-mono)', color: 'var(--landing-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 20 }}>{col.tag}</div>
                {col.rows.map(([label, val], ri) => (
                  <div key={ri} style={{ padding: '10px 0', borderTop: '1px solid var(--landing-border)' }}>
                    <div style={{ fontSize: 10, color: 'var(--landing-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 13, color: col.hl ? 'var(--landing-text)' : 'var(--landing-text-dim)' }}>{val}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </RevealSection>

        <RevealSection>
          <p style={{ textAlign: 'center', marginTop: 48, fontSize: 'clamp(18px, 2.5vw, 26px)', fontWeight: 600, letterSpacing: '-0.02em' }}>
            <span style={{ color: 'var(--landing-text-muted)' }}>别人给你工具 ——</span>{' '}
            <span style={{ background: 'linear-gradient(135deg, var(--landing-accent), var(--landing-accent2))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Jarvis 给你一整个团队。</span>
          </p>
        </RevealSection>
      </section>

      {/* Architecture */}
      <section className="landing-section" id="architecture">
        <RevealSection>
          <div className="landing-section-label">ARCHITECTURE</div>
          <h2>三层治理</h2>
        </RevealSection>

        <RevealSection>
          <div className="landing-arch-flow">
            {ARCH.map((l, i) => (
              <div key={i} style={{ display: 'contents' }}>
                {i > 0 && (
                  <div className="landing-arch-connector">
                    <div className="landing-arch-connector-bar" />
                  </div>
                )}
                <div className={`landing-arch-box ${l.hl ? 'highlight' : ''}`}>
                  <div style={{ fontSize: 10, fontFamily: 'var(--landing-mono)', color: 'var(--landing-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{l.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: l.hl ? 'var(--landing-accent)' : 'var(--landing-text)', marginBottom: 4 }}>{l.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--landing-text-dim)' }}>{l.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </RevealSection>
      </section>

      {/* Demo */}
      <section className="landing-section" id="demo">
        <RevealSection>
          <div className="landing-section-label">DEMO</div>
          <h2>一段真实对话</h2>
        </RevealSection>

        <RevealSection>
          <div className="landing-terminal">
            <div className="landing-terminal-bar">
              <div className="landing-terminal-dots"><span /><span /><span /></div>
              <span className="landing-terminal-title">Jarvis · Terminal</span>
            </div>
            <div className="landing-terminal-body">
              <div><span className="landing-t-prompt">Sir › </span><span className="landing-t-cmd">帮我调研一下 A2A 协议和 MCP 的区别</span></div>
              <div className="landing-t-out"><span className="landing-t-hi">Jarvis:</span> 收到，Sir。技术调研任务，我派团队里的调研专家去跑。</div>
              <div className="landing-t-out" style={{ marginTop: 4 }}>📋 已创建任务「A2A vs MCP 对比调研」</div>
              <div className="landing-t-out">👤 派给：技术调研（已转正 · 执行 7 次）</div>
              <div className="landing-t-out">⏱ 预计 3 分钟内交付</div>
              <div style={{ marginTop: 16 }}><span className="landing-t-prompt">Sir › </span><span className="landing-t-cmd">顺便看看 Hermes 和 OpenClaw 怎么做的</span></div>
              <div className="landing-t-out"><span className="landing-t-hi">Jarvis:</span> 明白，追加竞品维度。已给小弟补充指令。</div>
              <div className="landing-t-out" style={{ opacity: 0.5, marginTop: 4 }}>~{'>'} 又是调研任务，我快成学术论文中间商了。</div>
              <span className="landing-cursor" />
            </div>
          </div>
        </RevealSection>
      </section>

      {/* CTA */}
      <section className="landing-cta-section" id="cta">
        <RevealSection>
          <h2 style={{ fontSize: 'clamp(32px, 4.5vw, 48px)', fontWeight: 700, letterSpacing: '-0.03em', marginBottom: 16, color: 'var(--landing-text)' }}>Ready to delegate?</h2>
          <p style={{ color: 'var(--landing-text-dim)', fontSize: 17, marginBottom: 40 }}>部署你的私人管家，从此告别手动。</p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
            <a className="landing-btn-primary" href="https://github.com">GitHub →</a>
            <a className="landing-btn-ghost" href="#/">阅读文档</a>
          </div>
        </RevealSection>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        Jarvis · 你的私人 AI 管家 · Built with Claude Agent SDK + A2A
      </footer>
    </div>
  )
}
