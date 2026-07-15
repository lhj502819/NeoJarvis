import { createInterface } from 'readline'
import { config } from '../shared/config.js'

const API_BASE = `http://localhost:${config.jarvisPort}`

export async function startCli() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '',
  })

  console.log()
  console.log('\x1b[2m─────────────────────────────────────────\x1b[0m')
  console.log('\x1b[1m  Jarvis v0.1 — 你的私人 AI 管家\x1b[0m')
  console.log('\x1b[2m  随时输入，随时打断，Ctrl+C 退出\x1b[0m')
  console.log('\x1b[2m─────────────────────────────────────────\x1b[0m')
  console.log()

  let inputActive = true

  const showPrompt = () => {
    if (inputActive) {
      process.stdout.write('\x1b[36m你: \x1b[0m')
    }
  }

  const clearLine = () => {
    process.stdout.write('\r\x1b[K')
  }

  const printJarvis = (text: string) => {
    clearLine()
    for (const line of text.split('\n')) {
      console.log(`\x1b[33m  Jarvis:\x1b[0m ${line}`)
    }
    showPrompt()
  }

  const printProgress = (text: string) => {
    clearLine()
    console.log(`\x1b[2m  [进度] ${text}\x1b[0m`)
    showPrompt()
  }

  const printAlert = (text: string) => {
    clearLine()
    console.log(`\x1b[31m  [!] ${text}\x1b[0m`)
    showPrompt()
  }

  // ─── 后台 SSE 长连接，接收实时事件 ───
  const connectEvents = async () => {
    try {
      const res = await fetch(`${API_BASE}/events`)
      const reader = res.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6)
          try {
            const event = JSON.parse(raw)
            switch (event.type) {
              case 'progress':
                printProgress(event.content)
                break
              case 'response':
                printJarvis(event.content)
                break
              case 'alert':
                printAlert(event.content)
                break
              case 'connected':
                break
            }
          } catch {}
        }
      }
    } catch {
      setTimeout(connectEvents, 2000)
    }
  }

  // ─── 发送消息（非阻塞：fire-and-forget 风格）───
  const sendMessage = async (text: string) => {
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })

      if (!res.ok) {
        printJarvis(`[错误] 请求失败: ${res.status}`)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) return
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6)
          if (raw === '[DONE]') continue
          try {
            const event = JSON.parse(raw)
            if (event.type === 'response') {
              printJarvis(event.content)
            } else if (event.type === 'thinking') {
              printProgress(event.content)
            }
          } catch {}
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      printJarvis(`[错误] ${msg}`)
    }
  }

  // ─── 启动后台事件监听 ───
  connectEvents()

  // ─── 输入处理（不等 response 就允许下一条输入）───
  rl.on('line', (input) => {
    const trimmed = input.trim()
    if (!trimmed) {
      showPrompt()
      return
    }

    // 特殊命令
    if (trimmed === '/tasks' || trimmed === '/进展') {
      fetch(`${API_BASE}/tasks`)
        .then(r => r.json())
        .then(data => {
          clearLine()
          console.log(`\x1b[2m  ─── 当前任务 ───\x1b[0m`)
          console.log(`\x1b[2m  ${data.summary.replace(/\n/g, '\n  ')}\x1b[0m`)
          showPrompt()
        })
        .catch(() => printJarvis('无法获取任务状态'))
      return
    }

    // 普通消息：发出去，不阻塞输入
    sendMessage(trimmed)
    showPrompt()
  })

  showPrompt()
  await new Promise(() => {})
}
