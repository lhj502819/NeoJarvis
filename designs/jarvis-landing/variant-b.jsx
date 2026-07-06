/* Variant B — "Orbital Command" — emphasis on clean geometry, animated orbit diagram, and cinematic scroll */
const VariantB = () => {
  const [activeOrbit, setActiveOrbit] = React.useState(0);

  React.useEffect(() => {
    const timer = setInterval(() => setActiveOrbit(a => (a + 1) % 3), 3000);
    return () => clearInterval(timer);
  }, []);

  const orbitLayers = [
    { label: 'Agent 团队', radius: 160, items: ['调研', '开发', '文档', '测试'], color: 'var(--j-accent-purple)' },
    { label: 'Jarvis 管家', radius: 90, items: ['规划', '调度', '监控'], color: 'var(--j-accent-cyan)' },
    { label: 'Sir', radius: 0, items: [], color: '#fff' },
  ];

  const features = [
    { num: '01', title: '对话即指令', desc: '跟 Jarvis 说人话，它自己判断该调研、该写代码、还是该回答你。不需要学任何语法。', accent: 'var(--j-accent-cyan)' },
    { num: '02', title: '任务自动拆解', desc: 'Jarvis 把大任务切成互不阻塞的子任务，分配给最合适的 Agent 并行执行。', accent: 'var(--j-accent-purple)' },
    { num: '03', title: '团队越用越强', desc: '执行 3 次以上的 Agent 自动沉淀为"正式员工"，带着经验和偏好复用。', accent: 'var(--j-accent-pink)' },
    { num: '04', title: '全程可视', desc: 'Dashboard 实时看进度、打断 Agent、查历史。一切透明可控。', accent: 'var(--j-accent-cyan)' },
  ];

  const pains = [
    { icon: '🖥️', title: '来回切终端', desc: '开着五六个 Claude Code，一个个盯、一个个切，手比脑子还忙。' },
    { icon: '🙋', title: '不停被请示', desc: '每个 Agent 干两步就停下来问你一句，你成了人肉 confirm 按钮。' },
    { icon: '🧠', title: '大脑在退化', desc: '什么都先丢给 AI，久了发现自己不再深度思考——像一具没灵魂的躯体。' },
  ];

  const vsData = {
    cols: [
      { name: 'OpenClaw', tag: 'Ecosystem-first', us: false, rows: ['一个连接万物的助手', '你 · 操作员', '拼渠道广度（25+ IM 平台）'] },
      { name: 'Hermes', tag: 'Learning-first', us: false, rows: ['一个自我进化的私人助手', '你 · 操作员', '单个助手越来越懂你'] },
      { name: 'Jarvis', tag: 'Org-first', us: true, rows: ['一个替你管理助手们的主管', '你 · 老板（Sir）', '一支被组建、被培养的团队'] },
    ],
    labels: ['本质是什么', '你的角色', '进化的单位'],
  };

  return (
    <div data-screen-label="Variant B — Orbital Command">
      <div className="j-grid-bg"></div>

      {/* Hero — orbit animation */}
      <section className="j-hero j-section" style={{gap: 0}}>
        <div style={{position: 'relative', width: 360, height: 360, marginBottom: 48}}>
          {/* Orbit rings */}
          {[160, 110, 60].map((r, i) => (
            <div key={i} style={{
              position: 'absolute',
              top: '50%', left: '50%',
              width: r * 2, height: r * 2,
              marginTop: -r, marginLeft: -r,
              border: `1px solid ${i === activeOrbit ? 'var(--j-accent-cyan)' : 'var(--j-border)'}`,
              borderRadius: '50%',
              transition: 'border-color 0.5s',
              opacity: i === activeOrbit ? 1 : 0.4,
            }}></div>
          ))}
          {/* Center node */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            width: 56, height: 56, marginTop: -28, marginLeft: -28,
            background: 'linear-gradient(135deg, var(--j-accent-cyan), var(--j-accent-purple))',
            borderRadius: '50%',
            display: 'grid', placeItems: 'center',
            color: '#000', fontWeight: 700, fontSize: 18, fontFamily: 'var(--j-font)',
            boxShadow: '0 0 40px rgba(0, 220, 255, 0.4)',
          }}>J</div>
          {/* Orbiting nodes */}
          {orbitLayers[0].items.map((item, i) => {
            const angle = (i / orbitLayers[0].items.length) * Math.PI * 2 - Math.PI / 2;
            const x = Math.cos(angle) * 160;
            const y = Math.sin(angle) * 160;
            return (
              <div key={i} style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: `translate(${x - 20}px, ${y - 14}px)`,
                padding: '6px 12px',
                background: 'var(--j-bg-card)',
                border: '1px solid var(--j-border-glow)',
                borderRadius: 6,
                fontSize: 12,
                fontFamily: 'var(--j-font)',
                color: 'var(--j-accent-cyan)',
                whiteSpace: 'nowrap',
              }}>{item}</div>
            );
          })}
          {orbitLayers[1].items.map((item, i) => {
            const angle = (i / orbitLayers[1].items.length) * Math.PI * 2 + Math.PI / 6;
            const x = Math.cos(angle) * 110;
            const y = Math.sin(angle) * 110;
            return (
              <div key={i} style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: `translate(${x - 16}px, ${y - 10}px)`,
                padding: '4px 10px',
                background: 'rgba(139, 92, 246, 0.1)',
                border: '1px solid rgba(139, 92, 246, 0.3)',
                borderRadius: 6,
                fontSize: 11,
                fontFamily: 'var(--j-font)',
                color: 'var(--j-accent-purple)',
                whiteSpace: 'nowrap',
              }}>{item}</div>
            );
          })}
        </div>

        <h1 style={{fontSize: 'clamp(40px, 6vw, 72px)', marginBottom: 16, background: 'linear-gradient(135deg, #fff 30%, var(--j-accent-cyan) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'}}>
          Your AI Chief of Staff
        </h1>
        <p className="j-hero-sub">
          Jarvis 不只是聊天机器人。它是你的私人管家团队——<br/>理解你、替你想、帮你干、向你报。
        </p>
        <div className="j-cta-group">
          <a href="#/chat" className="j-btn-primary">开始使用</a>
          <a href="#features" className="j-btn-ghost">看看能力</a>
        </div>
      </section>

      {/* Pain point */}
      <section className="j-pain j-section">
        <div className="j-section-label">// the problem</div>
        <h2 className="j-section-heading">当你有了一堆 AI，谁来管这堆 AI？</h2>
        <p className="j-pain-lead">
          公司都在提"AI 提效"，两周的需求几天就得干完，于是你同时开着一堆 Agent——
          <span className="j-pain-em">不知不觉，你从写代码的人，变成了一个"赛博包工头"。</span>
        </p>
        <div className="j-pain-grid">
          {pains.map((p, i) => (
            <div className="j-pain-card" key={i}>
              <div className="j-pain-card-icon">{p.icon}</div>
              <div className="j-pain-card-title">{p.title}</div>
              <div className="j-pain-card-desc">{p.desc}</div>
            </div>
          ))}
        </div>
        <div className="j-pain-turn">
          钢铁侠再忙，也不用自己盯着每一台机器——因为他有 <b>Jarvis</b>。
          那我们呢？好像也缺这么一个角色。
        </div>
      </section>

      {/* Versus */}
      <section className="j-vs j-section">
        <div className="j-section-label">// why not just another assistant</div>
        <h2 className="j-section-heading">不是又一个助手，是你的主管</h2>
        <div className="j-vs-grid">
          {vsData.cols.map((col, i) => (
            <div className={`j-vs-col${col.us ? ' jarvis' : ''}`} key={i}>
              <div className="j-vs-name">{col.name}</div>
              <div className="j-vs-tag">{col.tag}</div>
              {col.rows.map((val, j) => (
                <div className="j-vs-row" key={j}>
                  <div className="j-vs-row-label">{vsData.labels[j]}</div>
                  <div className="j-vs-row-val">{val}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="j-vs-punch">
          <span className="dim">OpenClaw / Hermes 让你把 AI 用得更好；</span><br/>
          <span className="hi">Jarvis 让你不用再亲自用 AI。</span>
        </div>
      </section>

      {/* Features — numbered list style */}
      <section className="j-section" style={{padding: '120px 0'}} id="features">
        <div className="j-section-label">// what it does</div>
        <h2 className="j-section-heading">核心能力</h2>
        <div style={{display: 'flex', flexDirection: 'column', gap: 32}}>
          {features.map((f, i) => (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: '60px 1fr',
              gap: 20,
              padding: '24px 0',
              borderBottom: '1px solid var(--j-border)',
              alignItems: 'start',
            }}>
              <span style={{fontFamily: 'var(--j-font)', fontSize: 32, fontWeight: 700, color: f.accent, opacity: 0.6}}>{f.num}</span>
              <div>
                <div style={{fontSize: 20, fontWeight: 600, marginBottom: 8}}>{f.title}</div>
                <div style={{fontSize: 15, color: 'var(--j-text-secondary)', lineHeight: 1.7}}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Architecture — horizontal flow */}
      <section className="j-section" style={{padding: '120px 0'}}>
        <div className="j-section-label">// how it works</div>
        <h2 className="j-section-heading">执行流程</h2>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 0, flexWrap: 'wrap', margin: '40px 0',
        }}>
          {['💬 下达指令', '🧠 拆解规划', '🚀 并行执行', '📋 汇报结果'].map((step, i) => (
            <React.Fragment key={i}>
              <div style={{
                padding: '16px 24px',
                background: 'var(--j-bg-card)',
                border: '1px solid var(--j-border)',
                borderRadius: 'var(--j-radius)',
                fontSize: 14,
                fontWeight: 500,
                textAlign: 'center',
                minWidth: 120,
              }}>{step}</div>
              {i < 3 && <div style={{
                width: 40, height: 2,
                background: 'linear-gradient(90deg, var(--j-accent-cyan), var(--j-accent-purple))',
                opacity: 0.5,
                flexShrink: 0,
              }}></div>}
            </React.Fragment>
          ))}
        </div>
      </section>

      {/* Terminal Demo */}
      <section className="j-demo j-section">
        <div className="j-section-label">// in action</div>
        <h2 className="j-section-heading">实际运行效果</h2>
        <div className="j-demo-terminal">
          <div className="j-demo-titlebar">
            <div className="j-demo-dots"><span></span><span></span><span></span></div>
            <span className="j-demo-title">jarvis — live</span>
          </div>
          <div className="j-demo-body">
            <div className="j-demo-line"><span className="j-demo-prompt">Sir:</span> <span className="j-demo-cmd">帮我看下现在团队有谁在干活</span></div>
            <div className="j-demo-line"><span className="j-demo-output"></span></div>
            <div className="j-demo-line"><span className="j-demo-output">Jarvis: 报告 Sir，当前团队状态：</span></div>
            <div className="j-demo-line"><span className="j-demo-highlight">  ├─ 调研专家 (running) — 竞品分析</span></div>
            <div className="j-demo-line"><span className="j-demo-highlight">  ├─ 代码专家 (idle) — 待命</span></div>
            <div className="j-demo-line"><span className="j-demo-highlight">  └─ 文档整理 (running) — 周报汇总</span></div>
            <div className="j-demo-line"><span className="j-demo-output"></span></div>
            <div className="j-demo-line"><span className="j-demo-output">2 个在忙，1 个待命。需要我调度谁吗？</span></div>
          </div>
        </div>
      </section>

      {/* Vision */}
      <section className="j-vision j-section">
        <div className="j-section-label" style={{textAlign: 'center'}}>// the vision</div>
        <h2 className="j-section-heading" style={{textAlign: 'center'}}>无处不在的 Jarvis</h2>
        <div className="j-vision-orbit">
          <div className="j-vision-device" style={{top: 0, left: '8%'}}>💻 电脑</div>
          <div className="j-vision-device" style={{top: '20%', right: '5%', animationDelay: '-2s'}}>📱 手机</div>
          <div className="j-vision-device" style={{bottom: '10%', left: '2%', animationDelay: '-4s'}}>📟 平板</div>
          <div className="j-vision-device" style={{bottom: 0, right: '12%', animationDelay: '-1s'}}>🔊 音箱</div>
          <div className="j-vision-core">"Hello, Jarvis"</div>
        </div>
        <p className="j-vision-lead">
          不只是开发。孩子的作业、家里的开支、生活里每一件杂事——<br/>都可以交给一个专管它的小弟。
        </p>
        <p className="j-vision-sub">
          手机里、电脑里、平板里、音箱里……只要你需要他的地方，
          喊一声 "Hello, Jarvis" 就够了。他不是一个工具，是一个越用越懂你的管家。
        </p>
      </section>

      {/* CTA */}
      <section className="j-final-cta j-section">
        <h2 style={{background: 'linear-gradient(135deg, #fff, var(--j-accent-cyan))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'}}>加入候补名单</h2>
        <p>Jarvis v0.1 内测中 · 邀请制开放</p>
        <div className="j-cta-group">
          <a href="#/chat" className="j-btn-primary">申请体验 →</a>
          <a href="https://github.com" className="j-btn-ghost">GitHub →</a>
        </div>
      </section>

      <footer className="j-footer j-section">
        Jarvis v0.1 · TypeScript + Claude Agent SDK + A2A Protocol · Made by Sir's Lab
      </footer>
    </div>
  );
};

Object.assign(window, { VariantB });
