import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import {
  _resetIdempotency,
  bytes,
  compose,
  createAdapterPool,
  createKetServer,
  createTheme,
  KetError,
  migrateOne,
  planMigration,
  registerFunctions,
  renderSql,
  schemaFromManifest,
  sqliteAdapter,
  streamed,
} from '@ketvietlab/ketjs'
import { catalog, checkout, defaultTheme as theme, inventory } from '@ketvietlab/ketsuite'

const mods = [catalog, inventory, checkout, theme]

const rawHttp = (port: number, request: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    let response = ''
    socket.setEncoding('utf8')
    socket.once('connect', () => socket.end(request))
    socket.on('data', (chunk) => {
      response += chunk
    })
    socket.once('end', () => resolve(response))
    socket.once('error', reject)
  })

async function boot() {
  const manifest = compose(mods)
  const adapter = sqliteAdapter()
  await adapter.open()
  for (const sql of renderSql(planMigration(null, schemaFromManifest(manifest)), adapter))
    await adapter.exec(sql)
  registerFunctions(mods)
  _resetIdempotency()
  const rt = createTheme(manifest, mods)
  const app = await createKetServer({
    manifest,
    adapter,
    resolveStream: (id, _url, req) =>
      req.headers.authorization === 'Bearer e2e-stream' ? `tenant:e2e:${id}` : null,
    theme: rt,
    pageScope: () => ({
      site: { title: 'Cửa hàng Ket', tagline: null },
      product: { id: 'p1', title: 'Áo thun', priceCents: 150000, leadTimeDays: 3 },
      related: [],
    }),
  })
  const port = await app.listen(0)
  return { app, adapter, base: `http://127.0.0.1:${port}` }
}

test('e2e: one declaration serves an HTTP endpoint', async () => {
  const { app, adapter, base } = await boot()
  const created = (await fetch(`${base}/_ket/fn/catalog.createProduct`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'p1', title: 'Áo thun', priceCents: 150000, slug: 'ao-thun' }),
  }).then((r) => r.json())) as { ok: boolean; value: { id: string } }
  assert.equal(created.ok, true)

  const got = (await fetch(`${base}/_ket/fn/catalog.getProduct`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'p1' }),
  }).then((r) => r.json())) as { value: { title: string } }
  assert.equal(got.value.title, 'Áo thun')
  await app.close()
  await adapter.close()
})

test('e2e: the same declaration serves an agent descriptor', async () => {
  const { app, adapter, base } = await boot()
  const d = (await fetch(`${base}/_ket/agent`).then((r) => r.json())) as {
    tools: Array<{ name: string; mutates: boolean; dryRunnable: boolean }>
  }
  const tool = d.tools.find((t) => t.name === 'checkout__placeOrder')!
  assert.equal(tool.mutates, true)
  assert.equal(tool.dryRunnable, true)
  await app.close()
  await adapter.close()
})

test('e2e: a bad call returns a structured error an agent can act on', async () => {
  const { app, adapter, base } = await boot()
  const res = await fetch(`${base}/_ket/fn/catalog.getProduct`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wrong: 1 }),
  })
  assert.equal(res.status, 422)
  const body = (await res.json()) as {
    code: string
    hint: string
    fieldErrors: Record<string, Array<{ code: string }>>
  }
  assert.equal(body.code, 'E_INVALID_INPUT')
  assert.match(body.hint, /signature/)
  assert.equal(body.fieldErrors.wrong![0]!.code, 'unknown')
  await app.close()
  await adapter.close()
})

test('e2e: binary and streamed routes preserve bytes without inventing a charset', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  const manifest = compose([], { headless: true })
  const app = await createKetServer({
    manifest,
    adapter,
    routes: {
      '/binary': () => bytes(Uint8Array.of(0, 255, 1), { type: 'image/png' }),
      '/stream': () =>
        streamed(
          (async function* () {
            yield Uint8Array.of(1, 2)
            yield Uint8Array.of(3)
          })(),
          { type: 'application/octet-stream' },
        ),
      '/large': () => {
        throw new KetError({ code: 'E_PAYLOAD_TOO_LARGE', message: 'too large' })
      },
    },
  })
  const port = await app.listen(0)
  const base = `http://127.0.0.1:${port}`
  try {
    const binary = await fetch(`${base}/binary`)
    assert.equal(binary.headers.get('content-type'), 'image/png')
    assert.deepEqual(new Uint8Array(await binary.arrayBuffer()), Uint8Array.of(0, 255, 1))
    const stream = await fetch(`${base}/stream`)
    assert.equal(stream.headers.get('content-type'), 'application/octet-stream')
    assert.deepEqual(new Uint8Array(await stream.arrayBuffer()), Uint8Array.of(1, 2, 3))
    const large = await fetch(`${base}/large`)
    assert.equal(large.status, 413)
  } finally {
    await app.close()
    await adapter.close()
  }
})

