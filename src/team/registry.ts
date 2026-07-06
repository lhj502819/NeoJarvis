import { randomUUID } from 'crypto'
import type { AgentRecipe } from '../shared/types.js'
import db from '../shared/db.js'

function rowToRecipe(row: any): AgentRecipe {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    tools: JSON.parse(row.tools),
    model: row.model,
    context: JSON.parse(row.context),
    persistent: row.persistent === 1,
    usageCount: row.usage_count,
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || '',
  }
}

export function listRecipes(userId: string): AgentRecipe[] {
  const rows = db.prepare('SELECT * FROM jarvis_recipes WHERE user_id = ?').all(userId) as any[]
  return rows.map(rowToRecipe)
}

export function getRecipe(userId: string, id: string): AgentRecipe | undefined {
  const row = db.prepare('SELECT * FROM jarvis_recipes WHERE id = ? AND user_id = ?').get(id, userId) as any
  return row ? rowToRecipe(row) : undefined
}

export function findMatchingRecipe(userId: string, description: string): AgentRecipe | undefined {
  const recipes = listRecipes(userId)
  const lower = description.toLowerCase()
  return recipes.find(r =>
    r.persistent && r.description.toLowerCase().split(/\W+/).some(word => word.length >= 2 && lower.includes(word))
  )
}

export function createRecipe(userId: string, params: {
  name: string
  description: string
  systemPrompt: string
  tools: string[]
  model?: string
  context?: Record<string, unknown>
  persistent?: boolean
}): AgentRecipe {
  const recipe: AgentRecipe = {
    id: randomUUID().slice(0, 8),
    name: params.name,
    description: params.description,
    systemPrompt: params.systemPrompt,
    tools: params.tools,
    model: params.model || 'sonnet',
    context: params.context || {},
    persistent: params.persistent ?? false,
    usageCount: 0,
    createdBy: 'jarvis',
    createdAt: new Date().toISOString(),
    lastUsedAt: '',
  }

  db.prepare(`
    INSERT INTO jarvis_recipes (id, user_id, name, description, system_prompt, tools, model, context, persistent, usage_count, created_by, created_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(recipe.id, userId, recipe.name, recipe.description, recipe.systemPrompt, JSON.stringify(recipe.tools), recipe.model, JSON.stringify(recipe.context), recipe.persistent ? 1 : 0, recipe.usageCount, recipe.createdBy, recipe.createdAt, recipe.lastUsedAt || null)

  return recipe
}

export function incrementUsage(userId: string, id: string) {
  db.prepare(`
    UPDATE jarvis_recipes SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ? AND user_id = ?
  `).run(new Date().toISOString(), id, userId)
}

export function promoteRecipe(userId: string, id: string) {
  db.prepare('UPDATE jarvis_recipes SET persistent = 1 WHERE id = ? AND user_id = ?').run(id, userId)
}

export function removeRecipe(userId: string, id: string) {
  db.prepare('DELETE FROM jarvis_recipes WHERE id = ? AND user_id = ?').run(id, userId)
}
