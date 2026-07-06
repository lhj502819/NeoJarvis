/* Variant A — "Hologram HUD" — emphasis on particles and terminal-style animation */
const VariantA = () => {
  const [typedText, setTypedText] = React.useState('');
  const [demoStep, setDemoStep] = React.useState(0);
  const fullText = '你的私人 AI 管家';

  React.useEffect(() => {
    let i = 0;
    const timer = setInterval(() => {
      if (i <= fullText.length) {
        setTypedText(fullText.slice(0, i));
        i++;
      } else {
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, []);

  const demoLines = [
    { type: 'prompt', text: '> Sir:' },
    { type: 'cmd', text: '"帮我调研一下竞品的定价策略，整理成表格"' },
    { type: 'output', text: '' },
    { type: 'output', text: '🧠 理解意图... 拆解为 3 个子任务' },
    { type: 'output', text: '📋 子任务 1: 搜索竞品列表 → 分配给「调研专家」' },
    { type: 'output', text: '📋 子任务 2: 各家定价详情 → 分配给「数据采集员」' },
    { type: 'output', text: '📋 子任务 3: 结构化整理 → 分配给「文档整理」' },
    { type: 'output', text: '' },
    { type: 'highlight', text: '⚡ 3 个 Agent 并行执行中...' },
    { type: 'output', text: '✅ 全部完成，汇报已送达 Sir。' },
  ];

  React.useEffect(() => {
    if (demoStep >= demoLines.length) return;
    const delay = demoStep === 0 ? 1500 : demoStep < 3 ? 600 : 800;
    const timer = setTimeout(() => setDemoStep(s => s + 1), delay);
    return () => clearTimeout(timer);
  }, [demoStep]);

  const capabilities = [
    { icon: '🧠', title: '意图理解', desc: '自然语言交流，精准理解你的真实需求，不需要学习命令语法' },
    { icon: '⚙️', title: '智能拆解', desc: '自动将复杂任务分解为可执行的子任务，规划最优执行路径' },
    { icon: '👥', title: '团队调度', desc: '培养专属 Agent 团队，按领域匹配最佳执行者，越用越聪明' },
    { icon: '🔄', title: '自主进化', desc: '从每次执行中学习，优秀 Agent 自动沉淀，形成你的专属智囊团' },
  ];

  return (
    <div data-screen-label="Variant A — Hologram HUD">
      <div className="j-grid-bg"></div>
      <div className="j-orb j-orb-cyan"></div>
      <div className="j-orb j-orb-purple"></div>
      <canvas className="j-particles" id="particles-a"></canvas>

      {/* Hero */}
      <section className="j-hero j-section">
        <div className="j-hero-badge">Online • v0.1</div>
        <h1>Jarvis</h1>
        <p className="j-hero-sub" style={{fontFamily: 'var(--j-font)', fontSize: 'clamp(20px, 3vw, 28px)'}}>
          {typedText}<span className="j-cursor"></span>
        </p>
        <p className="j-hero-sub" style={{marginTop: '-24px'}}>
          理解意图 · 规划方案 · 调度团队 · 监控执行 · 汇报结果
        </p>
        <div className="j-cta-group">
          <a href="#/chat" className="j-btn-primary">开始对话 →</a>
          <a href="#architecture" className="j-btn-ghost">了解架构</a>
        </div>
      </section>

      {/* Capabilities */}
      <section className="j-capabilities j-section">
        <div className="j-section-label">// capabilities</div>
        <h2 className="j-section-heading">一句话下达，全流程托管</h2>
        <div className="j-cap-grid">
          {capabilities.map((cap, i) => (
            <div className="j-cap-card" key={i}>
              <div className="j-cap-icon">{cap.icon}</div>
              <div className="j-cap-title">{cap.title}</div>
              <div className="j-cap-desc">{cap.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Architecture */}
      <section className="j-arch j-section" id="architecture">
        <div className="j-section-label">// architecture</div>
        <h2 className="j-section-heading">三层智能架构</h2>
        <div className="j-arch-diagram">
          <div className="j-arch-layer">
            <div className="j-arch-layer-label">Interface Layer</div>
            <div className="j-arch-layer-name">你（Sir）</div>
            <div className="j-arch-layer-desc">自然语言交互 · 对话 / Dashboard / CLI</div>
          </div>
          <div className="j-arch-connector"></div>
          <div className="j-arch-layer core">
            <div className="j-arch-layer-label">Brain Layer</div>
            <div className="j-arch-layer-name">Jarvis 管家</div>
            <div className="j-arch-layer-desc">意图理解 · 任务规划 · 团队管理 · 执行监控</div>
          </div>
          <div className="j-arch-connector"></div>
          <div className="j-arch-layer">
            <div className="j-arch-layer-label">Execution Layer</div>
            <div className="j-arch-layer-name">Agent 团队</div>
            <div className="j-arch-layer-desc">专项执行 · 自动沉淀 · 经验复用 · A2A 协作</div>
          </div>
        </div>
      </section>

      {/* Demo */}
      <section className="j-demo j-section">
        <div className="j-section-label">// live demo</div>
        <h2 className="j-section-heading">看看 Jarvis 怎么工作</h2>
        <div className="j-demo-terminal">
          <div className="j-demo-titlebar">
            <div className="j-demo-dots"><span></span><span></span><span></span></div>
            <span className="j-demo-title">jarvis — session</span>
          </div>
          <div className="j-demo-body">
            {demoLines.slice(0, demoStep).map((line, i) => (
              <div className="j-demo-line" key={i}>
                {line.type === 'prompt' && <span className="j-demo-prompt">{line.text}</span>}
                {line.type === 'cmd' && <span className="j-demo-cmd">{line.text}</span>}
                {line.type === 'output' && <span className="j-demo-output">{line.text}</span>}
                {line.type === 'highlight' && <span className="j-demo-highlight">{line.text}</span>}
              </div>
            ))}
            {demoStep < demoLines.length && <span className="j-cursor" style={{marginLeft: 0}}></span>}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="j-final-cta j-section">
        <h2>Ready, Sir?</h2>
        <p>一句话开始，让 Jarvis 替你搞定一切</p>
        <div className="j-cta-group">
          <a href="#/chat" className="j-btn-primary">立即体验 →</a>
        </div>
      </section>

      <footer className="j-footer j-section">
        Jarvis v0.1 · Built with Claude Agent SDK + A2A Protocol
      </footer>
    </div>
  );
};

Object.assign(window, { VariantA });
