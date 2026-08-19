// Password hashing, with no dependency.
//
// node:crypto ships scrypt, which is memory-hard — the property that makes a GPU
// farm no cheaper per guess than the machine that set the password. So the one
// exception the framework grants for a database driver is not needed here.
//
// The encoded form carries its own parameters. A hash that does not say how it was
// made cannot be rehashed later without a migration that reads every row, and
// parameters that never move are parameters that fall behind the hardware.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'

/** N=2^15 costs ~160ms here. Interactive, and expensive per guess. */
const PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 64 }
/** Node's default cap is 32MB, which 2^15 exceeds — so it is passed, not assumed. */
const maxmem = 256 * PARAMS.N * PARAMS.r

const scrypt = (
  password: string,
  salt: Buffer,
  N: number,
  r: number,
  p: number,
  keylen: number,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, keylen, { N, r, p, maxmem: 256 * N * r }, (err, key) => {
      if (err) reject(err)
      else resolve(key as Buffer)
    })
  })

/** `scrypt$N$r$p$salt$hash`, base64url so it survives any transport unescaped. */
export async function hashPassword(password: string): Promise<string> {
  const { N, r, p, keylen } = PARAMS
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, N, r, p, keylen)
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$')
}

/**
 * Constant-time where it matters. A wrong password and an unparseable record both
 * return false rather than throwing: a caller that can tell those apart can tell
 * whether an account exists.
 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, sN, sr, sp, salt64, hash64] = parts as [string, string, string, string, string, string]
  const N = Number(sN),
    r = Number(sr),
    p = Number(sp)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  let expected: Buffer
  try {
    expected = Buffer.from(hash64, 'base64url')
    const got = await scrypt(password, Buffer.from(salt64, 'base64url'), N, r, p, expected.length)
    return expected.length === got.length && timingSafeEqual(expected, got)
  } catch {
    return false
  }
}

/** True when a stored hash was made with parameters we have since moved past. */
export function needsRehash(encoded: string): boolean {
  const parts = encoded.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true
  return Number(parts[1]) < PARAMS.N
}

void maxmem
