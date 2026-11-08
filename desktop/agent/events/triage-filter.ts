/**
 * 群聊分诊的确定性 fast-path。
 *
 * 京ME 群消息已经过了「必须 @机器人」这一层，再交给 LLM 判噪音时，
 * 直接提问/请求极易被误判成闲聊（真实案例：「你能收到消息吗」被丢）。
 * 这里先按明显特征放行：提问、请求动词、短选项回复（1/2/3）。
 * 没命中的才交给 LLM 做语义分诊。
 */
const REQUEST_PATTERNS: RegExp[] = [
  /[?？]/,
  /(吗|呢|啥|能不能|可不可以|是否|什么|怎么|为什么|如何|哪个|哪里|多少)/,
  /(帮我|帮忙|请|给我|查一下|查下|看一下|看看|收到|回复)/,
  /(写|改|做|跑|同步|生成|分析|调研|部署|测试|找|派|执行|处理)/,
]

export function looksLikeRequest(text: string): boolean {
  const value = String(text ?? '').trim()
  if (!value) return false
  // 短数字：很可能是对机器人选项/确认的回复（1/2/3）
  if (/^\d{1,2}$/.test(value)) return true
  return REQUEST_PATTERNS.some(re => re.test(value))
}

// 纯寒暄的确定性静默(dsh:ignore quietly, do not ask humans to confirm routine chatter):
// 群里的纯问候语不该赌 LLM 分诊——同一条 "hi" 两次判定不同(一次丢一次回)就是抖动实证。
// 这里精确匹配"只有问候、无任何其他内容"的消息,恒定判噪音。
const GREETING_RE = /^(hi|hey|hello|yo|嗨|哈喽|你好|您好|在吗|在么|早|早上好|下午好|晚上好|晚安|中午好)[!！。．.~～\s]*$/i

export function isPureGreeting(text: string): boolean {
  return GREETING_RE.test(String(text ?? '').trim())
}
