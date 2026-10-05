import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

test('Studio site style uses real configuration grants and revision CAS without changing page drafts', async (t) => {
  const { app } = await bootWebsiteStudio()
  t.after(() => app.close())
  const designer = app.client.anonymous()
  await designer.login({ login: 'studio-designer', password: 'studio-local' })
  const editor = app.client.anonymous()
  await editor.login({ login: 'studio-editor', password: 'studio-local' })
  const send = async (client: typeof designer, fn: string, input: Row, key?: string) => {
    const response = await client.post('/website/api/' + fn, JSON.stringify(input), {
      headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    })
    return { status: response.status, ...((await response.json()) as { value: Row }) }
  }
  const call = async (fn: string, input: Row) => {
    const r = await send(designer, fn, input)
    assert.equal(r.status, 200, JSON.stringify(r))
    return r.value
  }
  const before = (await call('website.getEntry', { id: 'page-site-a' })).entry as Row
  const original = await call('website_studio.getResource', {
    siteId: 'site-a',
    kind: 'themes',
    id: 'site-a',
  })
  assert.equal(original.revisionId, 'initial')
  const request = {
    siteId: 'site-a',
    kind: 'themes',
    id: 'site-a',
    expectedRevisionId: 'initial',
    values: {
      preset: 'cosmetics',
      accent: 'orange',
      font: 'serif',
      spacing: 'compact',
      buttons: 'square',
      footer: 'Liên hệ Mộc Lan',
    },
  }
  assert.equal((await send(editor, 'website_studio.saveResource', request)).status, 403)
  const saved = await send(designer, 'website_studio.saveResource', request, 'style-save-1')
  assert.equal(saved.status, 200, JSON.stringify(saved))
  assert.equal(
    (await send(designer, 'website_studio.saveResource', request, 'style-save-1')).value.revisionId,
    saved.value.revisionId,
  )
  assert.notEqual(saved.value.revisionId, 'initial')
  assert.equal(
    (await send(designer, 'website_studio.saveResource', request)).status,
    400,
    'stale form cannot overwrite a newer style',
  )
  const history = await call('website_studio.entryHistory', { id: 'page-site-a', siteId: 'site-a' })
  const theme = (history.resources as Row[]).find((r) => r.kind === 'themes')!
  assert.equal(theme.footer, 'Liên hệ Mộc Lan')
  assert.equal(theme.preset, 'cosmetics')
  const preview = await call('website_studio.preview', { id: 'page-site-a', siteId: 'site-a' })
  assert.equal((preview.theme as Row).accent, 'orange')
  assert.equal(
    ((await call('website.getEntry', { id: 'page-site-a' })).entry as Row).revisionId,
    before.revisionId,
  )
  assert.equal(
    (
      await send(designer, 'website_studio.saveResource', {
        ...request,
        expectedRevisionId: saved.value.revisionId,
        values: { font: 'javascript:alert(1)' },
      })
    ).status,
    400,
  )
  assert.equal(
    (await send(designer, 'website_studio.saveResource', { ...request, siteId: 'site-b', id: 'site-b' }))
      .status,
    404,
  )
  const footer = await call('website_studio.saveResource', {
    ...request,
    expectedRevisionId: saved.value.revisionId,
    values: { footer: 'Chân trang mới' },
  })
  assert.equal(footer.font, 'serif')
  assert.equal(footer.footer, 'Chân trang mới')
  // Independent editors starting at one revision: exactly one update wins.
  const results = await Promise.all(
    ['A', 'B'].map((value) =>
      send(designer, 'website_studio.saveResource', {
        ...request,
        expectedRevisionId: footer.revisionId,
        values: { footer: value },
      }),
    ),
  )
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400])
  // One bundled preset per trade; anything else is refused by the resource schema.
  let revisionId = String(
    (await call('website_studio.getResource', { siteId: 'site-a', kind: 'themes', id: 'site-a' })).revisionId,
  )
  for (const preset of ['retail', 'restaurant', 'hotel', 'services']) {
    const next = await call('website_studio.saveResource', {
      ...request,
      expectedRevisionId: revisionId,
      values: { preset },
    })
    assert.equal(next.preset, preset)
    revisionId = String(next.revisionId)
  }
  assert.equal(
    (
      await send(designer, 'website_studio.saveResource', {
        ...request,
        expectedRevisionId: revisionId,
        values: { preset: 'spa' },
      })
    ).status,
    400,
  )
})
