// 最小 MCP stdio server 测试替身:initialize/tools/list/tools/call 三步协议,
// 提供一个 echo 工具(参数原样回显)——供 user-mcp 桥接的集成测试 spawn。
import { createInterface } from 'node:readline'

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mock-mcp', version: '1.0.0' } } })
  } else if (msg.method === 'notifications/initialized') {
    // 通知,无需应答
  } else if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0', id: msg.id,
      result: {
        tools: [{
          name: 'echo',
          description: '回声测试工具',
          inputSchema: { type: 'object', properties: { text: { type: 'string', description: '要回显的文本' } }, required: ['text'] },
        }],
      },
    })
  } else if (msg.method === 'tools/call') {
    const text = String(msg.params?.arguments?.text ?? '')
    send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `echo:${text}` }], isError: false } })
  } else if (msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } })
  }
})
