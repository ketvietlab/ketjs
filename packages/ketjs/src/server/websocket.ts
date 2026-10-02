// WebSocket (RFC 6455), server side, for a route that asks for one.
//
// A route opts in by returning `websocket({...})` instead of a response. The
// route runs exactly as it would for a request — the module's sign-in check, the
// rate limit and the handler's own authentication all see the upgrade request —
// and only a route that answers with a session is upgraded. Anything else it
// returns is written back as a plain HTTP answer and the connection is closed,
// so "no" to an upgrade is the same 401/403/404 it would be to a fetch.
//
// Hand-rolled because the framework has no runtime dependencies, and the part of
// the protocol a server needs is small: the handshake, unmasking, fragmentation,
// ping/pong and the closing handshake. No extensions are negotiated — in
// particular not permessage-deflate, whose memory cost per connection is the
// thing a server holding many idle sockets can least afford.

import { createHash } from 'node:crypto'
import { STATUS_CODES, type IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const CLOSE_TIMEOUT_MS = 5_000

export type WebSocketMessage = string | Uint8Array

/** One accepted connection, as its route sees it. */
export type WebSocketPeer = {
  /** The subprotocol both sides agreed on, or null when the route declared none. */
  readonly protocol: string | null
  /** Whether messages can still be sent: false once either side started closing. */
  readonly open: boolean
  /**
   * Queue a message. False when the connection is no longer open, or when the
   * peer has stopped reading and `maxBufferedBytes` is exceeded — the connection
   * is then dropped with 1013, because a hint delivered minutes late is worse
   * than a reconnect that re-reads current state.
   */
  send(message: WebSocketMessage): boolean
  /** Start the closing handshake. The socket is destroyed if the peer never answers. */
  close(code?: number, reason?: string): void
}

export type WebSocketSession = {
  /**
   * Subprotocols this route speaks, preferred first. A client offering none of
   * them is refused with 400 before anything is upgraded. Omitted, the route
   * speaks no named protocol and a client that requires one fails its own check.
   */
  protocols?: readonly string[]
  /** Largest message accepted, after reassembly. Default 64 KiB; larger closes with 1009. */
  maxMessageBytes?: number
  /** Outgoing bytes allowed to queue for a peer that is not reading. Default 1 MiB. */
  maxBufferedBytes?: number
  /**
   * How often the server pings. A peer that sends nothing at all — not even the
   * pong — for a whole interval is dropped. Default 25 s, under the 60 s idle
   * timeout of common proxies; 0 disables.
   */
  pingIntervalMs?: number
  /** Extra headers on the 101 response. */
  headers?: Record<string, string>
  open?(peer: WebSocketPeer): void | Promise<void>
  message?(peer: WebSocketPeer, message: WebSocketMessage): void | Promise<void>
  /** Called once, however the connection ended. 1006 means no close frame was received. */
  close?(peer: WebSocketPeer, code: number, reason: string): void
}

/** What the HTTP layer needs to hear about a connection's life, for its log. */
export type WebSocketObserver = {
  opened?(): void
  closed?(code: number, durationMs: number): void
  failed?(error: unknown): void
}

const headerList = (value: string | string[] | undefined): string[] =>
  (Array.isArray(value) ? value.join(',') : (value ?? ''))
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

/** Whether a request asks to become a WebSocket — the question `shouldUpgradeCallback` asks. */
export const isWebSocketUpgrade = (req: Pick<IncomingMessage, 'headers'>): boolean =>
  headerList(req.headers.upgrade).some((token) => token.toLowerCase() === 'websocket')

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const safeHeaders = (headers: Record<string, string> | undefined): string => {
  let out = ''
  for (const [name, value] of Object.entries(headers ?? {})) {
    // A header a route built from input must not be able to end the response.
    if (!TOKEN.test(name) || /[\r\n\0]/.test(value)) throw new TypeError(`invalid response header "${name}"`)
    out += `${name}: ${value}\r\n`
  }
  return out
}

/**
 * An HTTP answer on a socket the HTTP parser has already let go of.
 *
 * The connection is closed afterwards: an upgrade request that was refused has
 * no reason to stay, and keeping it would mean parsing HTTP by hand.
 */
export function rejectUpgrade(
  socket: Duplex,
  status: number,
  headers: Record<string, string> = {},
  body: string | Uint8Array = '',
): void {
  if (socket.destroyed) return
  const bytes = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body)
  let head: string
  try {
    head =
      `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? 'Unknown'}\r\n` +
      safeHeaders({ 'content-type': 'text/plain; charset=utf-8', ...headers }) +
      `content-length: ${bytes.length}\r\nconnection: close\r\n\r\n`
  } catch {
    head = 'HTTP/1.1 500 Internal Server Error\r\ncontent-length: 0\r\nconnection: close\r\n\r\n'
    socket.end(head)
    return
  }
  socket.end(Buffer.concat([Buffer.from(head, 'latin1'), bytes]))
}

const validCloseCode = (code: number): boolean =>
  (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1011) || (code >= 3000 && code <= 4999)

