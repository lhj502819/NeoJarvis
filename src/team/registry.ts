import { randomUUID } from 'crypto'
import type { AgentRecipe } from '../shared/types.js'
import pool from '../shared/db.js'

function rowToRecipe(row: any): AgentRecipe {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    tools: JSON.parse(row.tools),
    model: row.model,
    context: JSON.parse(row.context),
    persistent: row.persistent === 1 || row.persistent === true,
    usageCount: row.usage_count,
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || '',
  }
}

export async function listRecipes(userId: string): Promise<AgentRecipe[]> {
  const { rows } = await pool.query('SELECT * FROM jarvis_recipes WHERE user_id = $1', [userId])
  return rows.map(rowToRecipe)
}

export async function getRecipe(userId: string, id: string): Promise<AgentRecipe | undefined> {
  const { rows } = await pool.query('SELECT * FROM jarvis_recipes WHERE id = $1 AND user_id = $2', [id, userId])
  return rows[0] ? rowToRecipe(rows[0]) : undefined
}

export async function findMatchingRecipe(userId: string, description: string): Promise<AgentRecipe | undefined> {
  const recipes = await listRecipes(userId)
  const lower = description.toLowerCase()
  return recipes.find(r =>
    r.persistent && r.description.toLowerCase().split(/\W+/).some(word => word.length >= 2 && lower.includes(word))
  )
}

export async function createRecipe(userId: string, params: {
  name: string
  description: string
  systemPrompt: string
  tools: string[]
  model?: string
  context?: Record<string, unknown>
  persistent?: boolean
}): Promise<AgentRecipe> {
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

  await pool.query(`
    INSERT INTO jarvis_recipes (id, user_id, name, description, system_prompt, tools, model, context, persistent, usage_count, created_by, created_at, last_used_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  `, [recipe.id, userId, recipe.name, recipe.description, recipe.systemPrompt, JSON.stringify(recipe.tools), recipe.model, JSON.stringify(recipe.context), recipe.persistent ? 1 : 0, recipe.usageCount, recipe.createdBy, recipe.createdAt, recipe.lastUsedAt || null])

  return recipe
}

export async function incrementUsage(userId: string, id: string): Promise<void> {
  await pool.query(`
    UPDATE jarvis_recipes SET usage_count = usage_count + 1, last_used_at = $1 WHERE id = $2 AND user_id = $3
  `, [new Date().toISOString(), id, userId])
}

export async function promoteRecipe(userId: string, id: string): Promise<void> {
  await pool.query('UPDATE jarvis_recipes SET persistent = 1 WHERE id = $1 AND user_id = $2', [id, userId])
}

export async function removeRecipe(userId: string, id: string): Promise<void> {
  await pool.query('DELETE FROM jarvis_recipes WHERE id = $1 AND user_id = $2', [id, userId])
}
