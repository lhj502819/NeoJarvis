import type { AgentRecipe } from '../shared/types.js'
import { serverGet, serverPost, serverDelete } from '../shared/server-client.js'

/**
 * v0.3: the recipe data layer no longer touches PostgreSQL directly — it calls the Java
 * server's REST API (see RecipeController). The Java AgentRecipe record is field-for-field
 * identical to the TS AgentRecipe (camelCase JSON), so responses deserialize directly with
 * no row->object mapping. Signatures are unchanged from the old pool-based version.
 */

export async function listRecipes(userId: string): Promise<AgentRecipe[]> {
  return serverGet<AgentRecipe[]>(userId, '/api/recipes')
}

export async function listRecipesByIds(ids: string[]): Promise<Map<string, AgentRecipe>> {
  if (ids.length === 0) return new Map()
  // by-ids is NOT user-scoped (the Java endpoint ignores UserContext). There is no userId in
  // this signature, so we pass a placeholder for the X-Internal-User header just to satisfy
  // the dev-bypass auth filter — the value is irrelevant to the query.
  const query = ids.map(encodeURIComponent).join(',')
  const rows = await serverGet<AgentRecipe[]>('local', `/api/recipes/by-ids?ids=${query}`)
  const map = new Map<string, AgentRecipe>()
  for (const r of rows) map.set(r.id, r)
  return map
}

export async function getRecipe(userId: string, id: string): Promise<AgentRecipe | undefined> {
  // No single-recipe endpoint; filter the user-scoped list (preserves the old WHERE user_id guard).
  const recipes = await listRecipes(userId)
  return recipes.find(r => r.id === id)
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
  skills?: string[]
  model?: string
  context?: Record<string, unknown>
  persistent?: boolean
  avatar?: string
}): Promise<AgentRecipe> {
  // Java applies the same defaults the old TS did (id, skills=[], model='sonnet', context={},
  // persistent=false, createdBy='jarvis', usageCount=0) and returns the full AgentRecipe.
  return serverPost<AgentRecipe>(userId, '/api/recipes', params)
}

export async function incrementUsage(userId: string, id: string): Promise<void> {
  await serverPost(userId, `/api/recipe/${id}/increment-usage`)
}

export async function promoteRecipe(userId: string, id: string): Promise<void> {
  await serverPost(userId, `/api/recipe/${id}/promote`)
}

export async function removeRecipe(userId: string, id: string): Promise<void> {
  await serverDelete(userId, `/api/recipe/${id}`)
}
