import { describe, it, expect } from 'vitest'
import { dominantCwd, type DomainCluster } from '../../agent/team/promoter.js'
import type { AgentSession } from '../../agent/a2a/history.js'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    sessionId: `s-${Math.random().toString(36).slice(2, 8)}`,
    recipeId: 'adhoc',
    domain: '技术调研',
    cwd: '',
    topics: ['topic1'],
    lastTaskDescription: '测试任务',
    completedAt: new Date().toISOString(),
    taskCount: 1,
    ...overrides,
  }
}

describe('dominantCwd', () => {
  it('returns the most frequent cwd', () => {
    const cluster: DomainCluster = {
      sessions: [
        makeSession({ cwd: '/a', taskCount: 2 }),
        makeSession({ cwd: '/b', taskCount: 1 }),
        makeSession({ cwd: '/a', taskCount: 3 }),
      ],
      taskCount: 6,
      topics: [],
    }
    expect(dominantCwd(cluster)).toBe('/a')
  })

  it('returns empty string when no cwd in sessions', () => {
    const cluster: DomainCluster = {
      sessions: [
        makeSession({ cwd: '', taskCount: 2 }),
        makeSession({ cwd: '', taskCount: 1 }),
      ],
      taskCount: 3,
      topics: [],
    }
    expect(dominantCwd(cluster)).toBe('')
  })

  it('picks higher count when tied on frequency', () => {
    const cluster: DomainCluster = {
      sessions: [
        makeSession({ cwd: '/a', taskCount: 5 }),
        makeSession({ cwd: '/b', taskCount: 3 }),
      ],
      taskCount: 8,
      topics: [],
    }
    expect(dominantCwd(cluster)).toBe('/a')
  })
})
