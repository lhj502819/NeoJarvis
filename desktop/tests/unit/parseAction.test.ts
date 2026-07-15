import { describe, it, expect } from 'vitest'
import { parseAction } from '../../agent/jarvis/brain.js'

describe('parseAction', () => {
  it('parses fenced json code block', () => {
    const text = `好的，我来创建任务。
\`\`\`json
{"action":"create_task","data":{"name":"测试","description":"desc"}}
\`\`\``
    const result = parseAction(text)
    expect(result).toEqual({ action: 'create_task', data: { name: '测试', description: 'desc' } })
  })

  it('parses fenced block without json language tag', () => {
    const text = `\`\`\`
{"action":"respond","data":{"message":"hello"}}
\`\`\``
    expect(parseAction(text)?.action).toBe('respond')
  })

  it('parses bare JSON object in text', () => {
    const text = `我来回答你的问题。{"action":"respond","data":{"message":"1+1=2"}}`
    expect(parseAction(text)?.action).toBe('respond')
  })

  it('returns null for plain text without JSON', () => {
    expect(parseAction('你好，这是一段普通文字')).toBeNull()
  })

  it('returns null for malformed JSON in fenced block', () => {
    const text = `\`\`\`json
{"action": "respond", "data": {broken
\`\`\``
    expect(parseAction(text)).toBeNull()
  })

  it('handles extra whitespace and newlines in fenced block', () => {
    const text = `\`\`\`json

  {
    "action": "ask_user",
    "data": { "question": "你想做什么？" }
  }

\`\`\``
    const result = parseAction(text)
    expect(result?.action).toBe('ask_user')
    expect(result?.data).toEqual({ question: '你想做什么？' })
  })

  it('picks fenced block over bare JSON when both exist', () => {
    const text = `{"action":"wrong"} some text
\`\`\`json
{"action":"correct","data":{}}
\`\`\``
    expect(parseAction(text)?.action).toBe('correct')
  })

  it('parses create_task with subtasks', () => {
    const text = `\`\`\`json
{
  "action": "create_task",
  "data": {
    "name": "调研",
    "description": "调研 GraphQL",
    "subtasks": [
      {"name": "查资料", "description": "搜索文档", "assignee": "技术调研", "domain": "技术调研"}
    ]
  }
}
\`\`\``
    const result = parseAction(text)
    expect(result?.action).toBe('create_task')
    expect((result?.data as any).subtasks).toHaveLength(1)
  })
})
