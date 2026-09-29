import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

const png = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a60000000049454e44ae426082',
  'hex',
)

test('file records reference uploaded content only through a well-formed upload id', () => {
  const s = createOrganizationSession(),
    d = s.sessions.get('demo').data,
    before = d.files.length
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
  const save = (files) =>
    s.call('flow.entity.save', {
      companyId: 'demo',
      collection: 'files',
      taskId: 'KV-142',
      files,
      idempotencyKey: crypto.randomUUID(),
    }).value
  assert.equal(save([{ title: 'x.png', size: 1, type: 'image/png', uploadId: '../../etc/passwd' }]).ok, false)
  assert.equal(d.files.length, before)
  save([
    { title: 'Ảnh.png', size: 2 * 1024 * 1024, type: 'image/png', uploadId: id },
    { title: 'notes.txt', size: 10 },
  ])
  const [image, plain] = d.files.slice(-2)
  assert.equal(image.url, `/_ket/files/${id}`)
  assert.equal(image.contentType, 'image/png')
  assert.match(image.description, /^2\.0 MB · /)
  assert.equal(plain.url, null)
})

test('Atlas server stores uploaded bytes, trusts its own size and type, and serves previews safely', async (t) => {
  const port = 20000 + Math.floor(Math.random() * 20000)
  const server = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../atlas/server.mjs', import.meta.url)),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  t.after(() => server.kill())
  await new Promise((ok, fail) => {
    server.stdout.on('data', (d) => String(d).includes('Flow renderer') && ok())
    server.on('exit', (code) => fail(new Error('server exited ' + code)))
  })
  const base = `http://127.0.0.1:${port}`
  const page = await (await fetch(`${base}/flow/issue?id=KV-142`)).text()
  const session = JSON.parse(page.match(/id="flow-environment">(.*?)<\/script>/)[1]).session
  const upload = async (bytes, type, name, headers = {}) =>
    (
      await fetch(`${base}/_ket/upload`, {
        method: 'POST',
        body: bytes,
        headers: {
          'content-type': type,
          'x-file-name': encodeURIComponent(name),
          'x-flow-fixture': session,
          ...headers,
        },
      })
    ).json()
  const call = async (name, input) =>
    (
      await fetch(`${base}/_ket/fn/${name}`, {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'content-type': 'application/json', 'x-flow-fixture': session },
      })
    ).json()
  assert.equal((await upload(png, 'image/png', 'a.png', { 'x-flow-fixture': 'stranger' })).ok, false)
  const image = await upload(png, 'image/png', 'Ảnh chụp.png'),
    svg = await upload(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      'image/svg+xml',
      'x.svg',
    )
  // Client-declared size/type are ignored in favour of the stored upload.
  const saved = await call('flow.entity.save', {
    companyId: 'demo',
    collection: 'files',
    taskId: 'KV-142',
    files: [
      { title: 'Ảnh chụp.png', size: 1, type: 'text/html', uploadId: image.uploadId },
      { title: 'x.svg', size: 1, type: 'image/svg+xml', uploadId: svg.uploadId },
    ],
    idempotencyKey: crypto.randomUUID(),
  })
  assert.equal(saved.value.ids.length, 2)
  const boot = await call('flow.workspace.bootstrap', { companyId: 'demo' })
  const [pngFile, svgFile] = boot.value.files.filter((f) => saved.value.ids.includes(f.id))
  assert.equal(pngFile.size, png.length)
  assert.equal(pngFile.contentType, 'image/png')
  const inline = await fetch(base + pngFile.url)
  assert.equal(inline.headers.get('content-type'), 'image/png')
  assert.match(inline.headers.get('content-disposition'), /^inline/)
  assert.match(inline.headers.get('content-security-policy'), /sandbox/)
  assert.deepEqual(Buffer.from(await inline.arrayBuffer()), png)
  const download = await fetch(base + pngFile.url + '?download=1')
  await download.arrayBuffer()
  assert.match(
    download.headers.get('content-disposition'),
    /^attachment; filename\*=UTF-8''%E1%BA%A2nh%20ch%E1%BB%A5p\.png/,
  )
  const part = await fetch(base + pngFile.url, { headers: { range: 'bytes=0-7' } })
  assert.equal(part.status, 206)
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), png.subarray(0, 8))
  const unsafe = await fetch(base + svgFile.url)
  await unsafe.arrayBuffer()
  assert.equal(unsafe.headers.get('content-type'), 'application/octet-stream')
  assert.match(unsafe.headers.get('content-disposition'), /^attachment/)
  const stale = await call('flow.entity.save', {
    companyId: 'demo',
    collection: 'files',
    taskId: 'KV-142',
    files: [{ title: 'gone.png', size: 1, uploadId: '0f8fad5b-d9cb-469f-a165-70867728950e' }],
    idempotencyKey: crypto.randomUUID(),
  })
  assert.equal(stale.value.ok, false)
})
