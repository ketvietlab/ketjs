import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import { createHash } from 'node:crypto'
import {
  compose,
  createKetServer,
  notificationHub,
  planMigration,
  renderSql,
  schemaFromManifest,
  sqliteAdapter,
  text,
  websocket,
} from '@ketvietlab/ketjs'
import type { Adapter, WebSocketPeer } from '@ketvietlab/ketjs'
// The same module instances the context uses: the hub is per module instance.
import { createContext } from '../packages/ketjs/src/server/ctx.ts'
import { notificationHub as sourceHub } from '../packages/ketjs/src/server/notify.ts'
import { catalog, checkout, defaultTheme, inventory } from '@ketvietlab/ketsuite'

const mods = [catalog, inventory, checkout, defaultTheme]

type Opened = { peer: WebSocketPeer; closed: Promise<[number, string]> }

async function boot(routes: Parameters<typeof createKetServer>[0]['routes']) {
  const manifest = compose(mods)
  const adapter = sqliteAdapter()
  await adapter.open()
  const app = await createKetServer({ manifest, adapter, routes })
  const port = await app.listen(0)
  return { app, port, url: `ws://127.0.0.1:${port}` }
}

const next = <T>(ws: WebSocket, event: string, map: (e: Event) => T): Promise<T> =>
  new Promise((resolve) => ws.addEventListener(event, (e) => resolve(map(e)), { once: true }))
const message = (ws: WebSocket) => next(ws, 'message', (e) => (e as MessageEvent).data as string)
const closed = (ws: WebSocket) =>
  next(ws, 'close', (e) => [(e as CloseEvent).code, (e as CloseEvent).reason] as [number, string])

/** A handshake written by hand, for what a well-behaved client never sends. */
const rawSocket = (port: number, path: string, extra = '') =>
  new Promise<{ head: string; socket: import('node:net').Socket; rest: Buffer }>((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    let buffer = Buffer.alloc(0)
    socket.once('connect', () =>
      socket.write(
        `GET ${path} HTTP/1.1\r\nhost: 127.0.0.1\r\nupgrade: websocket\r\nconnection: Upgrade\r\n` +
          `sec-websocket-version: 13\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\n${extra}\r\n`,
      ),
    )
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      const end = buffer.indexOf('\r\n\r\n')
      if (end < 0) return
      socket.off('data', onData)
      resolve({ head: buffer.subarray(0, end).toString('latin1'), socket, rest: buffer.subarray(end + 4) })
    }
    socket.on('data', onData)
    socket.once('error', reject)
  })

const maskedFrame = (opcode: number, payload: Buffer, fin = true): Buffer => {
  const mask = Buffer.from([1, 2, 3, 4])
  const header =
    payload.length < 126
      ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | payload.length])
      : Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | 126, payload.length >> 8, payload.length & 0xff])
  const body = Buffer.from(payload.map((b, i) => b ^ (mask[i & 3] as number)))
  return Buffer.concat([header, mask, body])
}

test('websocket: a route that answers websocket() is upgraded, speaks and closes cleanly', async () => {
  const opened: Opened[] = []
  const { app, url } = await boot({
    '/live': () =>
      websocket({
        protocols: ['ket.test.v1'],
        open(peer) {
          let done: (value: [number, string]) => void = () => {}
          opened.push({ peer, closed: new Promise((resolve) => (done = resolve)) })
          ;(peer as WebSocketPeer & { done?: typeof done }).done = done
          peer.send('hello')
        },
        message(peer, value) {
          peer.send(`echo:${typeof value === 'string' ? value : `bytes ${value.length}`}`)
        },
        close(peer, code, reason) {
          ;(peer as WebSocketPeer & { done: (value: [number, string]) => void }).done([code, reason])
        },
      }),
  })
  const ws = new WebSocket(`${url}/live`, ['other', 'ket.test.v1'])
  assert.equal(await message(ws), 'hello')
  assert.equal(ws.protocol, 'ket.test.v1', 'the route picks a protocol the client offered')
  ws.send('ping')
  assert.equal(await message(ws), 'echo:ping')
  ws.send(new Uint8Array([1, 2, 3]))
  assert.equal(await message(ws), 'echo:bytes 3')
  ws.send('x'.repeat(60_000))
  assert.equal(await message(ws), `echo:${'x'.repeat(60_000)}`, 'a 16-bit length frame is read whole')
  const clientClosed = closed(ws)
  ws.close(4001, 'bye')
  assert.deepEqual(await opened[0]?.closed, [4001, 'bye'])
  assert.equal((await clientClosed)[0], 4001, 'the server echoes the close code')
  await app.close()
})

