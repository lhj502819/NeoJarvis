import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface Config {
  jarvisPort: number
  agentBasePort: number
  model: string
  everosApiKey: string
}

export const config: Config = {
  jarvisPort: 3000,
  agentBasePort: 3001,
  model: 'sonnet',
  everosApiKey: process.env.EVEROS_API_KEY || '',
}

function loadClaudeSettingsEnv(): Record<string, string> {
  const settingsPath = join(homedir(), '.claude', 'settings.json')
  if (!existsSync(settingsPath)) return {}
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    return settings.env || {}
  } catch {
    return {}
  }
}

const claudeEnv = loadClaudeSettingsEnv()

export const agentEnv: Record<string, string> = {
  ...process.env as Record<string, string>,
  ...claudeEnv,
}
