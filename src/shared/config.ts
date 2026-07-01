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
