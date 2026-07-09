import { Router } from 'express'
import { getTaskSummary, listTasks, getTaskDetail } from '../../task/manager.js'
import { getState } from '../state.js'
import { listAllRunningTasks } from '../../a2a/registry.js'
import { listAgentSessions } from '../../a2a/history.js'
import { listRecipes } from '../../team/registry.js'
import { listCredentials, addCredential, updateCredential, deleteCredential } from '../../auth/credentials.js'

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

  return router
}
