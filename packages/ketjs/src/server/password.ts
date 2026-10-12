// A bounded, dependency-free password primitive for application-owned identity modules.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const MAX_PASSWORD_BYTES = 1024

type WorkFactor = { N: number; r: number; p: number; maxmem: number }
// Keep accepted older profiles when the hashing default changes; never accept arbitrary costs.
const allowed = new Map<string, WorkFactor>([
  ['32768$8$3', { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }],
  ['65536$8$2', { N: 65536, r: 8, p: 2, maxmem: 96 * 1024 * 1024 }],
  ['131072$8$1', { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 }],
])
const current = allowed.get('32768$8$3') as WorkFactor

const derive = (password: string, salt: Buffer, profile: WorkFactor = current): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, 32, profile, (error, key) => {
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
  return `scrypt$${current.N}$${current.r}$${current.p}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

/** Rejects malformed hashes before allocating memory. Null pays the work cost and always returns false. */
export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  if (!validPassword(password)) return false
  if (encoded === null) {
    await derive(password, Buffer.alloc(16))
    return false
  }
  if (typeof encoded !== 'string') return false
  const match =
    /^scrypt\$([1-9][0-9]{0,5})\$([1-9][0-9]?)\$([1-9][0-9]?)\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(
      encoded,
    )
  if (!match) return false
  const profile = allowed.get(`${match[1]}$${match[2]}$${match[3]}`)
  if (!profile) return false
  const salt = Buffer.from(match[4]!, 'base64url')
  const expected = Buffer.from(match[5]!, 'base64url')
  if (salt.toString('base64url') !== match[4] || expected.toString('base64url') !== match[5]) return false
  const actual = await derive(password, salt, profile)
  return timingSafeEqual(expected, actual)
}
