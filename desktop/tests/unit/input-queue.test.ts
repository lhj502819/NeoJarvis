import { describe, it, expect } from 'vitest'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { createInputQueue } from '../../agent/a2a/client.js'

// 流式输入队列是 send_message 冻结修复的核心。它必须满足两条不变量,否则派单要么冻结、
// 要么永久挂起(前端"执行中"卡片永不消失):
//   1) 先 yield 首条(任务描述),之后 push 的消息按序 yield —— Jarvis 中途指令能送达。
//   2) close() 后 generator 必须 return —— 否则 SDK 的 for-await 不结束、dispatchToAgent 挂死。
function msg(text: string): SDKUserMessage {
  return { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '' }
}
function textOf(m: SDKUserMessage): string {
  const c = m.message.content
  return typeof c === 'string' ? c : ''
}

describe('createInputQueue（流式输入,send_message 修复核心）', () => {
  it('先 yield 首条任务,close 后 generator 结束', async () => {
    const iq = createInputQueue(msg('任务描述'))
    iq.close()  // 无追加消息,直接收尾
    const got: string[] = []
    for await (const m of iq.stream) got.push(textOf(m))
    expect(got).toEqual(['任务描述'])
  })

  it('中途 push 的消息按序 yield(模拟 Jarvis 追加指令送达)', async () => {
    const iq = createInputQueue(msg('任务'))
    const got: string[] = []
    const consumer = (async () => {
      for await (const m of iq.stream) {
        got.push(textOf(m))
        if (got.length === 3) iq.close()  // 收够三条后收尾
      }
    })()
    // 首条已在队列;再 push 两条(模拟 message_peer / send_message 投递)
    iq.push(msg('追加1'))
    iq.push(msg('追加2'))
    await consumer
    expect(got).toEqual(['任务', '追加1', '追加2'])
  })

  it('close 后再 push 不进流(不会复活已结束的小弟)', async () => {
    const iq = createInputQueue(msg('任务'))
    iq.close()
    iq.push(msg('迟到的消息'))  // 应被丢弃
    const got: string[] = []
    for await (const m of iq.stream) got.push(textOf(m))
    expect(got).toEqual(['任务'])
    expect(iq.isDrained()).toBe(true)
  })

  it('for-await 一定会终止(不挂起)—— 用超时兜底证明', async () => {
    const iq = createInputQueue(msg('任务'))
    iq.close()
    const drain = (async () => { for await (const _ of iq.stream) { /* consume */ } return 'done' })()
    const timeout = new Promise<string>(r => setTimeout(() => r('HANG'), 500))
    expect(await Promise.race([drain, timeout])).toBe('done')
  })
})

// 收尾终止闸(client.ts dispatchToAgent):小弟交付成功后,若 peer 消息在收尾时不停飞来,drain 会
// 一直重灌 → 循环永不退出(实测:文案小弟干完 30 分钟仍卡 running)。加上限后:交付后最多再重灌
// MAX_POST_DONE_REFEEDS 批,之后强制终止。这里把 result 处那段"drain→重灌 or 终止"的判定逻辑
// 单独建模,证明不变量:**无论 peer 消息多频繁,交付后循环必在有限步内 break**。
describe('收尾后重灌上限(dispatchToAgent 终止不变量)', () => {
  // 忠实复刻 client.ts result 分支的判定:返回 'refeed'(继续)或 'terminate'(break)
  function decide(sawSuccessResult: boolean, postDoneRefeeds: number, MAX: number, lateCount: number): 'refeed' | 'terminate' {
    const refeedCapped = sawSuccessResult && postDoneRefeeds >= MAX
    if (lateCount > 0 && !refeedCapped) return 'refeed'
    return 'terminate'
  }

  it('交付前(sawSuccessResult=false):有 late 就重灌,无 late 就终止 —— 不受上限影响', () => {
    expect(decide(false, 0, 3, 1)).toBe('refeed')     // Jarvis 追加指令等,正常消费
    expect(decide(false, 99, 3, 1)).toBe('refeed')    // 交付前 postDoneRefeeds 恒 0,这里只是验证不误触发
    expect(decide(false, 0, 3, 0)).toBe('terminate')  // 收件箱空 → 收尾
  })

  it('交付后:peer 消息持续飞,重灌到上限后必定终止(livelock 不可能)', () => {
    const MAX = 3
    let postDoneRefeeds = 0
    let steps = 0
    // 模拟"每次 drain 都还有 late 消息"的最坏情况(两个小弟收尾时互相催)
    while (true) {
      steps++
      if (steps > 100) throw new Error('未在有限步内终止 —— livelock 复现!')
      const d = decide(true, postDoneRefeeds, MAX, /* lateCount 恒 */ 1)
      if (d === 'terminate') break
      postDoneRefeeds++  // 复刻:重灌一批 +1
    }
    expect(postDoneRefeeds).toBe(MAX)  // 恰好重灌 MAX 批后终止
    expect(steps).toBe(MAX + 1)        // MAX 次 refeed + 1 次 terminate
  })

  it('交付后收件箱空:立即终止(常见 happy path)', () => {
    expect(decide(true, 0, 3, 0)).toBe('terminate')
  })
})
