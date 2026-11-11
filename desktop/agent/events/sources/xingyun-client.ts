import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 行云 JACP 客户端(superagent-v2 P5)—— 从 task-hud 的 xingyun-client.mjs 移植的最小面。
 *
 * 认证:复用 task-hud 的 cookie 文件链(~/.config/task-hud/cookie 等,由 task-hud 同步时写入)。
 * v1 不做 Chrome 钥匙串提取(重依赖且会弹授权);cookie 缺失/失效 → 源停用并给出明确指引:
 * 先在 task-hud 里点一次「同步行云」,或手动把 cookie 放到上述文件。
 */

const BASE_URL = 'http://xingyun.jd.com/jacp/api/v1'

export const DEFAULT_COOKIE_FILES = [
  join(homedir(), '.config', 'task-hud', 'cookie'),
  join(homedir(), '.config', 'one-decision-deploy', 'cookie'),
  join(homedir(), '.config', 'oxygen-req', 'cookie'),
]

export const DEFAULT_SPACE_ID = '233105'

/** OxygenONE 团队空间看板 URL(task-hud 同款);卡片链接从它派生 */
const BOARD_URL = 'http://xingyun.jd.com/teamspace/scrum/OxygenONE/allWorkItems'

function cardUrl(cardId: string, sprintId: string, workitemType?: string): string {
  const path = workitemType
    ? BOARD_URL.replace('/allWorkItems', `/workitems/${workitemType}`)
    : BOARD_URL
  return `${path}?sprintId=${encodeURIComponent(sprintId)}&cardId=${encodeURIComponent(cardId)}`
}

/** 看板卡上的相关人员(负责人/协作者/关注人),归属过滤第一层。 */
function peopleFrom(card: any): string[] {
  const out = new Set<string>()
  const push = (p: any) => { const erp = String(p?.erp ?? '').trim(); if (erp) out.add(erp) }
  push(card?.owner)
  for (const key of ['cooperators', 'followers']) {
    for (const p of Array.isArray(card?.[key]) ? card[key] : []) push(p)
  }
  return [...out]
}

async function readFirstCookieFile(paths: string[]): Promise<string | null> {
  for (const filePath of paths) {
    try {
      const cookie = (await readFile(filePath, 'utf8')).trim()
      if (cookie) return cookie
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
  return null
}

/** 行云卡片(仅本源关心的字段,余者原样透传 raw) */
export interface XingyunCard {
  id: string
  cardCode: string
  title: string
  status: { code: number; desc: string }
  creatorErp: string
  creatorName: string
  description: string
  url: string
  /** 看板列表能直接拿到的相关人员 ERP(负责人/协作者/关注人)——归属过滤用 */
  people: string[]
}

export class XingyunClient {
  private cachedCookie: string | null = null

  constructor(private readonly cookieFiles: string[] = DEFAULT_COOKIE_FILES) {}

  private async getCookie(): Promise<string> {
    if (this.cachedCookie) return this.cachedCookie
    const fromFile = await readFirstCookieFile(this.cookieFiles)
    if (!fromFile) {
      throw new Error(`行云 cookie 未找到(在 ${this.cookieFiles[0]})。先在 task-hud 点一次「同步行云」,或手动写入 cookie 文件。`)
    }
    this.cachedCookie = fromFile
    return fromFile
  }

  private async requestOnce<T>(method: string, path: string, body: unknown, cookie: string): Promise<{ data?: T; authFailed?: boolean }> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { Cookie: cookie, appId: 'jacp', Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    let envelope: { code?: number; message?: string; data?: T }
    try {
      envelope = await res.json() as typeof envelope
    } catch {
      throw new Error(`行云返回了非 JSON 响应,HTTP ${res.status}`)
    }
    if (!res.ok || [304, 401].includes(envelope.code ?? 0)) return { authFailed: true }
    if (![0, 200].includes(envelope.code ?? 0)) {
      throw new Error(`行云接口失败: code=${envelope.code} ${envelope.message ?? ''}`.trim())
    }
    return { data: envelope.data }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let result = await this.requestOnce<T>(method, path, body, await this.getCookie())
    if (result.authFailed) {
      this.cachedCookie = null
      // cookie 文件可能被 task-hud 刷新过,重读一次;再失败就明确报错
      result = await this.requestOnce<T>(method, path, body, await this.getCookie())
      if (result.authFailed) throw new Error('行云登录态已失效:请先在 task-hud 重新同步行云,更新 cookie 文件')
    }
    return result.data as T
  }

  /** 迭代下全部卡片(boardCardList,未过滤人)——源轮询用:新卡片/状态流转检测 */
  async listSprintCards(sprintId: string, spaceId = DEFAULT_SPACE_ID): Promise<XingyunCard[]> {
    const boardData = await this.request<any>('POST', '/bizSpaceCard/boardCardList', {
      sprintId: Number(sprintId),
      spaceId: Number(spaceId),
    })
    const cards: any[] = Array.isArray(boardData) ? boardData : (boardData?.list ?? [])
    return cards.map(card => ({
      id: String(card.id),
      cardCode: String(card.cardCode ?? '').trim(),
      title: String(card.cardName ?? card.name ?? '').trim(),
      status: { code: Number(card.cardStatus?.code ?? 0), desc: String(card.cardStatus?.desc ?? card.cardStatus?.statusName ?? '') },
      creatorErp: String(card.creator?.erp ?? '').trim(),
      creatorName: String(card.creator?.name ?? '').trim(),
      description: String(card.description ?? '').trim(),
      url: cardUrl(String(card.id), String(sprintId), card.workitemType?.code),
      people: peopleFrom(card),
    }))
  }

  /** 卡片详情里的人员(测试主责/受理人/评审人等在列表接口拿不到,归属过滤补查用) */
  async cardPeople(cardId: string): Promise<string[]> {
    const d = await this.request<any>('GET', `/bizSpaceCard/cardDetail?id=${encodeURIComponent(cardId)}`)
    const out = new Set<string>()
    const push = (p: any) => { const erp = String(p?.erp ?? '').trim(); if (erp) out.add(erp) }
    push(d?.owner)
    if (String(d?.processorErp ?? '').trim()) out.add(String(d.processorErp).trim())
    for (const key of ['testOwners', 'followers', 'cooperators', 'receivers', 'approvers']) {
      for (const p of Array.isArray(d?.[key]) ? d[key] : []) push(p)
    }
    return [...out]
  }

  /** 卡片详情(需求正文)——建任务时注入 mandate 用 */
  async cardDetail(cardId: string): Promise<{ desc: string; descLink: string }> {
    const detail = await this.request<any>('GET', `/bizSpaceCard/cardDetail?id=${encodeURIComponent(cardId)}`)
    return {
      desc: String(detail?.desc ?? '').trim(),
      descLink: String(detail?.descLink ?? '').trim(),
    }
  }
}
