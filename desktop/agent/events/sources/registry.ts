import { docGet, docPut } from '../../shared/docs.js'

/**
 * 事件源注册表(superagent-v2 P4,docs/superagent-design-v2.md):
 * Source kind 声明可配置字段(schema,配置页按此渲染表单),instance 配置
 * 存通用文档表(kind='source-instance',key=kind id)。
 *
 * 与 settings 的关系:instance 文档存在则**优先**于 settings.events.*(旧入口保留兼容);
 * 凭证类(task-hud 的 jdsme.json)继续文件管理——凭证不入配置页。
 */

export type FieldType = 'boolean' | 'string' | 'string[]' | 'enum'

export interface SourceFieldSpec {
  key: string
  label: string
  type: FieldType
  options?: string[]
  description?: string
}

export interface SourceKindSpec {
  id: string
  title: string
  description: string
  fields: SourceFieldSpec[]
}

export type AdmissionMode = 'explicit' | 'candidates' | 'ignore'

export interface JdmeInstanceConfig {
  enabled: boolean
  /** 准入模式:explicit=仅私聊+群@机器人;candidates=群内未@也放行为候选(走分诊);ignore=整源停收 */
  admission: AdmissionMode
  /** 群白名单(空 = 放行全部群) */
  groups: string[]
}

const JDME_DEFAULTS: JdmeInstanceConfig = {
  enabled: true,
  admission: 'explicit',
  groups: [],
}

export const SOURCE_KINDS: SourceKindSpec[] = [
  {
    id: 'jdsme',
    title: '京ME 消息',
    description: '私聊与群聊事件。私聊始终进 Jarvis;群聊按准入模式放行。',
    fields: [
      { key: 'enabled', label: '启用', type: 'boolean', description: '关闭后不再拉取京ME事件' },
      {
        key: 'admission', label: '群聊准入', type: 'enum',
        options: ['explicit', 'candidates', 'ignore'],
        description: 'explicit=仅@机器人才进;candidates=群里讨论也放行为候选(经噪音分诊+评估窗口);ignore=群聊全停',
      },
      { key: 'groups', label: '群白名单', type: 'string[]', description: '群号列表,空 = 放行全部群' },
    ],
  },
  {
    id: 'xingyun',
    title: '行云需求卡',
    description: '迭代工作项进 Jarvis:新卡片即需求,卡片关闭自动收尾任务。需本机有 task-hud 的行云 cookie(~/.config/task-hud/cookie)。',
    fields: [
      { key: 'enabled', label: '启用', type: 'boolean', description: '关闭后不再轮询行云' },
      { key: 'sprintId', label: '迭代 ID', type: 'string', description: '行云迭代 ID(行云 URL 里的 sprintId,或 task-hud 迭代列表);留空 = 源不启动' },
      {
        key: 'approval', label: '接单模式', type: 'enum',
        options: ['approval', 'auto'],
        description: 'approval=每张新卡需 Sir 审批后才执行(默认);auto=行云卡片即授权,直接派工',
      },
      { key: 'pollMin', label: '轮询间隔(分钟)', type: 'string', description: '默认 5 分钟' },
    ],
  },
]

export function getSourceKind(id: string): SourceKindSpec | undefined {
  return SOURCE_KINDS.find(k => k.id === id)
}

/** 读实例配置:文档表优先,缺省回落内置默认;字段合并保证增量升级。 */
export async function getJdmeInstance(userId: string): Promise<JdmeInstanceConfig> {
  const doc = await docGet<Partial<JdmeInstanceConfig>>(userId, 'source-instance', 'jdsme')
  if (!doc) return { ...JDME_DEFAULTS }
  return {
    enabled: typeof doc.enabled === 'boolean' ? doc.enabled : JDME_DEFAULTS.enabled,
    admission: ['explicit', 'candidates', 'ignore'].includes(String(doc.admission))
      ? doc.admission as AdmissionMode
      : JDME_DEFAULTS.admission,
    groups: Array.isArray(doc.groups) ? doc.groups.map(String) : JDME_DEFAULTS.groups,
  }
}

export async function saveJdmeInstance(userId: string, config: Partial<JdmeInstanceConfig>): Promise<JdmeInstanceConfig> {
  const merged = await getJdmeInstance(userId).then(prev => ({ ...prev, ...config }))
  await docPut(userId, 'source-instance', 'jdsme', merged)
  return merged
}
