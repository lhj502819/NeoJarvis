import { randomUUID } from 'crypto'
import type { AgentRecipe } from '../shared/types.js'
import { loadJson, saveJson } from '../shared/store.js'

const RECIPES_FILE = 'recipes.json'

function load(): AgentRecipe[] {
  return loadJson<AgentRecipe[]>(RECIPES_FILE, getBuiltinRecipes())
}

function save(recipes: AgentRecipe[]) {
  saveJson(RECIPES_FILE, recipes)
}

function getBuiltinRecipes(): AgentRecipe[] {
  return []
}

export function listRecipes(): AgentRecipe[] {
  return load()
}

export function getRecipe(id: string): AgentRecipe | undefined {
  return load().find(r => r.id === id)
}

export function findMatchingRecipe(description: string): AgentRecipe | undefined {
  const recipes = load()
  const lower = description.toLowerCase()
  return recipes.find(r =>
    r.persistent && r.description.toLowerCase().split(/\W+/).some(word => word.length >= 2 && lower.includes(word))
  )
}

export function createRecipe(params: {
  name: string
  description: string
  systemPrompt: string
  tools: string[]
  model?: string
  context?: Record<string, unknown>
  persistent?: boolean
}): AgentRecipe {
  const recipes = load()
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
  recipes.push(recipe)
  save(recipes)
  return recipe
}

export function incrementUsage(id: string) {
  const recipes = load()
  const recipe = recipes.find(r => r.id === id)
  if (recipe) {
    recipe.usageCount++
    recipe.lastUsedAt = new Date().toISOString()
    save(recipes)
  }
}

export function promoteRecipe(id: string) {
  const recipes = load()
  const recipe = recipes.find(r => r.id === id)
  if (recipe) {
    recipe.persistent = true
    save(recipes)
  }
}

export function removeRecipe(id: string) {
  const recipes = load().filter(r => r.id !== id)
  save(recipes)
}
