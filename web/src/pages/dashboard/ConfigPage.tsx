import { useEffect, useState, type ReactNode } from 'react'
import { fetchJSON, putJSON, deleteJSON, postJSON } from '../../api/client'

/**
 * 配置页 —— persona 配置层 + Agent Profile（研发分身）。
 *
 * 分区：系统提示词 / 内置 Skills / 研发分身 / 系统参数。
 * 所有修改写入数据库(persona-config 文档);读取走内存缓存,保存即热生效。
 */

type SectionId = 'prompt' | 'skills' | 'skill-editor' | 'agent' | 'settings' | 'sources'
type AgentBlock = 'modules' | 'role' | 'boundaries' | 'redlines' | 'workflow' | 'taboos'

const SECTIONS: Array<{ id: SectionId; label: string; hint: string }> = [
  { id: 'agent', label: '研发分身', hint: '业务分工与执行边界' },
  { id: 'prompt', label: '系统提示词', hint: '人设与岗位纪律' },
  { id: 'skills', label: '内置 Skills', hint: '默认加载的决策规则' },
  { id: 'settings', label: '系统参数', hint: 'Watchdog / 免打扰 / 晨报' },
  { id: 'sources', label: '事件源', hint: '启停与准入模式' },
]

const AGENT_BLOCKS: Array<{ id: AgentBlock; label: string; hint: string }> = [
  { id: 'modules', label: '业务分工', hint: '模块、仓库、触发词' },
  { id: 'role', label: '角色定位', hint: '它是谁，对谁负责' },
  { id: 'boundaries', label: '分工边界', hint: '什么该接，什么该回报' },
  { id: 'redlines', label: '风险红线', hint: '不可协商的硬约束' },
  { id: 'workflow', label: '执行流程', hint: '从澄清到上线' },
  { id: 'taboos', label: '禁忌与汇报', hint: '不要做什么，怎么汇报' },
]

interface PersonaState {
  systemPromptOverridden: boolean
  systemPrompt: string
  settingsOverridden: boolean
  builtinSkills: string[]
  overriddenSkills: string[]
}

interface Editor {
  content: string
  overridden: boolean
  defaultContent: string
}

interface Settings {
  watchdog: { intervalMin: number; idleMin: number; maxMin: number; retryFailCount: number }
  quietHours: { startHour: number; endHour: number }
  proactive: { hourlyCap: number }
  morningReport: { at: string }
  events: { jdsmeGroups: string[] }
}

interface SourceFieldSpec {
  key: string
  label: string
  type: 'boolean' | 'string' | 'string[]' | 'enum'
  options?: string[]
  description?: string
}

interface SourceKindSpec {
  id: string
  title: string
  description: string
  fields: SourceFieldSpec[]
}

type SourceInstance = Record<string, any>

interface SkillView {
  name: string
  description: string
  category?: string
  icon?: string
  source: 'builtin' | 'personal'
  enabled: boolean
}

interface AgentModule {
  id: string
  capability: string
  app: string
  repo: string
  entry: string
  triggers: string[]
  domain: string
}

interface AgentProfile {
  name: string
  enabled: boolean
  title: string
  subtitle: string
  source: string
  domains: string[]
  modules: AgentModule[]
  role: string
  boundaries: string
  redlines: string
  workflow: string
  taboos: string
}

interface AgentProfileResponse {
  ok: boolean
  profile: AgentProfile
  defaults: AgentProfile
  overridden: boolean
  rendered?: { jarvis: string; worker: string }
  error?: string
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback)

