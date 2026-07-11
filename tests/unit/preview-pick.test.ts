import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildPreviewFromFiles } from '../../src/jarvis/action-dispatcher.js'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('buildPreviewFromFiles', () => {
  let dir: string
  const p = (name: string) => join(dir, name)

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'preview-pick-'))
    writeFileSync(p('page.html'), '<h1>hi</h1>')
    writeFileSync(p('page2.html'), '<h1>final</h1>')
    writeFileSync(p('doc.md'), '# doc')
    writeFileSync(p('diagram.mmd'), 'graph TD; A-->B')
    writeFileSync(p('script.ts'), 'const x = 1')
    writeFileSync(p('empty.html'), '   ')
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('无文件返回 null', () => {
    expect(buildPreviewFromFiles([])).toBeNull()
  })

  it('只有非成品(.ts)返回 null', () => {
    expect(buildPreviewFromFiles([p('script.ts')])).toBeNull()
  })

  it('html 优先于 markdown/mermaid', () => {
    const a = buildPreviewFromFiles([p('diagram.mmd'), p('doc.md'), p('page.html')])
    expect(a?.type).toBe('html')
    expect(a?.title).toBe('page.html')
  })

  it('同为 html 取最后写的', () => {
    const a = buildPreviewFromFiles([p('page.html'), p('page2.html')])
    expect(a?.title).toBe('page2.html')
    expect(a?.content).toContain('final')
  })

  it('无 html 时退到 markdown', () => {
    const a = buildPreviewFromFiles([p('script.ts'), p('doc.md'), p('diagram.mmd')])
    expect(a?.type).toBe('markdown')
    expect(a?.title).toBe('doc.md')
  })

  it('空内容文件跳过', () => {
    expect(buildPreviewFromFiles([p('empty.html')])).toBeNull()
  })

  it('不存在的路径不抛,返回 null', () => {
    expect(buildPreviewFromFiles([p('nope.html')])).toBeNull()
  })
})
