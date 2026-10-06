import assert from 'node:assert/strict'
import { createSocket } from 'node:dgram'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

/** A DNS server answering TXT questions from `records`; a name in `failing` answers SERVFAIL. */
async function fakeDns(records: Map<string, string[]>, failing: Set<string>) {
  const socket = createSocket('udp4')
  socket.on('message', (query, peer) => {
    const labels: string[] = []
    let at = 12
    while (query[at]) {
      labels.push(query.subarray(at + 1, at + 1 + query[at]!).toString())
      at += query[at]! + 1
    }
    const question = query.subarray(12, at + 5)
    const name = labels.join('.').toLowerCase()
    const values = records.get(name) ?? []
    const rcode = failing.has(name) ? 2 : records.has(name) ? 0 : 3
    const header = Buffer.alloc(12)
    query.copy(header, 0, 0, 2)
    header.writeUInt16BE(0x8180 | rcode, 2)
    header.writeUInt16BE(1, 4)
    header.writeUInt16BE(rcode ? 0 : values.length, 6)
    const answers = rcode
      ? []
      : values.map((value) => {
          const text = Buffer.from(value)
          const rdata = Buffer.concat([Buffer.from([text.length]), text])
          const head = Buffer.alloc(12)
          head.writeUInt16BE(0xc00c, 0)
          head.writeUInt16BE(16, 2)
          head.writeUInt16BE(1, 4)
          head.writeUInt32BE(0, 6)
          head.writeUInt16BE(rdata.length, 10)
          return Buffer.concat([head, rdata])
        })
    socket.send(Buffer.concat([header, question, ...answers]), peer.port, peer.address)
  })
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve))
  return { port: socket.address().port, close: () => socket.close() }
}

/**
 * A site's own domains: the first added is its address, the rest redirect to it. A host is proven
 * by a TXT record the server looks up itself, and becomes the address only once it is proven and
 * Két Việt has it answering over HTTPS.
 */
