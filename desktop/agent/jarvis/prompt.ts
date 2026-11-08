import { getState, getStateDescription } from './state.js'
import { loadSystemPromptTemplate } from './persona.js'
import { getAgentProfile, renderJarvisSection } from './agent-profile.js'
import { getDisabledSkills } from './skill-prefs.js'

/**
 * Jarvis 系统提示词组装。
 * 人设/纪律全文在 config/defaults/system-prompt.md(占位符模板),
 * data/persona/system-prompt.md 可整体覆盖(热改即生效,见 persona.ts)。
 */
export async function buildSystemPrompt(userId: string): Promise<string> {
  const state = await getState(userId)
  const stateDesc = await getStateDescription(userId)

  const familiarityStage = state.familiarity <= 30
    ? '当前阶段：与 Sir 还不够熟，先不蛐蛐，保持专业。'
    : ''

  const template = loadSystemPromptTemplate()
  const base = !template
    // 内置模板缺失(config 目录被删/损坏)时的兜底:绝不返回空 system prompt
    ? '你是 Jarvis,Sir 的私人管家。称呼用户为 Sir。注意:人设模板未加载,请简洁可靠地回答,需要执行的任务用 create_task 派给团队成员。'
    : template
      .replaceAll('{{STATE_DESC}}', stateDesc)
      .replaceAll('{{MOOD}}', String(state.mood))
      .replaceAll('{{ENERGY}}', String(state.energy))
      .replaceAll('{{CONFIDENCE}}', String(state.confidence))
      .replaceAll('{{FAMILIARITY}}', String(state.familiarity))
      .replaceAll('{{TRUST}}', String(state.trustLevel))
      .replaceAll('{{FAMILIARITY_STAGE}}', familiarityStage)

  // 默认启用的业务分工手册(dev-avatar)：Jarvis 靠它判断任务归属、选小弟和 domain。
  // Skills 页禁用同名 skill 时跳过；读 Java 失败按启用处理，绝不因配置层抖动影响对话。
  const profile = getAgentProfile()
  if (profile.enabled) {
    const disabled = await getDisabledSkills(userId).catch(() => new Set<string>())
    if (!disabled.has(profile.name)) {
      const section = renderJarvisSection(profile.name)
      if (section) return `${base}\n\n${section}`
    }
  }
  return base
}
