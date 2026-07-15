import { describe, it, expect } from 'vitest'
import { clusterByDomain, dominantCwd, type DomainCluster } from '../../agent/team/promoter.js'
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

describe('clusterByDomain', () => {
  it('groups sessions by domain', () => {
    const sessions = [
      makeSession({ domain: '技术调研', taskCount: 1 }),
      makeSession({ domain: '技术调研', taskCount: 2 }),
      makeSession({ domain: 'jarvis开发', taskCount: 1 }),
    ]
    const clusters = clusterByDomain(sessions)
    expect(clusters.size).toBe(2)
    expect(clusters.get('技术调研')?.taskCount).toBe(3)
    expect(clusters.get('jarvis开发')?.taskCount).toBe(1)
  })

  it('skips sessions with empty domain', () => {
    const sessions = [
      makeSession({ domain: '', taskCount: 1 }),
      makeSession({ domain: '技术调研', taskCount: 1 }),
    ]
    const clusters = clusterByDomain(sessions)
    expect(clusters.size).toBe(1)
    expect(clusters.has('')).toBe(false)
  })

  it('accumulates topics with dedup', () => {
    const sessions = [
      makeSession({ domain: 'X', topics: ['a', 'b'] }),
      makeSession({ domain: 'X', topics: ['b', 'c'] }),
    ]
    const clusters = clusterByDomain(sessions)
    expect(clusters.get('X')?.topics).toEqual(['a', 'b', 'c'])
  })

  it('caps topics at 20', () => {
    const sessions = Array.from({ length: 25 }, (_, i) =>
      makeSession({ domain: 'X', topics: [`topic-${i}`] })
    )
    const clusters = clusterByDomain(sessions)
    expect(clusters.get('X')!.topics.length).toBeLessThanOrEqual(20)
  })
})

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
