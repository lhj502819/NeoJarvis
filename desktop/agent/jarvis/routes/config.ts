import { Router } from 'express'
import {
  getPersonaState,
  getSystemPromptEditor,
  saveSystemPromptOverride,
  listEditableSkills,
  getSkillEditor,
  saveSkillOverride,
  getUserSettingsRaw,
  saveUserSettingsRaw,
  resetUserSettings,
  getSettings,
} from '../persona.js'
import {
  getAgentProfileAudit,
  getAgentProfileState,
  isValidAgentName,
  materializeAgentSkill,
  renderJarvisSection,
  renderWorkerConstraints,
  renderSkillMarkdown,
  resetAgentProfile,
  saveAgentProfile,
} from '../agent-profile.js'

/**
 * 配置界面 API(docs/superagent-design.md §persona 配置层)。
 *
 * 全部挂在 authMiddleware 之后;写 data/persona/ 覆盖层,读取方每次现读 —— 保存即热生效。
 * 约定:PUT body content 为空串 = 删除覆盖,回内置默认。
 */
export function configRoutes(): Router {
  const r = Router()

  // 总览:覆盖状态 + 生效内容 + 可编辑清单
  r.get('/api/config/persona', (_req, res) => {
    res.json({ ok: true, state: getPersonaState() })
  })

  // ── 系统提示词 ──
  r.get('/api/config/system-prompt', (_req, res) => {
    res.json({ ok: true, ...getSystemPromptEditor() })
  })
  r.put('/api/config/system-prompt', (req, res) => {
    const content = typeof req.body?.content === 'string' ? req.body.content : ''
    saveSystemPromptOverride(content)
    res.json({ ok: true, ...getSystemPromptEditor() })
  })
  r.delete('/api/config/system-prompt', (_req, res) => {
    saveSystemPromptOverride('')
    res.json({ ok: true, ...getSystemPromptEditor() })
  })

  // ── 内置 skill 编辑 ──
  r.get('/api/config/skills', (_req, res) => {
    res.json({ ok: true, skills: listEditableSkills() })
  })
  r.get('/api/config/skills/:name', (req, res) => {
    const editor = getSkillEditor(req.params.name)
    if (!editor) { res.status(404).json({ ok: false, error: '未知内置 skill' }); return }
    res.json({ ok: true, name: req.params.name, ...editor })
  })
  r.put('/api/config/skills/:name', (req, res) => {
    const content = typeof req.body?.content === 'string' ? req.body.content : ''
    const ok = saveSkillOverride(req.params.name, content)
    if (!ok) { res.status(404).json({ ok: false, error: '未知内置 skill' }); return }
    const editor = getSkillEditor(req.params.name)!
    res.json({ ok: true, name: req.params.name, ...editor })
  })
  r.delete('/api/config/skills/:name', (req, res) => {
    const ok = saveSkillOverride(req.params.name, '')
    if (!ok) { res.status(404).json({ ok: false, error: '未知内置 skill' }); return }
    res.json({ ok: true, name: req.params.name, ...getSkillEditor(req.params.name)! })
  })

  // ── 系统参数 ──
  r.get('/api/config/settings', (_req, res) => {
    res.json({ ok: true, user: getUserSettingsRaw(), effective: getSettings() })
  })
  r.put('/api/config/settings', (req, res) => {
    const user = req.body
    if (!user || typeof user !== 'object' || Array.isArray(user)) {
      res.status(400).json({ ok: false, error: 'settings 必须是对象' })
      return
    }
    saveUserSettingsRaw(user as Record<string, unknown>)
    res.json({ ok: true, user: getUserSettingsRaw(), effective: getSettings() })
  })
  r.delete('/api/config/settings', (_req, res) => {
    resetUserSettings()
    res.json({ ok: true, user: null, effective: getSettings() })
  })

  // ── Agent Profile（研发分身）──
  // 结构化配置：enabled / domains / modules + 六块正文。写入 data/persona/agents/<name>/，
  // 读取方每次现读；保存后下一次对话 / 派单立即生效。
  r.get('/api/config/agent-profile/:name', (req, res) => {
    if (!isValidAgentName(req.params.name)) {
      res.status(400).json({ ok: false, error: '非法的 agent 名称' })
      return
    }
    const state = getAgentProfileState(req.params.name)
    res.json({
      ok: true,
      ...state,
      rendered: {
        jarvis: renderJarvisSection(req.params.name),
        worker: renderWorkerConstraints(req.params.name),
      },
      skillDir: materializeAgentSkill(req.params.name),
      audit: getAgentProfileAudit(req.params.name, 20),
    })
  })

  r.get('/api/config/agent-profile/:name/preview', (req, res) => {
    if (!isValidAgentName(req.params.name)) {
      res.status(400).json({ ok: false, error: '非法的 agent 名称' })
      return
    }
    res.json({
      ok: true,
      jarvis: renderJarvisSection(req.params.name),
      worker: renderWorkerConstraints(req.params.name),
      skillMarkdown: renderSkillMarkdown(req.params.name),
    })
  })

  r.put('/api/config/agent-profile/:name', (req, res) => {
    if (!isValidAgentName(req.params.name)) {
      res.status(400).json({ ok: false, error: '非法的 agent 名称' })
      return
    }
    try {
      const state = saveAgentProfile(req.params.name, req.body)
      res.json({
        ok: true,
        ...state,
        rendered: {
          jarvis: renderJarvisSection(req.params.name),
          worker: renderWorkerConstraints(req.params.name),
        },
        skillDir: materializeAgentSkill(req.params.name),
        audit: getAgentProfileAudit(req.params.name, 20),
      })
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  r.delete('/api/config/agent-profile/:name', (req, res) => {
    if (!isValidAgentName(req.params.name)) {
      res.status(400).json({ ok: false, error: '非法的 agent 名称' })
      return
    }
    const state = resetAgentProfile(req.params.name)
    res.json({
      ok: true,
      ...state,
      rendered: {
        jarvis: renderJarvisSection(req.params.name),
        worker: renderWorkerConstraints(req.params.name),
      },
      skillDir: materializeAgentSkill(req.params.name),
      audit: getAgentProfileAudit(req.params.name, 20),
    })
  })

  return r
}