test('websocket: the route still decides — a refusal is the HTTP answer, not a socket', async () => {
  const { app, url, port } = await boot({
    '/private': (_url, req) =>
      req.headers.authorization === 'Bearer yes'
        ? websocket({ open: (peer) => void peer.send('in') })
        : text('sign in first', { status: 401 }),
  })
  const refused = new WebSocket(`${url}/private`)
  const [code] = await closed(refused)
  assert.equal(code, 1006, 'the browser API sees a failed handshake')

  const raw = await rawSocket(port, '/private')
  assert.match(raw.head, /^HTTP\/1\.1 401 Unauthorized/)
  raw.socket.destroy()

  const allowed = await rawSocket(port, '/private', 'authorization: Bearer yes\r\n')
  assert.match(allowed.head, /^HTTP\/1\.1 101 Switching Protocols/)
  const accept = createHash('sha1')
    .update('dGhlIHNhbXBsZSBub25jZQ==258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64')
  assert.ok(allowed.head.includes(`sec-websocket-accept: ${accept}`), 'RFC 6455 example key')
  allowed.socket.destroy()

  const missing = await rawSocket(port, '/nowhere')
  assert.match(missing.head, /^HTTP\/1\.1 404/)
  missing.socket.destroy()

  // A plain request to a websocket route is told which protocol it needs.
  const plain = await fetch(`http://127.0.0.1:${port}/private`, { headers: { authorization: 'Bearer yes' } })
  assert.equal(plain.status, 426)
  assert.equal(plain.headers.get('upgrade'), 'websocket')
  await app.close()
})

test('websocket: a client offering none of the route protocols is refused before upgrading', async () => {
  const { app, port } = await boot({ '/live': () => websocket({ protocols: ['ket.test.v1'] }) })
  const raw = await rawSocket(port, '/live', 'sec-websocket-protocol: something.else\r\n')
  assert.match(raw.head, /^HTTP\/1\.1 400/)
  raw.socket.destroy()
  await app.close()
})

test('websocket: fragments reassemble, pings are answered, and protocol errors close with their code', async () => {
  const received: string[] = []
  let closedWith: number | null = null
  const { app, port } = await boot({
    '/live': () =>
      websocket({
        maxMessageBytes: 32,
        message: (_peer, value) => void received.push(String(value)),
        close: (_peer, code) => void (closedWith = code),
      }),
  })
  const { socket, rest } = await rawSocket(port, '/live')
  assert.equal(rest.length, 0)
  const frames: Buffer[] = []
  socket.on('data', (chunk: Buffer) => frames.push(chunk))
  socket.write(maskedFrame(0x1, Buffer.from('hel'), false))
  socket.write(maskedFrame(0x9, Buffer.from('p1'))) // a control frame between fragments
  socket.write(maskedFrame(0x0, Buffer.from('lo')))
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.deepEqual(received, ['hello'])
  const pong = Buffer.concat(frames)
  assert.deepEqual([...pong.subarray(0, 4)], [0x8a, 2, 0x70, 0x31], 'an unmasked pong with the ping payload')

  // Declared too large: refused before the bytes arrive.
  frames.length = 0
  socket.write(maskedFrame(0x1, Buffer.alloc(40, 0x61)))
  await new Promise((resolve) => socket.once('close', resolve).setTimeout(6_000))
  await new Promise((resolve) => setTimeout(resolve, 20))
  const close = Buffer.concat(frames)
  assert.equal(close[0], 0x88)
  assert.equal(close.readUInt16BE(2), 1009)
  assert.equal(closedWith, 1006, 'the client never completed the closing handshake')
  await app.close()
})

