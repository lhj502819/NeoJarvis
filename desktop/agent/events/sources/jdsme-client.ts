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

export interface JdMeBotConfig {
  apiBase: string
  appKey: string
  appSecret: string
  openTeamId: string
  robotId: string | number
  robotPin?: string
  displayName?: string
  tenantId?: string
}

export interface JdMeConfig {
  server: string
  profile: string
  agentToken: string
  ownerErp?: string
  ownerNickname?: string
  pollSeconds?: number
  bot: JdMeBotConfig
  /** 建群用公共账号(task-hud 同款);缺省时退回 bot 本身 */
  groupBot?: JdMeBotConfig
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
  // token 按 appKey 缓存:分身(bot)与建群公共账号(groupBot)是两套凭证(appId/secret 不同),
  // 共用单槽会在两者之间来回失效。
  private appTokens = new Map<string, { token: string; expiresAt: number }>()
  private teamTokens = new Map<string, { token: string; expiresAt: number }>()

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
  /**
   * 调事件服务的 /joyspace/create,把 markdown 建成 JoySpace 在线文档并分享给 members。
   * 路由注意:是根路径 /joyspace/create(msg-proxy 的 me_callback 路由表),
   * 不是 /chat/me/joyspace/create —— 后者会 404(之前 send_joydoc 反复报 not found 的根因)。
   */
  async createJoyDoc(input: { title: string; folderName?: string; markdown: string; members?: string[] }): Promise<{ url: string; folderName?: string; pageId?: string; sharedTo?: number }> {
    const base = this.config.server.replace(/\/$/, '')
    const data = await this.requestJson(`${base}/joyspace/create?profile=${encodeURIComponent(this.config.profile)}`, {
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
  private async getAppToken(force = false, bot: JdMeBotConfig = this.config.bot): Promise<string> {
    const key = `${bot.appKey}|${bot.apiBase}`
    const hit = this.appTokens.get(key)
    if (!force && hit && Date.now() < hit.expiresAt) return hit.token
    const data = await this.requestJson(`${bot.apiBase.replace(/\/$/, '')}/open-api/auth/v1/app_access_token`, {
      method: 'POST',
      body: { appKey: bot.appKey, appSecret: bot.appSecret },
    })
    const token = data?.data?.appAccessToken
    if (!token) throw new Error(`换取 app token 失败:${JSON.stringify(data).slice(0, 200)}`)
    this.appTokens.set(key, { token, expiresAt: Date.now() + Math.max(60, Number(data?.data?.expireIn ?? 1800) - 120) * 1000 })
    return token
  }

  private async getTeamToken(force = false, bot: JdMeBotConfig = this.config.bot): Promise<string> {
    const key = `${bot.appKey}|${bot.openTeamId}`
    const hit = this.teamTokens.get(key)
    if (!force && hit && Date.now() < hit.expiresAt) return hit.token
    const appToken = await this.getAppToken(force, bot)
    const data = await this.requestJson(`${bot.apiBase.replace(/\/$/, '')}/open-api/auth/v1/team_access_token`, {
      method: 'POST',
      body: { appAccessToken: appToken, openTeamId: bot.openTeamId },
    })
    const token = data?.data?.teamAccessToken
    if (!token) throw new Error(`换取 team token 失败:${JSON.stringify(data).slice(0, 200)}`)
    this.teamTokens.set(key, { token, expiresAt: Date.now() + Math.max(60, Number(data?.data?.expireIn ?? 1800) - 120) * 1000 })
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

  /**
   * 建群(移植自 task-hud createGroup,同一套开放平台接口)。
   * 两个踩坑点:顶层必须带 robotId(少了会报「无此群主创群权限」);
   * 拉群账号(groupBot)和回消息账号(bot)都要作为 robot.dd 成员进群。
   * uniqueKey 绑业务对象 → 重复调用是幂等的,不会建出第二个群。
   */
  async createGroup(input: {
    name: string
    ownerErp: string
    members?: string[]
    intro?: string
    notice?: string
    uniqueKey?: string
  }): Promise<{ groupId: string; invalidMembers: unknown[] }> {
    if (!input.name) throw new Error('群名称不能为空')
    const groupBot = this.config.groupBot ?? this.config.bot
    const avatarBot = this.config.bot

    const pins = [input.ownerErp, ...(input.members ?? [])].filter(Boolean)
    const entries: Array<{ app: string; pin: string }> = []
    for (const pin of [...new Set(pins)]) entries.push({ app: 'ee', pin })
    if (avatarBot.robotPin && !pins.includes(avatarBot.robotPin)) {
      entries.push({ app: 'robot.dd', pin: avatarBot.robotPin })
    }
    if (groupBot.robotPin && !pins.includes(groupBot.robotPin)) {
      entries.push({ app: 'robot.dd', pin: groupBot.robotPin })
    }

    const payload = {
      appId: groupBot.appKey,
      erp: input.ownerErp,
      tenantId: String(groupBot.tenantId || this.config.bot.tenantId),
      robotId: String(groupBot.robotId),
      requestId: `jarvis-group-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      dateTime: Date.now(),
      params: {
        name: input.name,
        intro: input.intro ?? '',
        notice: input.notice ?? '',
        owner: { app: 'ee', pin: input.ownerErp },
        members: entries,
        uniqueKey: input.uniqueKey || `jarvis-${Date.now()}`,
      },
    }
    const token = await this.getTeamToken(false, groupBot)
    const data = await this.requestJson(`${groupBot.apiBase.replace(/\/$/, '')}/open-api/suite/v1/timline/createGroup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: payload,
    })
    if (Number(data?.code) !== 0) {
      const message = data?.msg || JSON.stringify(data).slice(0, 200)
      const hint = /无权限|没有权限|permission/i.test(message)
        ? '(开放平台 → 开发配置 → 权限管理 → 服务端API → 群组,开通后重新「上线发布」)'
        : ''
      throw new Error(`建群失败:${message}${Number.isFinite(Number(data?.code)) ? ` · code ${data.code}` : ''}${hint}`)
    }
    return {
      groupId: String(data?.data?.groupId ?? ''),
      invalidMembers: Array.isArray(data?.data?.invalidMembers) ? data.data.invalidMembers : [],
    }
  }

  sendPersonal(erp: string, content: string) {
    return this.sendRobotMessage({ erp, content })
  }
}
