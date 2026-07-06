import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const SECRET = process.env.SETTINGS_SECRET || 'jarvis-dev-settings-secret-change-in-prod'
if (!process.env.SETTINGS_SECRET) {
  console.warn('\x1b[33m[crypto] SETTINGS_SECRET 未设置，使用开发默认值。生产环境必须设置！\x1b[0m')
}

// scrypt 派生 32 字节密钥（AES-256）。salt 固定是可接受的：主密钥本身是高熵秘密，
// 且我们要的是确定性密钥派生，不是密码哈希。
const KEY = scryptSync(SECRET, 'jarvis-settings-salt', 32)
const ALGO = 'aes-256-gcm'

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, KEY, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`
}

export function decrypt(payload: string): string {
  const parts = payload.split(':')
  if (parts.length !== 3) throw new Error('密文格式非法')
  const [ivHex, tagHex, dataHex] = parts
  const decipher = createDecipheriv(ALGO, KEY, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
}
