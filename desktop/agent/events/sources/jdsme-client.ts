import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 京ME(ME)客户端 —— 移植自 task-hud-mvp/src/jdsme/client.mjs,裁剪到 Jarvis 需要的
 * 收(事件服务长轮询)/ 发(开放平台机器人)两件事。
 *
 * 两套凭证彼此独立:事件服务认 X-Agent-Token;开放平台认两步换取的 team token
 * (app_access_token → team_access_token,一步到位会报 99990124)。
 * 凭证与 task-hud 共用同一份配置文件(读其原路径,互不干扰)。
 */

export const DEFAULT_JDSME_CONFIG_PATH = join(
  homedir(), 'Library', 'Application Support', 'Task HUD', 'jdsme.json',
)

export interface JdMeConfig {
  server: string
  profile: string
  agentToken: string
  ownerErp?: string
  ownerNickname?: string
  pollSeconds?: number
  bot: {
    apiBase: string
    appKey: string
    appSecret: string
    openTeamId: string
    robotId: string | number
    robotPin?: string
    displayName?: string
    tenantId?: string
  }
}

export async function loadJdMeConfig(configPath = process.env.JARVIS_JDSME_CONFIG || DEFAULT_JDSME_CONFIG_PATH): Promise<JdMeConfig | null> {
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8'))
    if (!parsed?.server || !parsed?.profile || !parsed?.agentToken) return null
    if (!parsed?.bot?.appKey || !parsed?.bot?.appSecret) return null
    return parsed as JdMeConfig
  } catch {
    return null
  }
}

export interface JdMeEvent {
  seq: number
  event: {
    eventType: string
    robotPin?: string
    event?: {
      msgId?: string
      groupId?: string
      groupName?: string
      groupTitle?: string
      chatType?: string
      sender?: { pin?: string; nickname?: string }
      body?: {
        content?: string
        atUsers?: Array<{ pin?: string; nickname?: string }>
      }
    }
  }
}

export class JdMeClient {
  private appToken: string | null = null
  private appTokenExpiresAt = 0
  private teamToken: string | null = null
  private teamTokenExpiresAt = 0

  constructor(private config: JdMeConfig, private fetchImpl: typeof fetch = globalThis.fetch) {}