test('Studio domains: add, prove by a real TXT lookup, and switch the primary only when it is served', async (t) => {
  const records = new Map<string, string[]>()
  const failing = new Set<string>()
  const dns = await fakeDns(records, failing)
  const previous = process.env.WEBSITE_DNS_SERVERS
  process.env.WEBSITE_DNS_SERVERS = `127.0.0.1:${dns.port}`
  const { app, fixture } = await bootWebsiteStudio()
  t.after(async () => {
    await app.close()
    dns.close()
    if (previous === undefined) delete process.env.WEBSITE_DNS_SERVERS
    else process.env.WEBSITE_DNS_SERVERS = previous
  })
  const clientFor = async (login: string) => {
    const client = app.client.anonymous()
    await client.login({ login, password: 'studio-local' })
    const post = async (path: string, input: Row) => {
      const response = await client.post(path, JSON.stringify(input), {
        headers: { 'content-type': 'application/json' },
      })
      return { status: response.status, ...((await response.json()) as { value: Row; message?: string }) }
    }
    return Object.assign((name: string, input: Row) => post('/website/api/' + name, input), { post })
  }
  const designer = await clientFor('studio-designer')
  const reader = await clientFor('studio-reader')
  const add = (id: string, title: string) =>
    designer('website_studio.saveResource', {
      siteId: 'site-a',
      kind: 'domains',
      id,
      expectedRevisionId: null,
      values: { title },
    })
  const domain = async (id: string) =>
    (await designer('website_studio.getResource', { siteId: 'site-a', kind: 'domains', id })).value
  const verify = async (id: string) =>
    designer('website_studio.verifyDomain', {
      siteId: 'site-a',
      id,
      expectedRevisionId: (await domain(id)).revisionId,
    })

  const first = await add('d-main', 'Lanh.Test')
  assert.equal(first.status, 200, String(first.message))
  assert.deepEqual(
    [first.value.title, first.value.role, first.value.state, first.value.tls],
    ['lanh.test', 'primary', 'pending', 'pending'],
    'the first host is the address, still to be proven',
  )
  const second = (await add('d-new', 'moi.lanh.test')).value
  assert.equal(second.role, 'redirect')
  const challenge = second.challenge as Row
  assert.equal(challenge.type, 'TXT')
  assert.equal(challenge.name, '_ketsuite.moi.lanh.test')
  assert.match(String(challenge.value), /^ketsuite-verify=[0-9a-f]{32}$/)
  assert.notEqual(challenge.value, (first.value.challenge as Row).value, 'each host has its own proof')
  // A retried add answers with the same domain; a new name under that id is refused.
  assert.equal((await add('d-new', 'moi.lanh.test')).value.revisionId, second.revisionId)
  const renamed = await add('d-new', 'khac.lanh.test')
  assert.equal(renamed.status, 400)
  assert.match(String(renamed.message), /thêm tên miền mới/)
  assert.equal(
    (await designer('website_studio.getResource', { siteId: 'site-b', kind: 'domains', id: 'd-new' })).status,
    404,
  )

  // Nothing in DNS yet, then the wrong value, then a resolver that cannot answer.
  const missing = (await verify('d-new')).value
  assert.deepEqual([missing.state, missing.reason], ['failed', 'missing'])
  assert.deepEqual(
    (missing.attempts as Row[]).map((a) => [a.result, a.reason]),
    [['failed', 'missing']],
  )
  records.set('_ketsuite.moi.lanh.test', ['ketsuite-verify=0000'])
  assert.equal((await verify('d-new')).value.reason, 'mismatch')
  failing.add('_ketsuite.moi.lanh.test')
  assert.equal((await verify('d-new')).value.reason, 'unreachable')
  failing.clear()
  assert.equal(
    (
      await reader('website_studio.verifyDomain', {
        siteId: 'site-a',
        id: 'd-new',
        expectedRevisionId: (await domain('d-new')).revisionId,
      })
    ).status,
    403,
  )
  const stale = await designer('website_studio.verifyDomain', {
    siteId: 'site-a',
    id: 'd-new',
    expectedRevisionId: second.revisionId,
  })
  assert.equal(stale.status, 400)

  records.set('_ketsuite.moi.lanh.test', ['v=spf1 -all', String(challenge.value)])
  const proven = (await verify('d-new')).value
  assert.deepEqual([proven.state, proven.reason, proven.tls], ['verified', 'matched', 'pending'])
  // A proof stays once made; a later lookup that fails is reported without taking it away.
  records.delete('_ketsuite.moi.lanh.test')
  const after = (await verify('d-new')).value
  assert.deepEqual([after.state, after.reason], ['verified', 'missing'])

  const switchTo = async (confirmed: boolean, expectedPrimaryId: unknown = 'd-main') =>
    designer('website_studio.setPrimaryDomain', {
      siteId: 'site-a',
      id: 'd-new',
      expectedRevisionId: (await domain('d-new')).revisionId,
      expectedPrimaryId,
      confirmed,
    })
  // Proven but not answering over HTTPS: every other host would redirect into nothing.
  const unserved = await switchTo(true)
  assert.equal(unserved.status, 400)
  assert.match(String(unserved.message), /HTTPS/)
  // Only Két Việt says a host is served; no Studio role reaches it.
  assert.ok(
    (await designer.post('/_ket/fn/website.markDomainServing', { id: 'd-new', serving: true })).status >= 400,
  )
  await fixture('website.markDomainServing', { id: 'd-new', serving: true })
  assert.equal((await domain('d-new')).tls, 'ready')

  assert.equal((await switchTo(false)).status, 400, 'the switch is confirmed first')
  assert.equal((await switchTo(true, null)).status, 400, 'a primary changed meanwhile is a conflict')
  const switched = await switchTo(true)
  assert.equal(switched.status, 200, String(switched.message))
  assert.equal(switched.value.role, 'primary')
  const rows = (await designer('website_studio.listResources', { siteId: 'site-a', kind: 'domains' })).value
    .rows as Row[]
  assert.deepEqual(rows.map((r) => [r.id, r.role]).sort(), [
    ['d-main', 'redirect'],
    ['d-new', 'primary'],
  ])

  // A host renamed behind the Studio's back has to be proven again under its new name.
  await fixture('website.saveDomain', { id: 'd-new', siteId: 'site-a', host: 'cu.lanh.test', primary: true })
  const moved = await domain('d-new')
  assert.deepEqual([moved.state, moved.tls, moved.checkedAt], ['pending', 'pending', null])
  assert.notEqual((moved.challenge as Row).value, challenge.value)
})
