// Sessions: the cookie, the secret, and the runtime that ties them to a store.
//
// This is the seam every earlier decision pointed at. `resolveScope` has been one
// function since D27 precisely so that replacing headers with a session would be
// one change — and D32 settled the shape a session has to produce: a set of
// companies to read and one to write.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { KetError } from '../kernel/errors.ts'
import { memorySessionStore } from './sessionstore.ts'
import type { SessionRecord, SessionStore } from './sessionstore.ts'
import type { Scope } from '../types.ts'
import type { IncomingMessage } from 'node:http'

export const SESSION_COOKIE = 'ket_session'

export type SessionOptions = {
  store?: SessionStore
  /**
   * Signing key. It MUST be the same on every pod: a cookie signed by one and
   * rejected by another is a login that works only until the load balancer sends
   * you elsewhere. Absent, one is generated and the fact is said out loud.
   */
  secret?: string
  /** How long an idle session lives. Refreshed while it is being used. */
  idleTtlMs?: number
  /** How long any session may live, however active. Not refreshable. */
  absoluteTtlMs?: number
  /** Sent on the cookie unless the request came in over plain HTTP to localhost. */
  secure?: boolean
  /** The scope a request with no session gets — a public storefront still needs one. */
  anonymous?: Scope | null
  now?: () => number
}

const DEFAULTS = { idleTtlMs: 7 * 24 * 60 * 60_000, absoluteTtlMs: 30 * 24 * 60 * 60_000 }

/** `id.signature`, base64url. The signature is what makes a forged id cheap to reject. */
const sign = (id: string, secret: string): string =>
  `${id}.${createHmac('sha256', secret).update(id).digest('base64url')}`

const unsign = (value: string, secret: string): string | null => {
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return null
  const id = value.slice(0, dot)
  const given = Buffer.from(value.slice(dot + 1), 'base64url')
  const want = createHmac('sha256', secret).update(id).digest()
  // Length first: timingSafeEqual throws on a mismatch, and a throw here would be
  // a louder signal than the comparison it is meant to hide.
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null
  return id
}

/** Cookies as sent by a browser: `a=1; b=2`. Values are not decoded further. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at <= 0) continue
    out[part.slice(0, at).trim()] = part.slice(at + 1).trim()
  }
  return out
}

export type Sessions = {
  readonly store: SessionStore
  /** True when the secret was generated rather than configured — see the banner. */
  readonly ephemeralSecret: boolean
  start(o: { userId: string; companies: string[]; company?: string | null; branches?: string[] | null }): Promise<{ record: SessionRecord; cookie: string }>
  /** The session a request carries, refreshed if it is still alive. */
  of(req: IncomingMessage): Promise<SessionRecord | null>
  end(req: IncomingMessage): Promise<void>
  endUser(userId: string): Promise<number>
  /** A cookie that clears the browser's. */
  clearCookie(): string
  scopeOf(record: SessionRecord | null): Scope | null
  sweep(): Promise<number>
}

export async function createSessions(o: SessionOptions = {}): Promise<Sessions> {
  const now = o.now ?? (() => Date.now())
  const store = o.store ?? memorySessionStore({ now })
  await store.init()

  const ephemeralSecret = !o.secret
  const secret = o.secret ?? randomBytes(32).toString('base64url')
  const idleTtl = o.idleTtlMs ?? DEFAULTS.idleTtlMs
  const absoluteTtl = o.absoluteTtlMs ?? DEFAULTS.absoluteTtlMs

  const cookie = (value: string, maxAgeSec: number): string =>
    [
      `${SESSION_COOKIE}=${value}`,
      'Path=/',
      'HttpOnly',
      // Lax rather than Strict: Strict drops the cookie on any inbound link, so a
      // user following one from email arrives logged out for no security gain here.
      'SameSite=Lax',
      ...(o.secure === false ? [] : ['Secure']),
      `Max-Age=${maxAgeSec}`,
    ].join('; ')

  const idOf = (req: IncomingMessage): string | null => {
    const raw = parseCookies(req.headers.cookie as string | undefined)[SESSION_COOKIE]
    return raw ? unsign(raw, secret) : null
  }

  return {
    store,
    ephemeralSecret,

    async start({ userId, companies, company, branches }) {
      if (!companies.length) {
        throw new KetError({
          code: 'E_SESSION_NO_COMPANY',
          message: `cannot start a session for "${userId}" with no company`,
          hint: 'grant the user at least one company first — a session that can read nothing is not a session',
        })
      }
      const active = company ?? companies[0] as string
      if (!companies.includes(active)) {
        throw new KetError({
          code: 'E_WRITE_COMPANY_NOT_READABLE',
          message: `session for "${userId}" would write to "${active}" but may only read ${companies.join(', ')}`,
          hint: 'the active company must be one the user is a member of',
        })
      }
      const at = now()
      const record: SessionRecord = {
        id: randomBytes(32).toString('base64url'),
        userId,
        companies: [...companies],
        company: active,
        branches: branches ?? null,
        createdAt: at,
        expiresAt: at + idleTtl,
      }
      await store.create(record)
      return { record, cookie: cookie(sign(record.id, secret), Math.floor(idleTtl / 1000)) }
    },

    async of(req) {
      const id = idOf(req)
      if (!id) return null
      const record = await store.read(id)
      if (!record) return null
      const at = now()
      // Refreshed while in use, but never past the absolute limit: a session that
      // renews forever is a session that never ends.
      const ceiling = record.createdAt + absoluteTtl
      if (at >= ceiling) { await store.destroy(id); return null }
      const next = Math.min(at + idleTtl, ceiling)
      if (next > record.expiresAt) {
        if ((await store.touch(id, next)) === null) return null
        record.expiresAt = next
      }
      return record
    },

    async end(req) {
      const id = idOf(req)
      if (id) await store.destroy(id)
    },

    endUser(userId) { return store.destroyUser(userId) },

    clearCookie() { return cookie('', 0) },

    scopeOf(record) {
      if (!record) return o.anonymous ?? null
      return { company: record.company, companies: record.companies, branches: record.branches }
    },

    sweep() { return store.sweep(now()) },
  }
}

export { memorySessionStore, dbSessionStore } from './sessionstore.ts'
export type { SessionStore, SessionRecord } from './sessionstore.ts'