test('e2e: dry-run over HTTP reports writes and commits nothing', async () => {
  const { app, adapter, base } = await boot()
  const r = (await fetch(`${base}/_ket/fn/catalog.createProduct?dryRun=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'p2', title: 'Quần', priceCents: 200000, slug: 'quan' }),
  }).then((r) => r.json())) as { dryRun: boolean; writes: unknown[] }
  assert.equal(r.dryRun, true)
  assert.equal(r.writes.length, 1)
  assert.equal((await adapter.all('SELECT * FROM catalog_product', [])).length, 0)
  await app.close()
  await adapter.close()
})

test('e2e: the generic JSON limit runs before authentication resolvers', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  let authCalls = 0
  const app = await createKetServer({
    manifest: compose(mods),
    adapter,
    maxJsonBodyBytes: 32,
    resolveAllow: async () => {
      authCalls++
      return null
    },
  })
  const port = await app.listen(0)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/_ket/fn/catalog.createProduct`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x'.repeat(64) }),
    })
    assert.equal(response.status, 413)
    assert.equal(((await response.json()) as { code: string }).code, 'E_PAYLOAD_TOO_LARGE')

    const encoded = new TextEncoder().encode(JSON.stringify({ title: 'y'.repeat(64) }))
    const chunkedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 16))
        controller.enqueue(encoded.slice(16))
        controller.close()
      },
    })
    const chunked = await fetch(`http://127.0.0.1:${port}/_ket/fn/catalog.createProduct`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: chunkedBody,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    assert.equal(chunked.status, 413, 'chunked requests are counted even without Content-Length')
    assert.equal(authCalls, 0, 'oversized input must be refused before auth/session work starts')
  } finally {
    await app.close()
    await adapter.close()
  }
})

