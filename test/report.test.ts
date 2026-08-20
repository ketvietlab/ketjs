import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { test } from 'node:test'
import {
  callFn,
  bootApp,
  compose,
  defineFn,
  defineModule,
  defineApp,
  defineTheme,
  diffManifests,
  migrateOne,
  registerFunctions,
  restrictManifest,
  sqliteAdapter,
} from 'ketjs'
import type { KetError } from 'ketjs'
import { compileReportTemplate, interFontUrl, renderPdf, renderReportHtml } from 'ketjs/pdf'
import { report } from 'ketsuite'

const source = defineModule({
  name: 'orders',
  models: { Order: { scope: 'company', fields: { id: 'id', name: 'text' } } },
  functions: {
    saveOrder: defineFn({
      input: { id: 'id', name: 'text' },
      effects: ['read:orders.Order', 'write:orders.Order'],
      handler: async (ctx, args) => {
        if ((await ctx.db.select('orders.Order', { id: args.id }))[0])
          await ctx.db.update('orders.Order', { id: args.id }, { name: args.name })
        else await ctx.db.insert('orders.Order', args)
        return { ok: true }
      },
    }),
    getPrintData: defineFn({
      input: { id: 'id' },
      effects: ['read:orders.Order'],
      handler: async (ctx, args) => (await ctx.db.select('orders.Order', { id: args.id }))[0] ?? null,
    }),
  },
  reports: {
    order: {
      title: 'orders.report.order',
      target: 'orders.Order',
      source: 'orders.getPrintData',
      template: '<report><text>{{ name }}</text></report>',
    },
  },
})

test('report manifest composes provenance and follows runtime module restriction', () => {
  const manifest = compose([source])
  assert.equal(manifest.reports['orders.order']?.by, 'orders')
  assert.equal(manifest.reports['orders.order']?.source, 'orders.getPrintData')
  assert.deepEqual(restrictManifest(manifest, new Set()).reports, {})
  assert.equal(
    restrictManifest(manifest, new Set(['orders'])).reports['orders.order']?.target,
    'orders.Order',
  )
})

test('report declarations participate in upgrade diffs', () => {
  const before = compose([source])
  const after = compose([
    defineModule({ name: 'orders', models: source.models, functions: source.functions }),
  ])
  assert.equal(
    diffManifests(before, after).find((item) => item.code === 'REPORT_REMOVED')?.severity,
    'breaking',
  )
})

test('report declarations reject missing and mutating sources, and themes cannot declare reports', () => {
  const missing = defineModule({
    name: 'missing',
    models: { Row: { scope: 'shared', fields: { id: 'id' } } },
    reports: { bad: { title: 'Bad', target: 'missing.Row', source: 'missing.nope', template: '<report />' } },
  })
  assert.throws(
    () => compose([missing]),
    (error: KetError) => error.items?.some((item) => item.code === 'E_REPORT_UNKNOWN_SOURCE') === true,
  )
  assert.throws(
    () => defineTheme({ name: 'paper', reports: source.reports }),
    (error: KetError) => error.code === 'E_THEME_OVERREACH',
  )
})

test('report KTL forbids raw and web primitives', () => {
  assert.throws(() => compileReportTemplate('<report><text>{{ raw name }}</text></report>'), /raw output/)
  assert.throws(() => compileReportTemplate('<report>{% joint "x:y" %}</report>'), /uses joint/)
})

test('PDF renderer embeds Inter, paginates, and preserves Vietnamese Unicode mapping', async () => {
  const rows = Array.from({ length: 90 }, (_, index) => ({ name: `Sản phẩm ${index + 1}`, qty: index + 1 }))
  const document = compileReportTemplate(
    '<report paper="A4"><header><text size="9">CÔNG TY KẾT</text></header><text size="20">Phiếu xuất kho</text><table><tbody>{% for row in rows %}<tr><td>{{ row.name }}</td><td>{{ row.qty }}</td></tr>{% endfor %}</tbody></table><footer><text>{page}/{pages}</text></footer></report>',
  ).render({ rows })
  assert.match(renderReportHtml(document), /Sản phẩm 1/)
  const pdf = renderPdf(document, { font: await readFile(interFontUrl()) })
  const ascii = Buffer.from(pdf).toString('latin1')
  assert.ok(ascii.startsWith('%PDF-1.7'))
  assert.match(ascii, /\/BaseFont \/Inter/)
  assert.ok((ascii.match(/\/Type \/Page\b/g) ?? []).length >= 2)
})

