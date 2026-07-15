import { Router } from 'express'
import { getTaskSummary, listTasks, getTaskDetail, listSubtasksByAssignee } from '../../task/manager.js'
import { getState } from '../state.js'
import { listAllRunningTasks } from '../../a2a/registry.js'
import { listAgentSessions } from '../../a2a/history.js'
import { listRecipes } from '../../team/registry.js'
import { listCredentials, addCredential, updateCredential, deleteCredential } from '../../auth/credentials.js'
import { listSkillsForUser, setSkillEnabled } from '../skill-prefs.js'
import { serverGet } from '../../shared/server-client.js'

export function dashboardRoutes(): Router {
  const router = Router()

  router.get('/tasks', async (req, res) => {
    res.json({ summary: await getTaskSummary(req.userId!), tasks: await listTasks(req.userId!) })
  })

  router.get('/api/task/:taskId', async (req, res) => {
    const detail = await getTaskDetail(req.userId!, req.params.taskId)
    if (!detail) { res.status(404).json({ error: '任务不存在' }); return }
    res.json(detail)
  })

  router.get('/api/state', async (req, res) => {
    res.json(await getState(req.userId!))
  })

  router.get('/api/agents', (req, res) => {
    res.json(listAllRunningTasks(req.userId!))
  })

  router.get('/api/history', async (req, res) => {
    res.json(await listAgentSessions(req.userId!))
  })

  router.get('/api/recipes', async (req, res) => {
    res.json(await listRecipes(req.userId!))
  })

  router.get('/api/recipe/:recipeId/subtasks', async (req, res) => {
    const subtasks = await listSubtasksByAssignee(req.userId!, req.params.recipeId)
    res.json(subtasks)
  })

  router.get('/api/artifacts', async (req, res) => {
    const type = req.query.type as string | undefined
    const q = req.query.q as string | undefined
    const limit = Math.min(Number(req.query.limit) || 50, 100)
    const offset = Number(req.query.offset) || 0

    // Java GET /api/artifacts owns the filtering/paging and returns { total, items } with
    // items in camelCase (createdAt/updatedAt). The dashboard UI still reads snake_case
    // (ArtifactsPage.tsx: created_at/updated_at), so map the two timestamp keys back to
    // preserve the exact response shape the frontend expects.
    const params = new URLSearchParams()
    if (type) params.set('type', type)
    if (q) params.set('q', q)
    params.set('limit', String(limit))
    params.set('offset', String(offset))

    const data = await serverGet<{
      total: number
      items: Array<{ id: string; type: string; title: string; language?: string; version: number; createdAt: number; updatedAt?: number }>
    }>(req.userId!, `/api/artifacts?${params.toString()}`)

    res.json({
      total: data.total,
      items: data.items.map(it => ({
        id: it.id,
        type: it.type,
        title: it.title,
        language: it.language,
        version: it.version,
        created_at: it.createdAt,
        updated_at: it.updatedAt,
      })),
    })
  })

  router.get('/api/credentials', async (req, res) => {
    res.json(await listCredentials(req.userId!))
  })

  router.post('/api/credentials', async (req, res) => {
    const { label, tier, apiKey, baseUrl, model, isDefault } = req.body
    if (!label || !tier || !apiKey || !baseUrl || !model) {
      res.status(400).json({ error: 'label、tier、apiKey、baseUrl、model 均为必填' })
      return
    }
    const cred = await addCredential(req.userId!, { label, tier, apiKey, baseUrl, model, isDefault })
    res.json(cred)
  })

  router.put('/api/credentials/:id', async (req, res) => {
    const { label, tier, apiKey, baseUrl, model, isDefault } = req.body
    const cred = await updateCredential(req.userId!, req.params.id, { label, tier, apiKey, baseUrl, model, isDefault })
    if (!cred) { res.status(404).json({ error: '凭证不存在' }); return }
    res.json(cred)
  })

  router.delete('/api/credentials/:id', async (req, res) => {
    const ok = await deleteCredential(req.userId!, req.params.id)
    if (!ok) { res.status(404).json({ error: '凭证不存在' }); return }
    res.json({ ok: true })
  })

  router.get('/api/skills', async (req, res) => {
    res.json(await listSkillsForUser(req.userId!))
  })

  router.post('/api/skills/:name/toggle', async (req, res) => {
    const { enabled } = req.body as { enabled?: boolean }
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled 必须是 boolean' })
      return
    }
    await setSkillEnabled(req.userId!, req.params.name, enabled)
    res.json({ ok: true })
  })

  return router
}