  private async requestJson(url: string, opts: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {}): Promise<any> {
    const { method = 'GET', headers = {}, body = null, timeoutMs = 20_000 } = opts
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
        body: body === null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      const text = await response.text()
      let parsed: any
      try {
        parsed = text ? JSON.parse(text) : {}
      } catch {
        throw new Error(`返回了非 JSON 响应(HTTP ${response.status}):${text.slice(0, 200)}`)
      }
      if (!response.ok) {
        throw new Error(parsed?.error || parsed?.msg || `HTTP ${response.status}`)
      }
      return parsed
    } finally {
      clearTimeout(timer)
    }
  }

  // ---- 事件服务(长轮询) ----
  async fetchEvents(since: number, { wait = 0, limit = 20 } = {}): Promise<{ events: JdMeEvent[] }> {
    const base = this.config.server.replace(/\/$/, '')
    const url = `${base}/events?profile=${encodeURIComponent(this.config.profile)}`
      + `&since=${Number(since) || 0}&limit=${limit}${wait ? `&wait=${wait}` : ''}`
    return this.requestJson(url, {
      headers: { 'X-Agent-Token': this.config.agentToken },
      timeoutMs: (wait + 20) * 1000,
    })
  }

  // 服务端当前最新 seq:首次接入对齐游标,避免历史消息全量重放
  async fetchLastSeq(): Promise<number> {
    const base = this.config.server.replace(/\/$/, '')
    const data = await this.requestJson(`${base}/health?profile=${encodeURIComponent(this.config.profile)}`, {
      headers: { 'X-Agent-Token': this.config.agentToken },
    })
    return Number(data?.last_seq) || 0
  }

  // ---- JoySpace 文档(重内容出口:markdown → 在线文档,返回 url 发群) ----
  /** 调 one-ai-native 的 /chat/me/joyspace/create,把 markdown 建成 JoySpace 在线文档并分享给 members。 */
  async createJoyDoc(input: { title: string; folderName?: string; markdown: string; members?: string[] }): Promise<{ url: string; folderName?: string; pageId?: string; sharedTo?: number }> {
    const base = this.config.server.replace(/\/$/, '')
    const data = await this.requestJson(`${base}/chat/me/joyspace/create?profile=${encodeURIComponent(this.config.profile)}`, {
      method: 'POST',
      headers: { 'X-Agent-Token': this.config.agentToken },
      body: {
        title: input.title,
        ...(input.folderName ? { folder_name: input.folderName } : {}),
        markdown: input.markdown,
        ...(input.members?.length ? { members: input.members } : {}),
      },
      timeoutMs: 60_000,
    })
    if (!data?.url) throw new Error(`JoySpace 建文档失败:${JSON.stringify(data).slice(0, 200)}`)
    return { url: String(data.url), folderName: data.folderName, pageId: data.pageId, sharedTo: data.sharedTo }
  }

  // ---- 开放平台(机器人发消息) ----
  private async getAppToken(force = false): Promise<string> {
    if (!force && this.appToken && Date.now() < this.appTokenExpiresAt) return this.appToken
    const bot = this.config.bot
    const data = await this.requestJson(`${bot.apiBase.replace(/\/$/, '')}/open-api/auth/v1/app_access_token`, {
      method: 'POST',
      body: { appKey: bot.appKey, appSecret: bot.appSecret },
    })
    const token = data?.data?.appAccessToken
    if (!token) throw new Error(`换取 app token 失败:${JSON.stringify(data).slice(0, 200)}`)
    this.appToken = token
    this.appTokenExpiresAt = Date.now() + Math.max(60, Number(data?.data?.expireIn ?? 1800) - 120) * 1000
    return token
  }

  private async getTeamToken(force = false): Promise<string> {
    if (!force && this.teamToken && Date.now() < this.teamTokenExpiresAt) return this.teamToken
    const bot = this.config.bot
    const appToken = await this.getAppToken(force)
    const data = await this.requestJson(`${bot.apiBase.replace(/\/$/, '')}/open-api/auth/v1/team_access_token`, {
      method: 'POST',
      body: { appAccessToken: appToken, openTeamId: bot.openTeamId },
    })
    const token = data?.data?.teamAccessToken
    if (!token) throw new Error(`换取 team token 失败:${JSON.stringify(data).slice(0, 200)}`)
    this.teamToken = token
    this.teamTokenExpiresAt = Date.now() + Math.max(60, Number(data?.data?.expireIn ?? 1800) - 120) * 1000
    return token
  }

  // 收发目标由顶层字段决定:groupId = 发群;erp = 私聊(顶层 groupId 会被平台忽略,实测踩过)
  private async sendRobotMessage({ groupId = '', erp = '', content, atUsers = [] }: { groupId?: string; erp?: string; content: string; atUsers?: Array<{ app: string; pin: string; nickname?: string }> }) {
    if (!content || !String(content).trim()) throw new Error('消息内容不能为空')
    if (!groupId && !erp) throw new Error('必须指定 groupId 或 erp')
    const bot = this.config.bot
    const body: any = { type: 'text', content: String(content) }
    if (atUsers.length) body.atUsers = atUsers
    const payload: any = {
      appId: bot.appKey,
      requestId: `jarvis-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      dateTime: Date.now(),
      params: { robotId: String(bot.robotId), body },
    }
    if (groupId) {
      payload.groupId = String(groupId)
    } else {
      payload.erp = erp
      payload.tenantId = bot.tenantId
      payload.robotId = String(bot.robotId)
    }
    const token = await this.getTeamToken()
    const data = await this.requestJson(`${bot.apiBase.replace(/\/$/, '')}/open-api/suite/v1/timline/sendRobotMsg`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: payload,
    })
    if (Number(data?.code) !== 0) {
      throw new Error(`发送失败:${data?.msg || JSON.stringify(data).slice(0, 200)}`)
    }
    return data
  }

  sendGroup(groupId: string, content: string, atUsers: Array<{ app: string; pin: string; nickname?: string }> = []) {
    return this.sendRobotMessage({ groupId, content, atUsers })
  }

  sendPersonal(erp: string, content: string) {
    return this.sendRobotMessage({ erp, content })
  }
}