const frame = (opcode: number, payload: Buffer): Buffer => {
  const length = payload.length
  const header = length < 126 ? Buffer.alloc(2) : length < 65_536 ? Buffer.alloc(4) : Buffer.alloc(10)
  header[0] = 0x80 | opcode
  if (length < 126) header[1] = length
  else if (length < 65_536) {
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header[1] = 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  return Buffer.concat([header, payload])
}

const closePayload = (code: number, reason: string): Buffer => {
  // A close frame is a control frame: 125 bytes, two of them the code.
  let text = Buffer.from(reason)
  if (text.length > 123)
    text = Buffer.from(new TextDecoder().decode(text.subarray(0, 123)).replace(/�+$/u, ''))
  const payload = Buffer.alloc(2 + text.length)
  payload.writeUInt16BE(code, 0)
  text.copy(payload, 2)
  return payload
}

class ProtocolError extends Error {
  readonly code: number
  constructor(code: number) {
    super(`websocket protocol error ${code}`)
    this.code = code
  }
}

/**
 * Complete the handshake and run the connection.
 *
 * Returns null when the request cannot be upgraded; the socket has then been
 * answered with the reason and closed.
 */
export function acceptWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  session: WebSocketSession,
  observer: WebSocketObserver = {},
): WebSocketPeer | null {
  if (req.method !== 'GET') {
    rejectUpgrade(socket, 405, { allow: 'GET' }, 'a websocket is opened with GET')
    return null
  }
  if (!headerList(req.headers.connection).some((token) => token.toLowerCase() === 'upgrade')) {
    rejectUpgrade(socket, 400, {}, 'connection: upgrade is required')
    return null
  }
  if (req.headers['sec-websocket-version'] !== '13') {
    rejectUpgrade(socket, 426, { 'sec-websocket-version': '13' }, 'websocket version 13 is required')
    return null
  }
  const key = String(req.headers['sec-websocket-key'] ?? '')
  if (!/^[A-Za-z0-9+/]{22}==$/.test(key)) {
    rejectUpgrade(socket, 400, {}, 'sec-websocket-key is invalid')
    return null
  }
  let protocol: string | null = null
  if (session.protocols?.length) {
    const offered = new Set(headerList(req.headers['sec-websocket-protocol']))
    protocol = session.protocols.find((candidate) => offered.has(candidate)) ?? null
    if (protocol === null) {
      rejectUpgrade(socket, 400, {}, `supported subprotocols: ${session.protocols.join(', ')}`)
      return null
    }
  }

  const maxMessageBytes = session.maxMessageBytes ?? 64 * 1024
  const maxBufferedBytes = session.maxBufferedBytes ?? 1024 * 1024
  const pingIntervalMs = session.pingIntervalMs ?? 25_000
  let extra: string
  try {
    extra = safeHeaders(session.headers)
  } catch (error) {
    observer.failed?.(error)
    rejectUpgrade(socket, 500, {}, 'internal error')
    return null
  }

  const accept = createHash('sha1')
    .update(key + GUID)
    .digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n' +
      `sec-websocket-accept: ${accept}\r\n` +
      (protocol ? `sec-websocket-protocol: ${protocol}\r\n` : '') +
      extra +
      '\r\n',
  )
  const started = Date.now()
  const net = socket as Duplex & { setNoDelay?(on: boolean): void; setTimeout?(ms: number): void }
  net.setNoDelay?.(true)
  net.setTimeout?.(0)

  let state: 'open' | 'closing' | 'closed' = 'open'
  let received: { code: number; reason: string } | null = null
  let localCode: number | null = null
  let pending: Buffer = Buffer.alloc(0)
  let fragments: Buffer[] | null = null
  let fragmentOpcode = 0
  let fragmentBytes = 0
  let alive = true
  let closeTimer: NodeJS.Timeout | null = null
  const decoder = new TextDecoder('utf-8', { fatal: true })

  const write = (bytes: Buffer): void => {
    if (!socket.destroyed && socket.writable) socket.write(bytes)
  }
  const terminate = (code: number): void => {
    localCode ??= code
    state = 'closed'
    socket.destroy()
  }
  const startClose = (code: number, reason: string): void => {
    if (state !== 'open') return
    state = 'closing'
    localCode = code
    write(frame(0x8, closePayload(code, reason)))
    closeTimer = setTimeout(() => socket.destroy(), CLOSE_TIMEOUT_MS)
    closeTimer.unref?.()
  }
  const fail = (error: unknown): void => {
    if (!(error instanceof ProtocolError)) observer.failed?.(error)
    const code = error instanceof ProtocolError ? error.code : 1011
    if (state === 'open') startClose(code, '')
    // Nothing more from this peer is worth reading.
    socket.pause()
  }
  const run = (value: void | Promise<void> | undefined): void => {
    if (value && typeof (value as Promise<void>).then === 'function') (value as Promise<void>).catch(fail)
  }

  const peer: WebSocketPeer = {
    protocol,
    get open() {
      return state === 'open'
    },
    send(message) {
      if (state !== 'open') return false
      if (((socket as Duplex & { writableLength?: number }).writableLength ?? 0) > maxBufferedBytes) {
        terminate(1013)
        return false
      }
      write(typeof message === 'string' ? frame(0x1, Buffer.from(message)) : frame(0x2, Buffer.from(message)))
      return true
    },
    close(code = 1000, reason = '') {
      if (!validCloseCode(code)) throw new RangeError(`close code ${code} cannot be sent`)
      startClose(code, reason)
    },
  }

  const deliver = (opcode: number, payload: Buffer): void => {
    if (!session.message) return
    let message: WebSocketMessage
    if (opcode === 0x1) {
      try {
        message = decoder.decode(payload)
      } catch {
        throw new ProtocolError(1007)
      }
    } else message = new Uint8Array(payload.buffer, payload.byteOffset, payload.length)
    run(session.message(peer, message))
  }

  const handle = (fin: boolean, opcode: number, payload: Buffer): void => {
    switch (opcode) {
      case 0x0: {
        if (!fragments) throw new ProtocolError(1002)
        fragments.push(payload)
        if (fin) {
          const whole = Buffer.concat(fragments)
          fragments = null
          fragmentBytes = 0
          deliver(fragmentOpcode, whole)
        }
        return
      }
      case 0x1:
      case 0x2: {
        if (fragments) throw new ProtocolError(1002)
        if (fin) {
          deliver(opcode, payload)
          return
        }
        fragments = [payload]
        fragmentOpcode = opcode
        return
      }
      case 0x8: {
        let code = 1005
        let reason = ''
        if (payload.length === 1) throw new ProtocolError(1002)
        if (payload.length >= 2) {
          code = payload.readUInt16BE(0)
          if (!validCloseCode(code)) throw new ProtocolError(1002)
          try {
            reason = decoder.decode(payload.subarray(2))
          } catch {
            throw new ProtocolError(1007)
          }
        }
        received = { code, reason }
        if (state === 'open') {
          // Echo the code, as the closing handshake asks; 1005 is never sent.
          state = 'closing'
          write(frame(0x8, code === 1005 ? Buffer.alloc(0) : closePayload(code, '')))
        }
        socket.end()
        return
      }
      case 0x9:
        if (state === 'open') write(frame(0xa, payload))
        return
      case 0xa:
        return
      default:
        throw new ProtocolError(1002)
    }
  }

  const parse = (): void => {
    while (state !== 'closed' && pending.length >= 2) {
      const b0 = pending[0] as number
      const b1 = pending[1] as number
      const fin = (b0 & 0x80) !== 0
      const opcode = b0 & 0x0f
      if (b0 & 0x70) throw new ProtocolError(1002) // no extension was negotiated
      if (!(b1 & 0x80)) throw new ProtocolError(1002) // a client always masks
      let length = b1 & 0x7f
      let offset = 2
      if (length === 126) {
        if (pending.length < 4) return
        length = pending.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (pending.length < 10) return
        const declared = pending.readBigUInt64BE(2)
        if (declared > BigInt(maxMessageBytes)) throw new ProtocolError(1009)
        length = Number(declared)
        offset = 10
      }
      const control = (opcode & 0x08) !== 0
      if (control && (!fin || length > 125)) throw new ProtocolError(1002)
      // Refused on the declared length, before the bytes arrive: waiting for a
      // message too large to accept is how a peer makes the server buffer it.
      if (!control && fragmentBytes + length > maxMessageBytes) throw new ProtocolError(1009)
      if (pending.length < offset + 4 + length) return
      const mask = pending.subarray(offset, offset + 4)
      const payload = Buffer.from(pending.subarray(offset + 4, offset + 4 + length))
      for (let i = 0; i < payload.length; i++) payload[i] = (payload[i] as number) ^ (mask[i & 3] as number)
      pending = pending.subarray(offset + 4 + length)
      if (!control) fragmentBytes += length
      handle(fin, opcode, payload)
    }
  }

  const onData = (chunk: Buffer): void => {
    alive = true
    if (state === 'closed') return
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
    try {
      parse()
    } catch (error) {
      fail(error)
    }
  }

  const heartbeat =
    pingIntervalMs > 0
      ? setInterval(() => {
          if (!alive) return terminate(1006)
          alive = false
          if (state === 'open') write(frame(0x9, Buffer.alloc(0)))
        }, pingIntervalMs)
      : null
  heartbeat?.unref?.()

  let finished = false
  socket.on('data', onData)
  socket.on('end', () => {
    if (!socket.destroyed) socket.end()
  })
  socket.on('error', () => {})
  socket.on('close', () => {
    if (finished) return
    finished = true
    state = 'closed'
    if (heartbeat) clearInterval(heartbeat)
    if (closeTimer) clearTimeout(closeTimer)
    const code = received?.code ?? (localCode === 1013 ? 1013 : 1006)
    try {
      session.close?.(peer, code, received?.reason ?? '')
    } catch (error) {
      observer.failed?.(error)
    }
    observer.closed?.(code, Date.now() - started)
  })

  observer.opened?.()
  try {
    run(session.open?.(peer))
  } catch (error) {
    fail(error)
  }
  if (head.length) onData(head)
  return peer
}