test('e2e: malformed HTTP inputs stay inside the client-error boundary', async () => {
  let datastoreResolutions = 0
  const pool = createAdapterPool({ create: () => sqliteAdapter(), max: 1 })
  const app = await createKetServer({
    manifest: compose([], { headless: true }),
    pool,
    resolveDatastore: (url) => {
      datastoreResolutions++
      return url.hostname
    },
  })
  const port = await app.listen(0)
  const base = `http://127.0.0.1:${port}`
  try {
    const post = (target: string, host: string) =>
      `POST ${target} HTTP/1.1\r\nHost: ${host}\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`
    for (const [name, request] of [
      ['encoded host', post('/_ket/fn/missing', '%')],
      ['userinfo host', post('/_ket/fn/missing', 'tenant@evil.example')],
      ['path-like host', post('/_ket/fn/missing', 'tenant/evil.example')],
      ['absolute target', post('http://victim.example/_ket/fn/missing', 'attacker.example')],
      ['scheme-relative target', post('//victim.example/_ket/fn/missing', 'attacker.example')],
    ]) {
      const response = await rawHttp(port, request)
      assert.match(response, /^HTTP\/1\.1 400 /, name)
      assert.match(response, /E_INVALID_REQUEST_URL/, name)
    }
    assert.equal(datastoreResolutions, 0, 'invalid authorities never reach tenant resolution')

    const invalidEncoding = await rawHttp(
      port,
      'POST /_ket/fn/% HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}',
    )
    assert.match(invalidEncoding, /^HTTP\/1\.1 400 /)
    assert.match(invalidEncoding, /E_ROUTE_ENCODING/)

    for (const body of ['{', '[]', 'null']) {
      const response = await fetch(`${base}/_ket/fn/missing`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
      assert.equal(response.status, 400)
      assert.equal(((await response.json()) as { code: string }).code, 'E_INVALID_JSON_BODY')
    }

    assert.equal(datastoreResolutions, 0, 'malformed paths and bodies also stop before tenant resolution')
    assert.equal((await fetch(`${base}/_ket/manifest`)).status, 200, 'the server remains available')
  } finally {
    await app.close()
    await pool.close()
  }
})

test('e2e: SSE stream resumes from a cursor after a reload', async () => {
  const { app, adapter, base } = await boot()
  const w = await app.streams.open('tenant:e2e:gen1')
  w.write('Xin')
  w.write(' chào')
  await w.flush()

  const refused = await fetch(`${base}/_ket/stream/gen1?from=0`)
  assert.equal(refused.status, 404, 'the endpoint is closed until its resolver authorizes the request')

  // first client reads what exists, then "reloads" (aborts)
  const ac = new AbortController()
  const res1 = await fetch(`${base}/_ket/stream/gen1?from=0`, {
    headers: { authorization: 'Bearer e2e-stream' },
    signal: ac.signal,
  })
  const reader = res1.body!.getReader()
  let seen = ''
  while (!seen.includes('chào')) {
    const { value } = await reader.read()
    seen += new TextDecoder().decode(value)
  }
  const lastId = Number([...seen.matchAll(/^id: (\d+)$/gm)].pop()![1])
  ac.abort()

  // generation continues while nobody is listening
  w.write(' bạn')
  await w.end()

  const res2 = await fetch(`${base}/_ket/stream/gen1?from=${lastId + 1}`, {
    headers: { authorization: 'Bearer e2e-stream' },
  })
  const text = await res2.text()
  assert.match(text, /bạn/)
  assert.ok(!text.includes('Xin'), 'a resumed stream must not replay chunks the client already had')
  assert.match(text, /event: done/)
  await app.close()
  await adapter.close()
})

test('e2e: a page renders through the theme, joint fills included', async () => {
  const { app, adapter, base } = await boot()
  const html = await fetch(`${base}/`).then((r) => r.text())
  assert.match(html, /<title>Cửa hàng Ket<\/title>/)
  assert.match(html, /<h1>Áo thun<\/h1>/)
  assert.match(html, /Giao sau 3 ngày/)
  assert.match(html, /Chạy trên Ket/)
  await app.close()
  await adapter.close()
})

test('e2e: the server resolves the company, so two of them see different rows on one path', async () => {
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, compose(mods))
  const manifest2 = compose(mods)
  registerFunctions(mods)

  const app = await createKetServer({
    manifest: manifest2,
    adapter: db,
    // The one place a request's identity is decided — a header here, a session later.
    resolveScope: (_url, req) => ({
      company: (req.headers['x-ket-company'] as string | undefined) ?? null,
      branch: 'main',
      branches: null,
    }),
  })
  const port = await app.listen(0)
  const base = `http://127.0.0.1:${port}`
  const post = (company: string, fn: string, body: unknown) =>
    fetch(`${base}/_ket/fn/${fn}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ket-company': company },
      body: JSON.stringify(body),
    }).then((r) => r.json()) as Promise<{ ok: boolean; value: unknown }>

  await post('acme', 'catalog.createProduct', { id: 'p1', title: 'Áo', priceCents: 1000, slug: 'ao' })
  await post('acme', 'checkout.placeOrder', { id: 'o-acme', productId: 'p1', qty: 1 })
  await post('globex', 'checkout.placeOrder', { id: 'o-globex', productId: 'p1', qty: 2 })

  const rows = await db.all('SELECT id, "companyId" FROM checkout_order ORDER BY id', [])
  assert.deepEqual(
    rows.map((r) => `${String(r.id)}/${String(r.companyId)}`),
    ['o-acme/acme', 'o-globex/globex'],
    'each write was stamped with the company the request named, in the same table',
  )

  await app.close()
  await db.close()
})

test('e2e: a request that names no company is refused rather than answered', async () => {
  const db = sqliteAdapter()
  await db.open()
  const manifest2 = compose(mods)
  await migrateOne(db, manifest2)
  registerFunctions(mods)

  const app = await createKetServer({
    manifest: manifest2,
    adapter: db,
    resolveScope: () => ({ company: null, branches: null }),
  })
  const port = await app.listen(0)
  // The product is shared master data and needs no company, so creating it first
  // means the order fails on the scope check rather than on a missing product.
  await fetch(`http://127.0.0.1:${port}/_ket/fn/catalog.createProduct`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'p', title: 'Áo', priceCents: 1000, slug: 'ao' }),
  })
  const res = await fetch(`http://127.0.0.1:${port}/_ket/fn/checkout.placeOrder`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'x', productId: 'p', qty: 1 }),
  })
  assert.equal(res.status, 400)
  assert.equal(((await res.json()) as { code: string }).code, 'E_NO_COMPANY_IN_SCOPE')
  await app.close()
  await db.close()
})
