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
import { SOURCE_KINDS, getSourceKind, getJdmeInstance, saveJdmeInstance } from '../../events/sources/registry.js'
import { getXingyunInstance, saveXingyunInstance } from '../../events/sources/xingyun.js'
import {
  listScheduleTasks,
  getBuiltinMorningTask,
  getBuiltinPromotionTask,
  setBuiltinPromotionConfig,
  createScheduleTask,
  updateScheduleTask,
  deleteScheduleTask,
  setBuiltinMorningEnabled,
} from '../schedule.js'
import { reloadCronSchedule } from '../../events/sources/cron.js'
import { reloadPromotionWatch } from '../promotion-watch.js'

/**
 * 配置界面 API(docs/superagent-design.md §persona 配置层)。
 *
 * 全部挂在 authMiddleware 之后;覆盖层存文档表(P4),读取走内存缓存 —— 保存即热生效。
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
  r.put('/api/config/system-prompt', async (req, res) => {
    const content = typeof req.body?.content === 'string' ? req.body.content : ''
    await saveSystemPromptOverride(content)
    res.json({ ok: true, ...getSystemPromptEditor() })
  })
  r.delete('/api/config/system-prompt', async (_req, res) => {
    await saveSystemPromptOverride('')
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
  r.put('/api/config/settings', async (req, res) => {
    const user = req.body
    if (!user || typeof user !== 'object' || Array.isArray(user)) {
      res.status(400).json({ ok: false, error: 'settings 必须是对象' })
      return
    }
    await saveUserSettingsRaw(user as Record<string, unknown>)
    // 晨报时间/启停可能变了:重排调度器,保存即生效(不用重启)
    await reloadCronSchedule().catch(() => {})
    res.json({ ok: true, user: getUserSettingsRaw(), effective: getSettings() })
  })
  r.delete('/api/config/settings', async (_req, res) => {
    await resetUserSettings()
    await reloadCronSchedule().catch(() => {})
    res.json({ ok: true, user: null, effective: getSettings() })
  })

  // ── 事件源(P4):kind 元数据 + 实例配置(source-instance 文档表) ──
  // ── 定时任务(配置页「定时任务」分区):用户任务存文档表,晨报为内置任务 ──
  r.get('/api/config/schedules', async (req, res) => {
    const tasks = await listScheduleTasks(req.userId!)
    const builtins = [getBuiltinMorningTask(), getBuiltinPromotionTask()]
    // builtin 字段保留旧前端兼容
    res.json({ ok: true, builtin: builtins[0], builtins, tasks })
  })
  r.post('/api/config/schedules', async (req, res) => {
    try {
      const task = await createScheduleTask(req.userId!, req.body)
      await reloadCronSchedule()
      res.json({ ok: true, task })
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
  // 内置转正巡检:启停 + 巡检间隔(保存即重载巡检定时器)
  r.put('/api/config/schedules/builtin-promotion', async (req, res) => {
    try {
      const builtin = await setBuiltinPromotionConfig({
        enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
        everyMinutes: req.body?.everyMinutes === undefined ? undefined : Number(req.body.everyMinutes),
      })
      reloadPromotionWatch()
      res.json({ ok: true, builtin })
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
  // 内置晨报启停(写 settings 覆盖层,保留时间配置)
  r.put('/api/config/schedules/builtin', async (req, res) => {
    try {
      const enabled = req.body?.enabled !== false
      const builtin = await setBuiltinMorningEnabled(enabled)
      await reloadCronSchedule()
      res.json({ ok: true, builtin })
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
  r.put('/api/config/schedules/:id', async (req, res) => {
    try {
      const task = await updateScheduleTask(req.userId!, req.params.id, req.body)
      await reloadCronSchedule()
      res.json({ ok: true, task })
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
  r.delete('/api/config/schedules/:id', async (req, res) => {
    const ok = await deleteScheduleTask(req.userId!, req.params.id).catch(() => false)
    if (!ok) { res.status(404).json({ ok: false, error: '任务不存在或不可删除' }); return }
    await reloadCronSchedule()
    res.json({ ok: true })
  })

  r.get('/api/config/sources', async (req, res) => {
    const instances: Record<string, unknown> = {}
    for (const k of SOURCE_KINDS) {
      if (k.id === 'jdsme') instances[k.id] = await getJdmeInstance(req.userId!)
      if (k.id === 'xingyun') instances[k.id] = await getXingyunInstance(req.userId!)
    }
    res.json({ ok: true, kinds: SOURCE_KINDS, instances })
  })

  r.put('/api/config/sources/:id', async (req, res) => {
    const kind = getSourceKind(req.params.id)
    if (!kind) { res.status(404).json({ ok: false, error: '未知事件源' }); return }
    const patch = req.body ?? {}
    if (typeof patch !== 'object' || Array.isArray(patch)) {
      res.status(400).json({ ok: false, error: '配置必须是对象' })
      return
    }
    if (req.params.id === 'jdsme') {
      const saved = await saveJdmeInstance(req.userId!, patch)
      res.json({ ok: true, instance: saved })
      return
    }
    if (req.params.id === 'xingyun') {
      const saved = await saveXingyunInstance(req.userId!, patch)
      res.json({ ok: true, instance: saved })
      return
    }
    res.status(404).json({ ok: false, error: '未知事件源' })
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
