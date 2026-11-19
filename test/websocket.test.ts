import assert from 'node:assert/strict'
import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { Duplex } from 'node:stream'
import { test, type TestContext } from 'node:test'
import { acceptWebSocket, type WebSocketMessage } from '../packages/ketjs/src/server/websocket.ts'

const limit = 512

function maskedFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const extended = payload.length >= 126
  const header = Buffer.alloc(extended ? 4 : 2)
  header[0] = (fin ? 0x80 : 0) | opcode
  header[1] = 0x80 | (extended ? 126 : payload.length)
  if (extended) header.writeUInt16BE(payload.length, 2)
  const mask = Buffer.from([3, 5, 7, 11])
  const masked = Buffer.from(payload.map((byte, index) => byte ^ mask[index % mask.length]!))
  return Buffer.concat([header, mask, masked])
}

function fixture(t: TestContext, maxMessageBytes = limit) {
  const writes: Buffer[] = []
  const messages: WebSocketMessage[] = []
  const socket = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, callback) {
      writes.push(chunk)
      callback()
    },
  })
  const request = new IncomingMessage(new Socket())
  request.method = 'GET'
  request.headers = {
    connection: 'upgrade',
    'sec-websocket-version': '13',
    'sec-websocket-key': Buffer.alloc(16).toString('base64'),
  }
  t.after(() => {
    socket.destroy()
  })
  const peer = acceptWebSocket(request, socket, Buffer.alloc(0), {
    pingIntervalMs: 0,
    maxMessageBytes,
    message(_peer, value) {
      messages.push(value)
    },
  })
  assert.ok(peer)
  assert.match(writes.shift()?.toString() ?? '', /^HTTP\/1\.1 101 /)
  return {
    receive: (frame: Buffer) => socket.emit('data', frame),
    writes,
    messages,
  }
}

test('websocket: each complete text or binary message has its own byte budget', (t) => {
  const { receive, writes, messages } = fixture(t)
  const text = 't'.repeat(limit - 12)
  const binary = Buffer.alloc(limit - 4, 0xff)
  receive(
    Buffer.concat([
      maskedFrame(0x1, Buffer.from(text)),
      maskedFrame(0x2, binary),
      maskedFrame(0x1, Buffer.from(text)),
    ]),
  )

  assert.equal(messages.length, 3)
  assert.deepEqual(messages, [text, Uint8Array.from(binary), text])
  assert.deepEqual(writes, [])
})

test('websocket: a stream of small messages can exceed the per-message limit in total', (t) => {
  const { receive, writes, messages } = fixture(t, 64 * 1024)
  const expected = Array.from({ length: 100 }, (_, index) => String(index).padEnd(1024, 'x'))
  for (const message of expected) receive(maskedFrame(0x1, Buffer.from(message)))

  assert.equal(messages.length, 100)
  assert.deepEqual(messages, expected)
  assert.deepEqual(writes, [])
})

test('websocket: an interleaved ping leaves the fragmented message byte budget intact', (t) => {
  const { receive, writes, messages } = fixture(t)
  const first = 'a'.repeat(256)
  const last = 'b'.repeat(limit - 256)
  receive(maskedFrame(0x1, Buffer.from(first), false))
  receive(maskedFrame(0x9, Buffer.from('ping')))
  assert.deepEqual(messages, [])
  assert.deepEqual(writes, [Buffer.from([0x8a, 4, 0x70, 0x69, 0x6e, 0x67])])

  receive(maskedFrame(0x0, Buffer.from(last)))
  receive(maskedFrame(0x1, Buffer.from(first)))
  assert.deepEqual(messages, [first + last, first])
  assert.equal(writes.length, 1)
})

test('websocket: rejects an oversized complete message on its declared length', (t) => {
  const { receive, writes, messages } = fixture(t)
  const oversized = maskedFrame(0x2, Buffer.alloc(limit + 1))
  receive(oversized.subarray(0, 4)) // Extended length only; the mask and payload have yet to arrive.

  assert.deepEqual(messages, [])
  assert.deepEqual(writes, [Buffer.from([0x88, 2, 0x03, 0xf1])]) // Close 1009.
})

test('websocket: rejects an oversized fragmented message on the continuation header', (t) => {
  const { receive, writes, messages } = fixture(t)
  receive(maskedFrame(0x2, Buffer.alloc(256), false))
  const continuation = maskedFrame(0x0, Buffer.alloc(limit - 256 + 1))
  receive(continuation.subarray(0, 4))

  assert.deepEqual(messages, [])
  assert.deepEqual(writes, [Buffer.from([0x88, 2, 0x03, 0xf1])]) // Close 1009.
})
