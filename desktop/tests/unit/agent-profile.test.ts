import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadSkillsFromDir } from '@earendil-works/pi-coding-agent'

// 必须在 import 模块前设置，agent-profile 在模块初始化时读取覆盖根目录。
const root = mkdtempSync(join(tmpdir(), 'jarvis-agent-profile-'))
process.env.JARVIS_PERSONA_AGENTS_DIR = root

const {
  DEFAULT_AGENT_NAME,
  getAgentProfile,
  getAgentProfileState,
  saveAgentProfile,
  resetAgentProfile,
  renderJarvisSection,
  renderWorkerConstraints,
  renderSkillMarkdown,
  materializeAgentSkill,
  isAgentRelevant,
  isValidAgentName,
} = await import('../../agent/jarvis/agent-profile.js')

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('agent profile · defaults', () => {
  it('默认加载 dev-avatar：启用、八个业务模块', () => {
    const p = getAgentProfile(DEFAULT_AGENT_NAME)
    expect(p.enabled).toBe(true)
    expect(p.modules).toHaveLength(8)
    expect(p.title).toContain('PRD')
    expect(p.modules.map(m => m.app)).toContain('one-decision')
  })

  it('Jarvis 视图包含分工表、边界和红线', () => {
    const section = renderJarvisSection(DEFAULT_AGENT_NAME)
    expect(section).toContain('业务分工手册')
    expect(section).toContain('PrdController')
    expect(section).toContain('表结构改动必须先确认')
    expect(section).toContain('分工边界')
  })

  it('小弟视图只包含硬约束，不重复完整分工表', () => {
    const section = renderWorkerConstraints(DEFAULT_AGENT_NAME)
    expect(section).toContain('硬约束')
    expect(section).toContain('表结构改动必须先确认')
    expect(section).toContain('不要做的事')
    expect(section).not.toContain('代码入口')
  })

  it('渲染出的 skill 有合法 frontmatter', () => {
    const md = renderSkillMarkdown(DEFAULT_AGENT_NAME)
    expect(md.startsWith('---\nname: dev-avatar\n')).toBe(true)
    expect(md).toContain('## 执行流程')
    expect(md).toContain('## 禁忌与汇报')
  })
})

describe('agent profile · overrides', () => {
  it('保存覆盖后立即生效，并可物化 SKILL.md', () => {
    const state = saveAgentProfile(DEFAULT_AGENT_NAME, {
      enabled: false,
      title: '测试分身',
      modules: [{ id: 'x1', capability: '测试模块', app: 'app-x', repo: 'repo-x', entry: 'entry-x', triggers: ['触发X'], domain: 'X开发' }],
      role: '测试角色',
      redlines: '测试红线',
    })
    expect(state.overridden).toBe(true)
    expect(state.profile.enabled).toBe(false)
    expect(state.profile.title).toBe('测试分身')
    expect(state.profile.modules).toHaveLength(1)
    expect(state.profile.modules[0].capability).toBe('测试模块')
    // 未提供的字段保留默认
    expect(state.profile.boundaries.length).toBeGreaterThan(0)

    const jarvis = renderJarvisSection(DEFAULT_AGENT_NAME)
    expect(jarvis).toContain('测试模块')
    expect(jarvis).toContain('测试红线')
    expect(jarvis).toContain('已停用')

    const dir = materializeAgentSkill(DEFAULT_AGENT_NAME)
    expect(dir).toBeTruthy()
    const skill = readFileSync(join(dir!, 'SKILL.md'), 'utf-8')
    expect(skill).toContain('name: dev-avatar')
    expect(skill).toContain('测试模块')
    expect(skill).toContain('测试红线')

    // 物化出来的内容必须能被 Pi 的资源加载器识别为合法 skill
    const loaded = loadSkillsFromDir({ dir: dir!, source: 'user' })
    expect(loaded.skills.map(s => s.name)).toContain('dev-avatar')
  })

  it('新增 / 删除模块行按数组语义处理（允许清空）', () => {
    saveAgentProfile(DEFAULT_AGENT_NAME, { modules: [] })
    expect(getAgentProfile(DEFAULT_AGENT_NAME).modules).toHaveLength(0)
    const jarvis = renderJarvisSection(DEFAULT_AGENT_NAME)
    expect(jarvis).toContain('暂未配置业务模块')
  })

  it('重置后回到内置默认', () => {
    const state = resetAgentProfile(DEFAULT_AGENT_NAME)
    expect(state.overridden).toBe(false)
    expect(state.profile.enabled).toBe(true)
    expect(state.profile.modules).toHaveLength(8)
    expect(existsSync(join(root, DEFAULT_AGENT_NAME, '.rendered'))).toBe(false)
  })
})

describe('agent profile · relevance', () => {
  it('PRD / TRD 任务命中', () => {
    expect(isAgentRelevant({ domain: 'PRD开发', description: '修一下 PRD 导出' })).toBe(true)
    expect(isAgentRelevant({ description: '看一下 TRD 接口' })).toBe(true)
    expect(isAgentRelevant({ skills: ['dev-avatar'], description: '任意' })).toBe(true)
  })

  it('无关任务不命中', () => {
    expect(isAgentRelevant({ domain: '差旅出行', description: '帮我订下周三去上海的高铁' })).toBe(false)
    expect(isAgentRelevant({ description: '整理一下财务报销单' })).toBe(false)
    expect(isAgentRelevant({})).toBe(false)
  })

  it('停用后一律不命中', () => {
    saveAgentProfile(DEFAULT_AGENT_NAME, { enabled: false })
    expect(isAgentRelevant({ description: '修一下 PRD 导出' })).toBe(false)
    resetAgentProfile(DEFAULT_AGENT_NAME)
  })

  it('拒绝非法 agent 名称', () => {
    expect(isValidAgentName('dev-avatar')).toBe(true)
    expect(isValidAgentName('../evil')).toBe(false)
    expect(() => getAgentProfileState('../evil')).toThrow()
  })
})