test('websocket: an unmasked client frame is a protocol error', async () => {
  const { app, port } = await boot({ '/live': () => websocket({}) })
  const { socket } = await rawSocket(port, '/live')
  const frames: Buffer[] = []
  socket.on('data', (chunk: Buffer) => frames.push(chunk))
  socket.write(Buffer.from([0x81, 0x02, 0x68, 0x69]))
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(Buffer.concat(frames).readUInt16BE(2), 1002)
  socket.destroy()
  await app.close()
})

test('websocket: a peer that goes silent is dropped after a missed ping', async () => {
  let code: number | null = null
  const { app, port } = await boot({
    '/live': () => websocket({ pingIntervalMs: 40, close: (_peer, c) => void (code = c) }),
  })
  const { socket } = await rawSocket(port, '/live')
  socket.pause() // reads nothing, answers nothing
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(code, 1006)
  socket.destroy()
  await app.close()
})

test('websocket: closing the server says going-away to every open socket', async () => {
  const { app, url } = await boot({ '/live': () => websocket({ open: (peer) => void peer.send('in') }) })
  const ws = new WebSocket(`${url}/live`)
  await message(ws)
  const ending = closed(ws)
  await app.close()
  assert.equal((await ending)[0], 1001)
})

test('notify: in-process delivery waits for commit and is dropped on rollback', async () => {
  const manifest = compose(mods)
  const adapter = sqliteAdapter()
  await adapter.open()
  for (const sql of renderSql(planMigration(null, schemaFromManifest(manifest)), adapter))
    await adapter.exec(sql)
  const heard: string[] = []
  const hub = sourceHub(adapter)
  assert.equal(hub.shared, false)
  const stop = await hub.subscribe('ket_test', (payload) => heard.push(payload))
  const ctx = createContext({ adapter, manifest, fnKey: 'catalog.createProduct' })

  await ctx.notify('ket_test', 'direct')
  await ctx.tx(async (inner) => {
    await inner.notify('ket_test', 'committed')
    await Promise.resolve()
    assert.deepEqual(heard, ['direct'], 'nothing is heard before commit')
  })
  await ctx
    .tx(async (inner) => {
      await inner.notify('ket_test', 'rolled back')
      throw new Error('abort')
    })
    .catch(() => {})
  await Promise.resolve()
  assert.deepEqual(heard, ['direct', 'committed'])

  await assert.rejects(ctx.notify('Bad Channel', 'x'), /lowercase identifier/)
  await assert.rejects(ctx.notify('ket_test', 'x'.repeat(8_000)), /at most 7999 bytes/)
  await stop()
  await ctx.notify('ket_test', 'after')
  await Promise.resolve()
  assert.deepEqual(heard, ['direct', 'committed'])
})

test('notify: however many listeners, the database sees one LISTEN per channel', async () => {
  const listens: string[] = []
  const unlistens: string[] = []
  let deliver: (payload: string) => void = () => {}
  let ready: () => void = () => {}
  const adapter = {
    notifications: {
      publish: async () => {},
      subscribe: async (channel: string, onMessage: (payload: string) => void, onReady: () => void) => {
        listens.push(channel)
        deliver = onMessage
        ready = onReady
        queueMicrotask(onReady)
        return async () => void unlistens.push(channel)
      },
    },
  } as unknown as Adapter
  const hub = notificationHub(adapter)
  assert.equal(hub.shared, true)
  const a: string[] = []
  const b: string[] = []
  let readyA = 0
  let readyB = 0
  const stopA = await hub.subscribe(
    'ket_shared',
    (p) => a.push(p),
    () => readyA++,
  )
  await new Promise((resolve) => setImmediate(resolve))
  const stopB = await hub.subscribe(
    'ket_shared',
    (p) => b.push(p),
    () => readyB++,
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(listens, ['ket_shared'])
  assert.deepEqual([readyA, readyB], [1, 1], 'a late listener still hears that listening started')
  deliver('one')
  assert.deepEqual([a, b], [['one'], ['one']])
  ready() // the connection came back: everyone re-reads
  assert.deepEqual([readyA, readyB], [2, 2])
  await stopA()
  assert.deepEqual(unlistens, [])
  await stopB()
  assert.deepEqual(unlistens, ['ket_shared'])
})
