import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Password hashing — thin wrappers over Bun's built-in bcrypt. Zero deps.
 */
export const hashPassword = (password: string): Promise<string> =>
  Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 })

export const verifyPassword = (password: string, hash: string): Promise<boolean> =>
  Bun.password.verify(password, hash)

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const normalizeRecoveryCode = (code: string): string =>
  code.toUpperCase().replace(/[^A-Z0-9]/g, '')

export const randomRecoveryCode = (): string => {
  const bytes = randomBytes(12)
  const chars = Array.from(bytes, (byte) => RECOVERY_CODE_ALPHABET[byte % RECOVERY_CODE_ALPHABET.length]!)
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`
}

export const hashRecoveryCode = (code: string): Promise<string> =>
  Bun.password.hash(normalizeRecoveryCode(code), { algorithm: 'bcrypt', cost: 10 })

export const verifyRecoveryCode = (code: string, hash: string): Promise<boolean> => {
  const normalized = normalizeRecoveryCode(code)
  if (!/^[A-Z0-9]{8,32}$/.test(normalized)) return Promise.resolve(false)
  return Bun.password.verify(normalized, hash)
}

export const randomBase32Secret = (bytes = 20): string => {
  const input = randomBytes(bytes)
  let bits = ''
  let out = ''
  for (const byte of input) bits += byte.toString(2).padStart(8, '0')
  for (let index = 0; index + 5 <= bits.length; index += 5) {
    out += BASE32_ALPHABET[Number.parseInt(bits.slice(index, index + 5), 2)]
  }
  return out
}

const base32Bytes = (secret: string): Buffer => {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = ''
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char)
    if (value >= 0) bits += value.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2))
  }
  return Buffer.from(bytes)
}

export const totpCode = (secret: string, now = Date.now(), stepSeconds = 30): string => {
  const counter = Math.floor(now / 1000 / stepSeconds)
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', base32Bytes(secret)).update(msg).digest()
  const offset = digest[digest.length - 1]! & 0xf
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

export const verifyTotpCode = (
  secret: string,
  code: string,
  now = Date.now(),
  windowSteps = 1,
): boolean => {
  const clean = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(clean)) return false
  const candidate = Buffer.from(clean)
  for (let step = -windowSteps; step <= windowSteps; step += 1) {
    const expected = Buffer.from(totpCode(secret, now + step * 30_000))
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return true
  }
  return false
}

export const otpauthUrl = (issuer: string, account: string, secret: string): string => {
  const label = `${issuer}:${account}`
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  })
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`
}
