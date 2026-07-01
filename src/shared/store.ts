import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const DATA_DIR = join(process.cwd(), 'data')

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
}

export function loadJson<T>(filename: string, fallback: T): T {
  ensureDataDir()
  const filepath = join(DATA_DIR, filename)
  if (!existsSync(filepath)) return fallback
  return JSON.parse(readFileSync(filepath, 'utf-8'))
}

export function saveJson(filename: string, data: unknown) {
  ensureDataDir()
  const filepath = join(DATA_DIR, filename)
  writeFileSync(filepath, JSON.stringify(data, null, 2))
}
