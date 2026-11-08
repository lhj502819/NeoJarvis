import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const root = mkdtempSync(join(tmpdir(), 'jarvis-agent-tools-'))
process.env.JARVIS_PERSONA_AGENTS_DIR = root

const { createJarvisTools } = await import('../../agent/jarvis/tools.js')
const { getAgentProfile, getAgentProfileAudit } = await import('../../agent/jarvis/agent-profile.js')

const tools = createJarvisTools('u-test')
const tool = (name: string) => {
  const found = tools.find(t => t.name === name)
  if (!found) throw new Error(`tool not found: ${name}`)
  return found
}
const callText = async (name: string, params: Record<string, unknown> = {}) => {
  const result = await (tool(name).execute as any)('call-1', params)
  return result.content[0].text as string
}
const call = async (name: string, params: Record<string, unknown> = {}) =>
  JSON.parse(await callText(name, params))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('agent config tools', () => {
  it('get_agent_profile 返回当前配置', async () => {
    const p = await call('get_agent_profile')
    expect(p.name).toBe('dev-avatar')
    expect(p.enabled).toBe(true)
    expect(p.modules).toHaveLength(8)
    expect(p.overridden).toBe(false)
  })

  it('update_agent_profile 可改开关、标题和正文，并写审计', async () => {
    await callText('update_agent_profile', {
      enabled: false,
      subtitle: '由 Jarvis 更新',
      redlines: '新红线：先确认再动手',
    })
    const p = getAgentProfile()
    expect(p.enabled).toBe(false)
    expect(p.subtitle).toBe('由 Jarvis 更新')
    expect(p.redlines).toBe('新红线：先确认再动手')

    const audit = getAgentProfileAudit('dev-avatar', 5)
    expect(audit[0].source).toBe('jarvis')
    expect(audit[0].changed).toEqual(expect.arrayContaining(['enabled', 'subtitle', 'redlines']))
  })

  it('update_agent_profile 可整体替换业务模块', async () => {
    await callText('update_agent_profile', {
      modules: [{
        capability: '新模块', app: 'app-x', repo: 'repo-x', entry: 'entry-x',
        triggers: ['触发X'], domain: 'X开发',
      }],
    })
    const p = getAgentProfile()
    expect(p.modules).toHaveLength(1)
    expect(p.modules[0].capability).toBe('新模块')
    expect(p.modules[0].triggers).toEqual(['触发X'])
  })

  it('没有字段时返回提示而不是写入', async () => {
    const result = await (tool('update_agent_profile').execute as any)('call-3', {})
    expect(result.content[0].text).toContain('没有提供要修改的字段')
  })

  it('reset=true 恢复内置默认', async () => {
    const result = await (tool('update_agent_profile').execute as any)('call-2', { reset: true })
    expect(result.content[0].text).toContain('已恢复研发分身内置默认')
    const p = getAgentProfile()
    expect(p.enabled).toBe(true)
    expect(p.modules).toHaveLength(8)
    const audit = getAgentProfileAudit('dev-avatar', 5)
    expect(audit[0].action).toBe('reset')
    expect(audit[0].source).toBe('jarvis')
  })
})
