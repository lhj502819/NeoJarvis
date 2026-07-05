import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const PROJECT_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const DATA_DIR = join(PROJECT_ROOT, 'data')

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
