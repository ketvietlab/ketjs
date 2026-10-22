import { BlockList, isIP } from 'node:net'
import type { IncomingMessage } from 'node:http'

/** Compare hosts because TLS may terminate before the framework's HTTP listener. */
export function isSameOriginRequest(
  url: URL,
  req: IncomingMessage,
  options: { allowMissingOrigin?: boolean } = {},
): boolean {
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      const supplied = new URL(origin)
      return (supplied.protocol === 'http:' || supplied.protocol === 'https:') && supplied.host === url.host
    } catch {
      return false
    }
  }
  return (
    req.headers['sec-fetch-site'] === 'same-origin' ||
    (options.allowMissingOrigin === true && req.headers['sec-fetch-site'] === undefined)
  )
}

/** Whether a Content-Type header names JSON, which a cross-site form or simple request cannot send. */
export const isJsonType = (header: unknown): boolean => {
  const media = String(header ?? '')
    .split(';')[0]!
    .trim()
    .toLowerCase()
  return media === 'application/json' || (media.startsWith('application/') && media.endsWith('+json'))
}

const normalizedIp = (value: string): string =>
  value.toLowerCase().startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value

/** Trust X-Forwarded-For only through explicitly listed proxy IPs, walking from the socket inward. */
export function createClientAddressResolver(
  options: { trustedProxies?: readonly string[] } = {},
): (req: IncomingMessage) => string {
  const trusted = new BlockList()
  for (const address of options.trustedProxies ?? []) {
    const normalized = normalizedIp(address)
    const family = isIP(normalized)
    if (!family) throw new RangeError(`trusted proxy must be an IP address: ${address}`)
    trusted.addAddress(normalized, family === 6 ? 'ipv6' : 'ipv4')
  }
  const isTrusted = (address: string): boolean => {
    const family = isIP(address)
    return Boolean(family && trusted.check(address, family === 6 ? 'ipv6' : 'ipv4'))
  }
  return (req) => {
    const peer = normalizedIp(req.socket.remoteAddress ?? 'unknown')
    if (!isTrusted(peer)) return peer
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded !== 'string' || forwarded.length > 2048) return peer
    const chain = forwarded.split(',').map((address) => normalizedIp(address.trim()))
    if (!chain.length || chain.length > 32 || chain.some((address) => !isIP(address))) return peer
    let current = peer
    for (let index = chain.length - 1; index >= 0 && isTrusted(current); index--) {
      current = chain[index] as string
    }
    return current
  }
}
