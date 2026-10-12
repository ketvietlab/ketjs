// A bounded, dependency-free password primitive for application-owned identity modules.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const N = 32768
const R = 8
const P = 3
const MAX_PASSWORD_BYTES = 1024

const derive = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })

const validPassword = (password: string): boolean =>
  typeof password === 'string' &&
  password.length > 0 &&
  Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES

/** Encodes scrypt parameters, a random salt and the derived key. Passwords are not normalized. */
export async function hashPassword(password: string): Promise<string> {
  if (!validPassword(password)) throw new RangeError('password must contain 1–1024 UTF-8 bytes')
  const salt = randomBytes(16)
  const key = await derive(password, salt)
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

/** Rejects malformed hashes before allocating memory. Null pays the work cost and always returns false. */
export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  if (!validPassword(password)) return false
  if (encoded === null) {
    await derive(password, Buffer.alloc(16))
    return false
  }
  if (typeof encoded !== 'string') return false
  const match = /^scrypt\$32768\$8\$3\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(encoded)
  if (!match) return false
  const salt = Buffer.from(match[1]!, 'base64url')
  const expected = Buffer.from(match[2]!, 'base64url')
  if (salt.toString('base64url') !== match[1] || expected.toString('base64url') !== match[2]) return false
  const actual = await derive(password, salt)
  return timingSafeEqual(expected, actual)
}