export function ConfigPage() {
  const [section, setSection] = useState<SectionId>('agent')
  const [saved, setSaved] = useState('')
  const flash = (msg: string) => { setSaved(msg); window.setTimeout(() => setSaved(''), 2500) }

  // 系统提示词
  const [state, setState] = useState<PersonaState | null>(null)
  const [promptEd, setPromptEd] = useState<Editor | null>(null)

  // 内置 skills
  const [skills, setSkills] = useState<SkillView[]>([])
  // 管道 skill 在线编辑(与系统提示词同一套覆盖层机制)
  const [skillEd, setSkillEd] = useState<Editor | null>(null)
  const [skillEdName, setSkillEdName] = useState('')

  // 系统参数
  const [settings, setSettings] = useState<Settings | null>(null)
  const [settingsOverridden, setSettingsOverridden] = useState(false)

  // 事件源(P4)
  const [sourceKinds, setSourceKinds] = useState<SourceKindSpec[]>([])
  const [sourceInstances, setSourceInstances] = useState<Record<string, SourceInstance>>({})

  // 研发分身
  const [agent, setAgent] = useState<AgentProfile | null>(null)
  const [agentDefaults, setAgentDefaults] = useState<AgentProfile | null>(null)
  const [agentOverridden, setAgentOverridden] = useState(false)
  const [agentSnapshot, setAgentSnapshot] = useState('')
  const [agentBlock, setAgentBlock] = useState<AgentBlock>('modules')
  const [agentRendered, setAgentRendered] = useState<{ jarvis: string; worker: string } | null>(null)
  const [agentSaving, setAgentSaving] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    fetchJSON<{ state: PersonaState }>('/api/config/persona').then(r => setState(r.state)).catch(() => {})
    fetchJSON<Editor>('/api/config/system-prompt').then(r => setPromptEd(r)).catch(() => {})
    fetchJSON<{ user: Settings | null; effective: Settings }>('/api/config/settings').then(r => {
      setSettings(r.user ?? r.effective)
      setSettingsOverridden(!!r.user)
    }).catch(() => {})
    fetchJSON<SkillView[]>('/api/skills').then(setSkills).catch(() => {})
    fetchJSON<{ kinds: SourceKindSpec[]; instances: Record<string, SourceInstance> }>('/api/config/sources').then(r => {
      setSourceKinds(r.kinds ?? [])
      setSourceInstances(r.instances ?? {})
    }).catch(() => {})
    fetchJSON<AgentProfileResponse>('/api/config/agent-profile/dev-avatar').then(r => {
      if (!r.ok) return
      setAgent(r.profile)
      setAgentDefaults(r.defaults)
      setAgentOverridden(r.overridden)
      setAgentSnapshot(JSON.stringify(r.profile))
      setAgentRendered(r.rendered ?? null)
    }).catch(() => {})
  }, [])

  /* ── 系统提示词 ── */
  const savePrompt = async () => {
    if (!promptEd) return
    const r = await putJSON<Editor>('/api/config/system-prompt', { content: promptEd.content })
    setPromptEd(r)
    flash('系统提示词已保存,立即生效')
    fetchJSON<{ state: PersonaState }>('/api/config/persona').then(x => setState(x.state)).catch(() => {})
  }
  const resetPrompt = async () => {
    const r = await deleteJSON<Editor>('/api/config/system-prompt')
    setPromptEd(r)
    flash('已恢复内置默认')
    fetchJSON<{ state: PersonaState }>('/api/config/persona').then(x => setState(x.state)).catch(() => {})
  }

  /* ── Skills ── */
  const openPipelineSkill = (name: string) => {
    setSkillEdName(name)
    setSection('skill-editor')
    fetchJSON<Editor>(`/api/config/skills/${encodeURIComponent(name)}`).then(r => setSkillEd(r)).catch(() => {})
  }
  const savePipelineSkill = async () => {
    if (!skillEd) return
    const r = await putJSON<Editor>(`/api/config/skills/${encodeURIComponent(skillEdName)}`, { content: skillEd.content })
    setSkillEd(r)
    flash(`「${skillEdName}」已保存,立即生效`)
    fetchJSON<{ state: PersonaState }>('/api/config/persona').then(x => setState(x.state)).catch(() => {})
  }
  const resetPipelineSkill = async () => {
    const r = await deleteJSON<Editor>(`/api/config/skills/${encodeURIComponent(skillEdName)}`)
    setSkillEd(r)
    flash('已恢复内置默认')
  }
  const toggleSkill = async (name: string) => {
    const current = skills.find(s => s.name === name)
    if (!current) return
    try {
      await postJSON(`/api/skills/${encodeURIComponent(name)}/toggle`, { enabled: !current.enabled })
      setSkills(prev => prev.map(s => s.name === name ? { ...s, enabled: !s.enabled } : s))
      flash(`「${name}」已${current.enabled ? '停用' : '启用'}`)
    } catch {
      flash('切换失败,请稍后再试')
    }
  }

  /* ── 系统参数 ── */
  const saveSettings = async () => {
    if (!settings) return
    const r = await putJSON<{ user: Settings | null; effective: Settings }>('/api/config/settings', settings as unknown as Record<string, unknown>)
    setSettings(r.user ?? r.effective)
    setSettingsOverridden(!!r.user)
    flash('系统参数已保存,立即生效')
  }
  const resetSettings = async () => {
    await deleteJSON('/api/config/settings')
    const r = await fetchJSON<{ user: Settings | null; effective: Settings }>('/api/config/settings')
    setSettings(r.effective)
    setSettingsOverridden(false)
    flash('已恢复内置默认参数')
  }

  /* ── 研发分身 ── */
  const agentDirty = !!agent && !!agentSnapshot && JSON.stringify(agent) !== agentSnapshot

  const saveAgent = async () => {
    if (!agent) return
    setAgentSaving(true)
    try {
      const r = await putJSON<AgentProfileResponse>(
        `/api/config/agent-profile/${encodeURIComponent(agent.name)}`,
        agent as unknown as Record<string, unknown>,
      )
      if (!r.ok) throw new Error(r.error || '保存失败')
      setAgent(r.profile)
      setAgentDefaults(r.defaults)
      setAgentOverridden(r.overridden)
      setAgentSnapshot(JSON.stringify(r.profile))
      setAgentRendered(r.rendered ?? null)
      flash('研发分身已保存,下一次对话 / 派单生效')
    } catch (err) {
      flash(`保存失败:${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAgentSaving(false)
    }
  }

  const resetAgent = async () => {
    if (!agent) return
    const r = await deleteJSON<AgentProfileResponse>(`/api/config/agent-profile/${encodeURIComponent(agent.name)}`)
    if (!r.ok) { flash(r.error || '恢复失败'); return }
    setAgent(r.profile)
    setAgentDefaults(r.defaults)
    setAgentOverridden(r.overridden)
    setAgentSnapshot(JSON.stringify(r.profile))
    setAgentRendered(r.rendered ?? null)
    flash('已恢复研发分身默认内容')
  }

  const resetAgentBlock = () => {
    if (!agent || !agentDefaults) return
    setAgent({ ...agent, [agentBlock]: clone(agentDefaults[agentBlock]) })
    flash(`已恢复「${AGENT_BLOCKS.find(b => b.id === agentBlock)?.label}」默认,保存后生效`)
  }

  const openPreview = async () => {
    if (!agent) return
    try {
      const r = await fetchJSON<{ ok: boolean; jarvis: string; worker: string }>(
        `/api/config/agent-profile/${encodeURIComponent(agent.name)}/preview`,
      )
      if (r.ok) setAgentRendered({ jarvis: r.jarvis, worker: r.worker })
    } catch { /* 预览失败就用上一次的 */ }
    setPreviewOpen(true)
  }

  return (
    <div className="dash-page cfg-page">
      <div className="cfg-head">
        <h2>配置</h2>
        {saved && <span className="cfg-saved">✓ {saved}</span>}
        <span className="cfg-hint">所有修改写入数据库,保存即热生效,无需重启。清空内容保存 = 恢复内置默认。</span>
      </div>

      <div className="cfg-layout">
        <nav className="cfg-side">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              type="button"
              className={`cfg-nav-item${section === s.id ? ' active' : ''}`}
              onClick={() => setSection(s.id)}
            >
              <span className="cfg-nav-label">{s.label}</span>
              <span className="cfg-nav-hint">{s.hint}</span>
            </button>
          ))}
        </nav>

        <div className="cfg-content">
          {section === 'prompt' && (
            <PromptSection
              promptEd={promptEd}
              setPromptEd={setPromptEd}
              overridden={!!state?.systemPromptOverridden}
              onSave={savePrompt}
              onReset={resetPrompt}
            />
          )}

          {section === 'skills' && (
            <SkillsSection
              skills={skills}
              pipelineSkills={state?.builtinSkills ?? []}
              onToggle={toggleSkill}
              onEdit={openPipelineSkill}
            />
          )}

          {section === 'skill-editor' && skillEd && (
            <div>
              <SectionHead
                title={`内置 Skill：${skillEdName}`}
                desc="默认加载进 Jarvis 上下文的决策规则。保存后下一次对话立即生效；清空内容保存 = 恢复内置默认。"
                right={<span className="cfg-badge" data-on={skillEd.overridden}>{skillEd.overridden ? '已覆盖' : '内置默认'}</span>}
              />
              <div className="cfg-card cfg-block">
                <div className="cfg-block-head">
                  <span className="cfg-hint">这是管道 skill：每次对话都会整篇注入 system prompt。</span>
                  <span className="cfg-spacer" />
                  <button className="j-btn j-btn-ghost" onClick={resetPipelineSkill}>恢复默认</button>
                </div>
                <textarea
                  className="cfg-editor"
                  value={skillEd.content}
                  onChange={e => setSkillEd({ ...skillEd, content: e.target.value })}
                  rows={24}
                  spellCheck={false}
                />
                <div className="cfg-actions">
                  <button className="j-btn j-btn-primary" onClick={savePipelineSkill}>保存</button>
                </div>
              </div>
            </div>
          )}

          {section === 'agent' && agent && agentDefaults && (
            <AgentSection
              agent={agent}
              setAgent={setAgent}
              overridden={agentOverridden}
              block={agentBlock}
              setBlock={setAgentBlock}
              dirty={agentDirty}
              saving={agentSaving}
              onSave={saveAgent}
              onReset={resetAgent}
              onResetBlock={resetAgentBlock}
              onPreview={openPreview}
            />
          )}

          {section === 'agent' && !agent && (
            <div className="cfg-card cfg-empty">研发分身配置加载中…</div>
          )}

          {section === 'sources' && (
            <SourcesSection
              kinds={sourceKinds}
              instances={sourceInstances}
              onSaved={msg => {
                flash(msg)
                fetchJSON<{ kinds: SourceKindSpec[]; instances: Record<string, SourceInstance> }>('/api/config/sources').then(r => {
                  setSourceKinds(r.kinds ?? [])
                  setSourceInstances(r.instances ?? {})
                }).catch(() => {})
              }}
            />
          )}
          {section === 'settings' && settings && (
            <SettingsSection
              settings={settings}
              setSettings={setSettings}
              overridden={settingsOverridden}
              onSave={saveSettings}
              onReset={resetSettings}
            />
          )}

          {section === 'settings' && !settings && (
            <div className="cfg-card cfg-empty">系统参数加载中…</div>
          )}
        </div>
      </div>

      {previewOpen && agentRendered && (
        <PreviewDrawer rendered={agentRendered} onClose={() => setPreviewOpen(false)} />
      )}
    </div>
  )
}

/* ───────────────────────── 系统提示词 ───────────────────────── */

function PromptSection({
  promptEd, setPromptEd, overridden, onSave, onReset,
}: {
  promptEd: Editor | null
  setPromptEd: (v: Editor) => void
  overridden: boolean
  onSave: () => void
  onReset: () => void
}) {
  const placeholders = ['{{STATE_DESC}}', '{{MOOD}}', '{{ENERGY}}', '{{CONFIDENCE}}', '{{FAMILIARITY}}', '{{TRUST}}', '{{FAMILIARITY_STAGE}}']
  if (!promptEd) return <div className="cfg-card cfg-empty">系统提示词加载中…</div>
  return (
    <>
      <SectionHead
        title="系统提示词"
        desc="Jarvis 的人设、岗位纪律和上下文注入顺序。保存后下一次对话立即生效。"
        right={<span className="cfg-badge" data-on={overridden}>{overridden ? '已覆盖' : '内置默认'}</span>}
      />
      <div className="cfg-card cfg-block">
        <div className="cfg-block-head">
          <span className="cfg-hint">支持占位符；点击下面的占位符可追加到文末。</span>
          <span className="cfg-spacer" />
          <button className="j-btn j-btn-ghost" onClick={onReset}>恢复默认</button>
        </div>
        <textarea
          className="cfg-editor"
          name="system-prompt"
          value={promptEd.content}
          onChange={e => setPromptEd({ ...promptEd, content: e.target.value })}
          spellCheck={false}
        />
        <div className="cfg-chip-row">
          {placeholders.map(p => (
            <button key={p} type="button" className="cfg-chip" onClick={() => setPromptEd({ ...promptEd, content: `${promptEd.content}\n${p}` })}>{p}</button>
          ))}
        </div>
        <div className="cfg-actions">
          <button className="j-btn j-btn-primary" onClick={onSave}>保存</button>
          <span className="cfg-char-count">{promptEd.content.length.toLocaleString()} 字符</span>
        </div>
      </div>
    </>
  )
}

/* ───────────────────────── Skills ───────────────────────── */

function SkillsSection({
  skills, pipelineSkills, onToggle, onEdit,
}: {
  skills: SkillView[]
  pipelineSkills: string[]
  onToggle: (name: string) => void
  onEdit: (name: string) => void
}) {
  // 配置页只展示与 Jarvis 默认行为相关的 skill；172 个 hub skill 全铺出来会淹没重点。
  // 其余 skill 在左侧「技能」页管理。
  const relevantHub = skills.filter(s => s.name === 'dev-avatar' || s.name === 'promote-agent')
  const hiddenCount = Math.max(0, skills.length - relevantHub.length)

  return (
    <>
      <SectionHead
        title="内置 Skills"
        desc="默认加载进 Jarvis 上下文的决策规则。dev-avatar 定义分工，message-router 定义「先查再派」。"
        right={<span className="cfg-badge">共 {pipelineSkills.length + relevantHub.filter(s => s.enabled).length} 个启用</span>}
      />
      <div className="cfg-card cfg-block">
        <div className="cfg-skill-list">
          {pipelineSkills.map(name => (
            <div className="cfg-skill-row" key={`pipeline-${name}`} style={{ cursor: 'pointer' }} onClick={() => onEdit(name)} title="点击编辑">
              <div className="cfg-skill-icon">✦</div>
              <div className="cfg-skill-meta">
                <div className="cfg-skill-name">
                  <strong>{name}</strong>
                  <span className="cfg-badge cfg-badge-blue">管道 skill</span>
                  <span className="cfg-badge">内置</span>
                </div>
                <div className="cfg-skill-desc">
                  {name === 'authority-boundary'
                    ? '权限与拒绝纪律：职责边界、身份边界、危险动作黑名单。每次对话注入，优先级最高。'
                    : 'Jarvis 内部机制，默认加载；点击编辑。'}
                </div>
              </div>
              <button type="button" className="j-btn j-btn-ghost" onClick={e => { e.stopPropagation(); onEdit(name) }}>编辑</button>
            </div>
          ))}

          {relevantHub.map(s => (
            <div className="cfg-skill-row" key={s.name}>
              <div className="cfg-skill-icon">✦</div>
              <div className="cfg-skill-meta">
                <div className="cfg-skill-name">
                  <strong>{s.name}</strong>
                  {s.name === 'dev-avatar' && <span className="cfg-badge cfg-badge-green">默认启用</span>}
                  {s.name === 'promote-agent' && <span className="cfg-badge cfg-badge-blue">管道 skill</span>}
                  <span className="cfg-badge">{s.source === 'personal' ? '来源：hub' : '内置'}</span>
                </div>
                <div className="cfg-skill-desc">
                  {s.name === 'dev-avatar'
                    ? '总开关。关闭后即使「研发分身」页仍然启用，Jarvis 也不会注入这份分工。'
                    : s.description}
                </div>
              </div>
              <button
                type="button"
                className={`cfg-toggle${s.enabled ? ' on' : ''}`}
                aria-pressed={s.enabled}
                disabled={s.name === 'promote-agent'}
                onClick={() => onToggle(s.name)}
              />
            </div>
          ))}

          {pipelineSkills.length === 0 && relevantHub.length === 0 && (
            <div className="cfg-empty">暂无可用 skill</div>
          )}
        </div>
        {hiddenCount > 0 && (
          <div className="cfg-hint" style={{ marginTop: 12 }}>
            其他 {hiddenCount} 个 skill 在左侧「技能」页管理。
          </div>
        )}
      </div>
    </>
  )
}

/* ───────────────────────── 研发分身 ───────────────────────── */

function AgentSection({
  agent, setAgent, overridden, block, setBlock, dirty, saving,
  onSave, onReset, onResetBlock, onPreview,
}: {
  agent: AgentProfile
  setAgent: (v: AgentProfile) => void
  overridden: boolean
  block: AgentBlock
  setBlock: (b: AgentBlock) => void
  dirty: boolean
  saving: boolean
  onSave: () => void
  onReset: () => void
  onResetBlock: () => void
  onPreview: () => void
}) {
  const current = AGENT_BLOCKS.find(b => b.id === block) ?? AGENT_BLOCKS[0]

  return (
    <>
      <SectionHead
        title="研发分身"
        desc="把「什么活、派给谁、边界在哪」从代码里拿出来配置。Jarvis 用它分配任务，小弟拿到同一套红线与流程。"
        right={<button className="j-btn" onClick={onPreview}>预览注入</button>}
      />

      {!agent.enabled && (
        <div className="cfg-warn">
          <strong>已停用。</strong> Jarvis 不会加载这份分工，也不会把 PRD / TRD 任务自动路由到这个小弟。
        </div>
      )}

      <div className="cfg-card cfg-agent-hero">
        <div className="cfg-agent-mark">DA</div>
        <div className="cfg-agent-meta">
          <div className="cfg-agent-name">
            <h3>{agent.title}</h3>
            <span className={`cfg-badge ${agent.enabled ? 'cfg-badge-green' : ''}`}>{agent.enabled ? '已启用' : '已停用'}</span>
            <span className="cfg-badge cfg-badge-blue">来源：{agent.source === 'hub' ? 'hub' : '内置'}</span>
            {overridden && <span className="cfg-badge cfg-badge-yellow">已覆盖</span>}
          </div>
          <div className="cfg-agent-desc">{agent.subtitle}</div>
        </div>
        <div className="cfg-agent-side">
          <button
            type="button"
            className={`cfg-toggle${agent.enabled ? ' on' : ''}`}
            aria-pressed={agent.enabled}
            onClick={() => setAgent({ ...agent, enabled: !agent.enabled })}
          />
        </div>
      </div>

      <div className="cfg-seg">
        {AGENT_BLOCKS.map(b => (
          <button
            key={b.id}
            type="button"
            className={`cfg-seg-item${block === b.id ? ' active' : ''}`}
            onClick={() => setBlock(b.id)}
          >
            <span className="cfg-seg-label">{b.label}</span>
            <span className="cfg-seg-hint">{b.hint}</span>
          </button>
        ))}
      </div>

      <div className="cfg-card cfg-block">
        <div className="cfg-block-head">
          <div>
            <div className="cfg-section">{current.label}</div>
            <span className="cfg-hint">{blockDesc(block)}</span>
          </div>
          <span className="cfg-spacer" />
          <button className="j-btn j-btn-ghost" onClick={onResetBlock}>恢复此块默认</button>
        </div>

        {block === 'modules' ? (
          <ModulesEditor
            modules={agent.modules}
            onChange={modules => setAgent({ ...agent, modules })}
          />
        ) : (
          <>
            <textarea
              className="cfg-editor cfg-agent-editor"
              name={`agent-${block}`}
              value={agent[block]}
              onChange={e => setAgent({ ...agent, [block]: e.target.value })}
              spellCheck={false}
            />
            <div className="cfg-char-count">{agent[block].length.toLocaleString()} 字符</div>
          </>
        )}
      </div>

      <div className={`cfg-savebar${dirty ? ' dirty' : ''}`}>
        <div className="cfg-savebar-left">
          <span className="cfg-save-dot" />
          <span>{dirty ? '有未保存的修改 · 保存后下一次对话 / 派单生效' : '当前已保存'}</span>
        </div>
        <div className="cfg-savebar-right">
          <button className="j-btn j-btn-ghost" onClick={onReset}>恢复本节默认</button>
          <button className="j-btn j-btn-primary" disabled={!dirty || saving} onClick={onSave}>
            {saving ? '保存中…' : '保存修改'}
          </button>
        </div>
      </div>
    </>
  )
}

function blockDesc(block: AgentBlock): string {
  switch (block) {
    case 'modules': return 'Jarvis 的「派单地图」：先按应用/仓库/触发词匹配，再决定 domain 和小弟。'
    case 'role': return '定义这位研发分身的身份、汇报关系和价值边界。'
    case 'boundaries': return '写清什么该接、什么该回报，以及产品问题和技术问题分别找谁拍板。'
    case 'redlines': return '不可协商的硬约束。这段会直接进入小弟的 system prompt，不依赖模型自觉。'
    case 'workflow': return '从澄清、定位、出方案到上线汇报的标准动作。'
    case 'taboos': return '明确不要做的事，以及汇报格式。'
  }
}

function ModulesEditor({
  modules, onChange,
}: {
  modules: AgentModule[]
  onChange: (v: AgentModule[]) => void
}) {
  const set = (id: string, key: keyof AgentModule, value: string | string[]) => {
    onChange(modules.map(m => m.id === id ? { ...m, [key]: value } : m))
  }
  const setTriggers = (id: string, raw: string) => {
    set(id, 'triggers', raw.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean))
  }
  const add = () => {
    onChange([...modules, {
      id: `m${Date.now()}`, capability: '新业务模块', app: '', repo: '', entry: '', triggers: [], domain: 'PRD开发',
    }])
  }
  const remove = (id: string) => onChange(modules.filter(m => m.id !== id))

  return (
    <div className="cfg-table-wrap">
      <div className="cfg-table-scroll">
        <div className="cfg-table">
          <div className="cfg-tr cfg-th">
            <div>能力</div><div>应用</div><div>仓库</div><div>代码入口</div><div>触发词</div><div>默认 domain</div><div />
          </div>
          {modules.map(m => (
            <div className="cfg-tr" key={m.id}>
              <div><input className="cfg-cell-input" name={`${m.id}-capability`} value={m.capability} onChange={e => set(m.id, 'capability', e.target.value)} /></div>
              <div><input className="cfg-cell-input cfg-mono" name={`${m.id}-app`} value={m.app} title={m.app} onChange={e => set(m.id, 'app', e.target.value)} /></div>
              <div><input className="cfg-cell-input cfg-mono" name={`${m.id}-repo`} value={m.repo} title={m.repo} onChange={e => set(m.id, 'repo', e.target.value)} /></div>
              <div><input className="cfg-cell-input cfg-mono" name={`${m.id}-entry`} value={m.entry} title={m.entry} onChange={e => set(m.id, 'entry', e.target.value)} /></div>
              <div><input className="cfg-cell-input" name={`${m.id}-triggers`} value={m.triggers.join('、')} title={m.triggers.join('、')} onChange={e => setTriggers(m.id, e.target.value)} /></div>
              <div><input className="cfg-cell-input" name={`${m.id}-domain`} value={m.domain} onChange={e => set(m.id, 'domain', e.target.value)} /></div>
              <div><button type="button" className="cfg-row-delete" title="删除这一行" onClick={() => remove(m.id)}>×</button></div>
            </div>
          ))}
        </div>
      </div>
      <div className="cfg-table-foot">
        <span>{modules.length} 个业务模块 · 左右滚动查看完整字段 · Jarvis 按应用 / 仓库 / 触发词判断归属</span>
        <button type="button" className="j-btn j-btn-ghost" onClick={add}>+ 新增模块</button>
      </div>
    </div>
  )
}

/* ───────────────────────── 系统参数 ───────────────────────── */

function SettingsSection({
  settings, setSettings, overridden, onSave, onReset,
}: {
  settings: Settings
  setSettings: (v: Settings) => void
  overridden: boolean
  onSave: () => void
  onReset: () => void
}) {
  const setNum = (path: 'watchdog' | 'quietHours' | 'proactive', key: string, value: string, fallback: number) => {
    setSettings({ ...settings, [path]: { ...settings[path], [key]: num(value, fallback) } })
  }
  const groupText = settings.events.jdsmeGroups.join(', ')

  return (
    <>
      <SectionHead
        title="系统参数"
        desc="Watchdog、主动消息和事件源的运行参数。env 变量优先级高于此处，适合临时覆盖。"
        right={<span className="cfg-badge" data-on={overridden}>{overridden ? '已覆盖' : '内置默认'}</span>}
      />
      <div className="cfg-card cfg-block">
        <div className="cfg-section">Watchdog 值班巡检 <span className="cfg-hint">L1 只报告，不擅自处置</span></div>
        <div className="cfg-field-grid four">
          <Field label="巡检间隔（分钟）"><input className="j-input" name="watchdog-intervalMin" value={settings.watchdog.intervalMin} onChange={e => setNum('watchdog', 'intervalMin', e.target.value, 5)} /></Field>
          <Field label="无动静阈值（分钟）"><input className="j-input" name="watchdog-idleMin" value={settings.watchdog.idleMin} onChange={e => setNum('watchdog', 'idleMin', e.target.value, 10)} /></Field>
          <Field label="总时长上限（分钟）"><input className="j-input" name="watchdog-maxMin" value={settings.watchdog.maxMin} onChange={e => setNum('watchdog', 'maxMin', e.target.value, 30)} /></Field>
          <Field label="连环失败次数"><input className="j-input" name="watchdog-retryFailCount" value={settings.watchdog.retryFailCount} onChange={e => setNum('watchdog', 'retryFailCount', e.target.value, 2)} /></Field>
        </div>

        <div className="cfg-section">主动消息 <span className="cfg-hint">免打扰与频控</span></div>
        <div className="cfg-field-grid four">
          <Field label="免打扰开始（时）"><input className="j-input" name="quiet-startHour" value={settings.quietHours.startHour} onChange={e => setNum('quietHours', 'startHour', e.target.value, 23)} /></Field>
          <Field label="免打扰结束（时）"><input className="j-input" name="quiet-endHour" value={settings.quietHours.endHour} onChange={e => setNum('quietHours', 'endHour', e.target.value, 8)} /></Field>
          <Field label="每小时上限"><input className="j-input" name="proactive-hourlyCap" value={settings.proactive.hourlyCap} onChange={e => setNum('proactive', 'hourlyCap', e.target.value, 3)} /></Field>
          <Field label="晨报时间"><input className="j-input" name="morning-report-at" value={settings.morningReport.at} placeholder="09:00，留空停用" onChange={e => setSettings({ ...settings, morningReport: { at: e.target.value } })} /></Field>
        </div>

        <div className="cfg-section">京ME 群白名单 <span className="cfg-hint">空 = 不筛选、放行全部群；填了则只放行这些群</span></div>
        <input
          className="j-input cfg-mono"
          name="jdsme-groups"
          value={groupText}
          placeholder="群号，用逗号分隔"
          onChange={e => setSettings({
            ...settings,
            events: { jdsmeGroups: e.target.value.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean) },
          })}
        />
        <div className="cfg-hint" style={{ marginTop: 5 }}>群聊必须 @机器人；白名单为空则放行全部群，填了则只放行列出的群。私聊不受影响。</div>

        <div className="cfg-actions">
          <button className="j-btn j-btn-primary" onClick={onSave}>保存</button>
          <button className="j-btn j-btn-ghost" onClick={onReset}>恢复默认</button>
        </div>
      </div>
    </>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="cfg-field"><span>{label}</span>{children}</label>
}

/* ───────────────────────── 事件源(P4) ───────────────────────── */

const ADMISSION_LABEL: Record<string, string> = {
  explicit: '仅 @机器人（explicit）',
  candidates: '观察模式：群讨论也放行为候选（candidates）',
  ignore: '群聊全停（ignore）',
}

function SourcesSection({
  kinds, instances, onSaved,
}: {
  kinds: SourceKindSpec[]
  instances: Record<string, SourceInstance>
  onSaved: (msg: string) => void
}) {
  return (
    <>
      <SectionHead
        title="事件源"
        desc="外部事件进 Jarvis 的入口。启停、准入模式实时生效；群白名单为空表示放行全部群（私聊不受任何限制）。"
      />
      {kinds.map(kind => (
        <SourceCard key={kind.id} kind={kind} initial={instances[kind.id] ?? {}} onSaved={onSaved} />
      ))}
      <ApprovalQueue onSaved={onSaved} />
      {kinds.length === 0 && <div className="cfg-card cfg-block">暂无可用事件源。</div>}
    </>
  )
}

function SourceCard({
  kind, initial, onSaved,
}: {
  kind: SourceKindSpec
  initial: SourceInstance
  onSaved: (msg: string) => void
}) {
  const [draft, setDraft] = useState<SourceInstance>(initial)
  useEffect(() => setDraft(initial), [initial])

  const set = (key: string, value: any) => setDraft(prev => ({ ...prev, [key]: value }))

  const save = async () => {
    try {
      await putJSON(`/api/config/sources/${encodeURIComponent(kind.id)}`, draft)
      onSaved(`「${kind.title}」已保存,即时生效`)
    } catch {
      onSaved(`「${kind.title}」保存失败`)
    }
  }

  return (
    <div className="cfg-card cfg-block">
      <div className="cfg-section">{kind.title} <span className="cfg-hint">{kind.description}</span></div>
      {kind.fields.map(f => {
        const value = draft[f.key]
        if (f.type === 'boolean') {
          return (
            <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0' }}>
              <input
                type="checkbox"
                checked={value !== false}
                onChange={e => set(f.key, e.target.checked)}
              />
              <span style={{ fontSize: 13 }}>{f.label}</span>
              {f.description && <span className="cfg-hint">{f.description}</span>}
            </div>
          )
        }
        if (f.type === 'enum') {
          return (
            <div key={f.key} style={{ margin: '10px 0' }}>
              <div className="cfg-section" style={{ fontSize: 13 }}>{f.label}</div>
              <select
                className="j-input"
                value={String(value ?? '')}
                onChange={e => set(f.key, e.target.value)}
              >
                {(f.options ?? []).map(op => (
                  <option key={op} value={op}>{ADMISSION_LABEL[op] ?? op}</option>
                ))}
              </select>
              {f.description && <div className="cfg-hint" style={{ marginTop: 4 }}>{f.description}</div>}
            </div>
          )
        }
        if (f.type === 'string[]') {
          return (
            <div key={f.key} style={{ margin: '10px 0' }}>
              <div className="cfg-section" style={{ fontSize: 13 }}>{f.label}</div>
              <input
                className="j-input cfg-mono"
                value={Array.isArray(value) ? value.join(', ') : ''}
                placeholder="逗号分隔"
                onChange={e => set(f.key, e.target.value.split(/[,，\s]+/).map((x: string) => x.trim()).filter(Boolean))}
              />
              {f.description && <div className="cfg-hint" style={{ marginTop: 4 }}>{f.description}</div>}
            </div>
          )
        }
        return (
          <div key={f.key} style={{ margin: '10px 0' }}>
            <div className="cfg-section" style={{ fontSize: 13 }}>{f.label}</div>
            <input className="j-input" value={String(value ?? '')} onChange={e => set(f.key, e.target.value)} />
          </div>
        )
      })}
      <div className="cfg-actions">
        <button className="j-btn j-btn-primary" onClick={save}>保存</button>
      </div>
    </div>
  )
}

interface ApprovalRecord {
  id: string
  kind: string
  cardId: string
  title: string
  url: string
  creator: string
  status: 'pending' | 'approved' | 'rejected'
  at: number
  decidedAt?: number
  note?: string
  policyVersion: string
}

function ApprovalQueue({ onSaved }: { onSaved: (msg: string) => void }) {
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([])
  const [busy, setBusy] = useState('')

  const load = () => {
    fetchJSON<{ approvals: ApprovalRecord[] }>('/api/approvals').then(r => setApprovals(r.approvals ?? [])).catch(() => {})
  }
  useEffect(load, [])

  const decide = async (id: string, action: 'approve' | 'reject') => {
    setBusy(id)
    try {
      await postJSON(`/api/approvals/${encodeURIComponent(id)}/decide`, { action })
      onSaved(action === 'approve' ? `已批准 ${id},任务开始派发` : `已驳回 ${id}`)
      load()
    } catch {
      onSaved('审批操作失败')
    } finally {
      setBusy('')
    }
  }

  const pending = approvals.filter(a => a.status === 'pending')
  const decided = approvals.filter(a => a.status !== 'pending').slice(0, 8)

  return (
    <div className="cfg-card cfg-block">
      <div className="cfg-section">
        审批队列
        <span className="cfg-hint">需 Sir 授权的工作单元(行云需求卡等)。批准即以审批单为授权依据派工。</span>
        <span className="cfg-badge" data-on={pending.length > 0}>{pending.length} 待审批</span>
      </div>
      {pending.length === 0 && <div className="cfg-hint">队列为空。</div>}
      {pending.map(a => (
        <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', margin: '8px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{a.title}</span>
            <span className="cfg-hint">{a.id} · {a.creator} · policy {a.policyVersion}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {a.url && <a className="j-btn j-btn-ghost" href={a.url} target="_blank" rel="noreferrer">查看需求卡</a>}
            <button className="j-btn j-btn-primary" disabled={busy === a.id} onClick={() => decide(a.id, 'approve')}>批准</button>
            <button className="j-btn j-btn-ghost" disabled={busy === a.id} onClick={() => decide(a.id, 'reject')}>驳回</button>
          </div>
        </div>
      ))}
      {decided.length > 0 && (
        <>
          <div className="cfg-section" style={{ marginTop: 12 }}>最近已处理</div>
          {decided.map(a => (
            <div key={a.id} className="cfg-hint" style={{ margin: '4px 0' }}>
              {a.status === 'approved' ? '✓' : '✗'} {a.title}({a.id}){a.note ? ` — ${a.note}` : ''}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

/* ───────────────────────── 预览抽屉 ───────────────────────── */

function PreviewDrawer({
  rendered, onClose,
}: {
  rendered: { jarvis: string; worker: string }
  onClose: () => void
}) {
  const [tab, setTab] = useState<'jarvis' | 'worker'>('jarvis')
  const text = tab === 'jarvis' ? rendered.jarvis : rendered.worker
  const copy = () => { navigator.clipboard?.writeText(text).catch(() => {}) }

  return (
    <>
      <div className="cfg-drawer-backdrop" onClick={onClose} />
      <aside className="cfg-drawer">
        <div className="cfg-drawer-head">
          <div>
            <div className="cfg-drawer-title">注入预览</div>
            <div className="cfg-hint">基于已保存配置；保存后再打开会更新。system prompt 里的人设与运行时状态已省略。</div>
          </div>
          <div className="cfg-drawer-actions">
            <button className="j-btn j-btn-ghost" onClick={copy}>复制</button>
            <button className="cfg-icon-btn" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="cfg-drawer-tabs">
          <button className={tab === 'jarvis' ? 'active' : ''} onClick={() => setTab('jarvis')}>Jarvis 注入</button>
          <button className={tab === 'worker' ? 'active' : ''} onClick={() => setTab('worker')}>小弟硬约束</button>
        </div>
        <pre className="cfg-preview-pre">{text}</pre>
      </aside>
    </>
  )
}

/* ───────────────────────── 共用 ───────────────────────── */

function SectionHead({ title, desc, right }: { title: string; desc: string; right?: ReactNode }) {
  return (
    <div className="cfg-section-head">
      <div>
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
      {right && <div className="cfg-section-right">{right}</div>}
    </div>
  )
}
