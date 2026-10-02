import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website } from '@ketvietlab/ketsuite'

test('Studio cancels only the expected entry schedule, preserves live content and enforces access', async () => {
  const modules = [address, partner, website, paperTheme]
  const manifest = compose(modules)
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, manifest)
  registerFunctions(modules)
  const scope = { company: 'studio', branches: null }
  const call = async (name: string, input: Row) =>
    (await callFn(name, input, { adapter: db, manifest, scope })).value as Row
  try {
    await call('website.saveSite', {
      id: 'site',
      name: 'Studio',
      title: 'Studio',
      theme: 'theme_paper',
      defaultLocale: 'vi',
      active: true,
    })
    const entry = {
      id: 'page',
      siteId: 'site',
      type: 'website.page',
      slug: 'home',
      path: '/',
      title: 'Home',
      fields: {},
      layout: [{ type: 'website.rich_text', settings: { heading: 'Home', body: 'Content' } }],
    }
    const first = await call('website.saveEntry', entry)
    assert.equal(first.ok, true)
    const style = await call('website.saveStudioStyle', {
      siteId: 'site',
      expectedRevisionId: 'initial',
      values: { preset: 'cosmetics', footer: 'Published footer' },
    })
    await call('website.publishEntry', { id: entry.id, expectedRevisionId: first.revisionId })
    const publicPage = () => call('website.getEntryByPath', { siteId: 'site', path: '/' })
    assert.equal(((await publicPage()).appearance as Row).footer, 'Published footer')
    const nextStyle = await call('website.saveStudioStyle', {
      siteId: 'site',
      expectedRevisionId: style.revisionId,
      values: { footer: 'Scheduled footer' },
    })
    assert.equal(
      ((await publicPage()).appearance as Row).footer,
      'Published footer',
      'draft style stays private',
    )
    const second = await call('website.saveEntry', {
      ...entry,
      title: 'Draft',
      expectedRevisionId: first.revisionId,
    })
    await call('website.publishEntry', {
      id: entry.id,
      expectedRevisionId: second.revisionId,
      publishAt: new Date(Date.now() + 60_000).toISOString(),
    })
    await call('website.saveStudioStyle', {
      siteId: 'site',
      expectedRevisionId: nextStyle.revisionId,
      values: { footer: 'Later draft' },
    })
    const scheduledRow = (await db.all('SELECT * FROM website_entry WHERE id = ?', [entry.id]))[0]!
    const scheduledAppearance =
      typeof scheduledRow.scheduledAppearance === 'string'
        ? JSON.parse(scheduledRow.scheduledAppearance)
        : scheduledRow.scheduledAppearance
    assert.equal(scheduledAppearance.footer, 'Scheduled footer')
    assert.equal(((await publicPage()).appearance as Row).footer, 'Published footer')
    const input = {
      id: entry.id,
      expectedRevisionId: second.revisionId,
      expectedScheduledRevisionId: second.revisionId,
    }
    await assert.rejects(
      () => callFn('website.cancelScheduledEntry', input, { adapter: db, manifest, scope, allow: [] }),
      { code: 'E_FN_NOT_PERMITTED' },
    )
    const foreign = (
      await callFn('website.cancelScheduledEntry', input, {
        adapter: db,
        manifest,
        scope: { company: 'other', branches: null },
      })
    ).value as Row
    assert.equal(foreign.ok, false)
    assert.equal(
      (
        await call('website.cancelScheduledEntry', {
          ...input,
          expectedScheduledRevisionId: first.revisionId,
        })
      ).ok,
      false,
    )
    assert.equal(
      (await call('website.cancelScheduledEntry', { ...input, expectedRevisionId: first.revisionId })).ok,
      false,
    )
    assert.equal((await call('website.cancelScheduledEntry', input)).ok, true)
    const row = (await db.all('SELECT * FROM website_entry WHERE id = ?', [entry.id]))[0]!
    assert.equal(row.publishedRevisionId, first.revisionId)
    assert.equal(row.currentRevisionId, second.revisionId)
    assert.equal(row.publishAt, null)
    assert.equal(row.scheduledRevisionId, null)
    assert.equal(row.status, 'published')
    assert.equal(row.scheduledAppearance, null)
    assert.equal(((await publicPage()).appearance as Row).footer, 'Published footer')
    await call('website.publishEntry', { id: entry.id, expectedRevisionId: second.revisionId })
    assert.equal(((await publicPage()).appearance as Row).footer, 'Later draft')
    await call('website.unpublishEntry', { id: entry.id })
    assert.equal(await publicPage(), null)
    const unpublished = (await db.all('SELECT * FROM website_entry WHERE id = ?', [entry.id]))[0]!
    assert.equal(unpublished.publishedAppearance, null)
  } finally {
    await db.close()
  }
})
