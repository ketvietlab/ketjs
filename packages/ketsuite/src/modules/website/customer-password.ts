import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'

const PARAMS = { N: 2 ** 15, r: 8, p: 1, keyLength: 64 }
const LIMITS = { minN: 2 ** 14, maxN: 2 ** 17, maxR: 16, maxP: 4, saltLength: 16, keyLength: 64 }

const scrypt = (
  password: string,
  salt: Buffer,
  N: number,
  r: number,
  p: number,
  keyLength: number,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, { N, r, p, maxmem: 256 * N * r }, (error, key) => {
      if (error) reject(error)
      else resolve(key as Buffer)
    })
  })

export const hashCustomerPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(LIMITS.saltLength)
  const key = await scrypt(password, salt, PARAMS.N, PARAMS.r, PARAMS.p, PARAMS.keyLength)
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$')
}

export const verifyCustomerPassword = async (password: string, encoded: string): Promise<boolean> => {
  const parts = encoded.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, encodedN, encodedR, encodedP, encodedSalt, encodedHash] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ]
  const N = Number(encodedN)
  const r = Number(encodedR)
  const p = Number(encodedP)
  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    N < LIMITS.minN ||
    N > LIMITS.maxN ||
    (N & (N - 1)) !== 0 ||
    r < 1 ||
    r > LIMITS.maxR ||
    p < 1 ||
    p > LIMITS.maxP
  )
    return false
  try {
    const salt = Buffer.from(encodedSalt, 'base64url')
    const expected = Buffer.from(encodedHash, 'base64url')
    if (salt.length !== LIMITS.saltLength || expected.length !== LIMITS.keyLength) return false
    const actual = await scrypt(password, salt, N, r, p, expected.length)
    return timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

// A syntactically valid hash makes an unknown email pay the same scrypt cost as
// a wrong password without granting any real account a known credential.
export const CUSTOMER_DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