test('PDF renderer embeds attachment-backed PNG images without network access', async () => {
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    out.write(type, 4, 'ascii')
    Buffer.from(data).copy(out, 8)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, 20, 120, 220]))),
    chunk('IEND', new Uint8Array()),
  ])
  const document = compileReportTemplate(
    '<report><image src="logo" width="40" height="40"/><text>Logo</text></report>',
  ).render({})
  const pdf = renderPdf(document, { font: await readFile(interFontUrl()), images: { logo: png } })
  assert.match(Buffer.from(pdf).toString('latin1'), /\/Subtype \/Image/)
})

test('report templates publish immutable versions and invalidate cache metadata', async () => {
  const modules = [source, report]
  const manifest = compose(modules, { headless: true })
  const adapter = sqliteAdapter()
  await adapter.open()
  try {
    await migrateOne(adapter, manifest)
    registerFunctions(modules)
    const scope = { company: 'acme' }
    const call = (name: string, args: Record<string, unknown>) =>
      callFn(name, args, { adapter, manifest, scope })
    const saved = (
      await call('report.saveDraft', {
        reportId: 'orders.order',
        source: '<report><text>{{ name }}</text></report>',
        revision: 0,
        layout: {},
      })
    ).value as { revision: number }
    const published = (await call('report.publish', { reportId: 'orders.order', revision: saved.revision }))
      .value as {
      ok: boolean
      version: number
    }
    assert.deepEqual(published, { ok: true, version: 1 })
    const template = (await call('report.getTemplate', { reportId: 'orders.order' })).value as Record<
      string,
      unknown
    >
    assert.equal(template.publishedVersion, 1)
    assert.equal(Array.isArray((await call('report.listVersions', { reportId: 'orders.order' })).value), true)
  } finally {
    await adapter.close()
  }
})

test('report HTTP route generates synchronously and reuses the 30-day cache', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-report-'))
  const sqliteFile = join(dir, 'report.db')
  const storageDir = join(dir, 'storage')
  const app = defineApp({
    name: 'reporttest',
    modules: [source, report],
    serve: { bootstrap: ['orders', 'report'], defaults: { sqliteFile, storageDir, defaultCompany: 'acme' } },
  })
  const server = await bootApp(app, {
    port: 0,
    env: { KET_SQLITE: sqliteFile, KET_STORAGE_DIR: storageDir, KET_COMPANY: 'acme' },
    log: () => {},
  })
  try {
    await callFn(
      'orders.saveOrder',
      { id: 'one', name: 'Đơn hàng Việt' },
      {
        adapter: server.adapter!,
        manifest: server.manifest,
        scope: { company: 'acme' },
      },
    )
    const href = `http://127.0.0.1:${server.port}/reports/orders.order/one?lang=vi`
    const first = await fetch(href, { headers: { 'x-ket-company': 'acme' } })
    assert.equal(first.status, 200)
    assert.equal(first.headers.get('content-type'), 'application/pdf')
    assert.match(first.headers.get('content-disposition') ?? '', /\.pdf"$/)
    const firstBytes = new Uint8Array(await first.arrayBuffer())
    assert.ok(Buffer.from(firstBytes).toString('latin1').startsWith('%PDF-1.7'))
    const second = await fetch(href, { headers: { 'x-ket-company': 'acme' } })
    assert.deepEqual(new Uint8Array(await second.arrayBuffer()), firstBytes)
    await callFn(
      'orders.saveOrder',
      { id: 'one', name: 'Đơn hàng đã đổi' },
      { adapter: server.adapter!, manifest: server.manifest, scope: { company: 'acme' } },
    )
    const changed = await fetch(href, { headers: { 'x-ket-company': 'acme' } })
    assert.notDeepEqual(new Uint8Array(await changed.arrayBuffer()), firstBytes)
    const cache = await server.adapter!.all('SELECT "active", "expiresAt" FROM report_cache')
    assert.equal(cache.length, 1)
    assert.equal(cache[0]?.active, 1)
    assert.ok(Date.parse(String(cache[0]?.expiresAt)) > Date.now() + 29 * 24 * 60 * 60 * 1000)
  } finally {
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
})
