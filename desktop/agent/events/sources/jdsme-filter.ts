/**
 * 京ME 准入判定(superagent-v2 P4):Gate 的结构化输出。
 *
 * dsh 两段式过滤的 Fast Path(代码层):来源白名单/准入表/是否@机器人,
 * 在调 LLM 之前定生死。verdict 三元组供日志与后续审计:
 *   strength: explicit(明确请求) | inferred(候选观察) | filtered(过滤)
 *   basis:    addressed(@到机器人) / whitelist(白名单放行) / admission(准入表) / off(停收)
 */

export type AdmissionMode = 'explicit' | 'candidates' | 'ignore'

export interface GateVerdict {
  pass: boolean
  strength: 'explicit' | 'inferred' | 'filtered'
  basis: string
  reason: string
}

/** 群白名单语义：未配置(空数组) = 不筛选、放行全部群；配置了则只放行列出的群。 */
export function isGroupAllowed(groupId: string, whitelist: string[]): boolean {
  return whitelist.length === 0 || whitelist.includes(groupId)
}

export function gateJdmeMessage(input: {
  isDm: boolean
  groupAllowed: boolean
  atRobot: boolean
  admission: AdmissionMode
}): GateVerdict {
  const { isDm, groupAllowed, atRobot, admission } = input
  if (admission === 'ignore') {
    return { pass: false, strength: 'filtered', basis: 'off', reason: '准入表设为 ignore,整源停收' }
  }
  if (isDm) {
    // 私聊 = Sir 的直接对话,不分诊不丢弃("你好"被丢的教训)
    return { pass: true, strength: 'explicit', basis: 'addressed', reason: '私聊直接进 Jarvis' }
  }
  if (!groupAllowed) {
    return { pass: false, strength: 'filtered', basis: 'whitelist', reason: '群不在白名单' }
  }
  if (atRobot) {
    return { pass: true, strength: 'explicit', basis: 'addressed', reason: '群聊 @机器人' }
  }
  if (admission === 'candidates') {
    // 观察模式:群里讨论也放行为候选,交给 slowPath 分诊 + 评估窗口定夺
    return { pass: true, strength: 'inferred', basis: 'admission', reason: '准入表为 candidates,群消息作为候选放行' }
  }
  return { pass: false, strength: 'filtered', basis: 'admission', reason: '群聊未 @机器人(explicit 模式)' }
}
