import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import type { TestClient } from '@ketvietlab/ketjs/testing'
import { websiteBackend, websiteRoleTemplates } from '@ketvietlab/ketsuite'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

const request = (client: TestClient, name: string, input: Row = {}, headers = {}) =>
  client.post(`/website/api/${name}`, JSON.stringify(input), {
    headers: { 'content-type': 'application/json', ...headers },
    redirect: 'manual',
  })
const value = async (client: TestClient, name: string, input: Row = {}) => {
  const response = await request(client, name, input)
  const body = (await response.json()) as { ok: boolean; value: Row }
  assert.equal(response.status, 200, JSON.stringify(body))
  assert.equal(body.ok, true)
  return body.value
}
const context = async (client: TestClient, company: string, branch = `root:${company}`) => {
  const response = await client.post(
    '/admin/context',
    new URLSearchParams({
      action: 'save',
      companyId: company,
      branchId: branch,
      'company.studio-a': '1',
      ...(company === 'studio-b' ? { 'company.studio-b': '1' } : {}),
      [`branch.${branch}`]: '1',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(response.status, 303, await response.text())
}

test('Website Studio foundation crosses ERP sessions, managed roles and active workplaces over HTTP', async (t) => {
  const { app, fixture, revision } = await bootWebsiteStudio()
  t.after(() => app.close())
  const login = async (name: string) => {
    const client = app.client.anonymous()
    await client.login({ login: `studio-${name}`, password: 'studio-local' })
    return client
  }
  const reader = await login('reader'),
    editor = await login('editor'),
    publisher = await login('publisher')
  await t.test('ERP launch and anonymous requests have the correct boundary', async () => {
    assert.equal(websiteBackend.menus?.website?.path, '/website')
    assert.deepEqual(websiteBackend.menus?.website?.for, ['website.saveEntry', 'website.publishEntry'])
    assert.deepEqual(websiteRoleTemplates['website.editor'].bundles, [
      'website_backend.view',
      'website.view',
      'website_menu.view',
      'website_form.view',
      'website.author',
      'website_menu.configure',
      'website_form.configure',
    ])
    const response = await app.client
      .anonymous()
      .get('/website/pages?site=site-a', { redirect: 'manual', headers: { accept: 'text/html' } })
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('location'), '/login?next=%2Fwebsite%2Fpages%3Fsite%3Dsite-a')
    assert.equal((await request(app.client.anonymous(), 'website_studio.bootstrap')).status, 401)
    const launch = await reader.get('/admin', { redirect: 'manual' })
    assert.equal(launch.status, 303)
    assert.equal(launch.headers.get('location'), '/website')
    const page = await reader.get('/website?site=site-a')
    assert.equal(page.status, 200)
    assert.match(await page.text(), /id="website-studio"/)
    const blocked = await login('blocked')
    assert.equal((await blocked.get('/website')).status, 403)
    assert.equal((await request(blocked, 'website_studio.bootstrap')).status, 403)
  })
  await t.test(
    'readonly/editor/publisher expose only their allowed capabilities and enforce writes',
    async () => {
      for (const [client, expected] of [
        [reader, []],
        [editor, ['website.content.write', 'website.form.manage']],
        [
          publisher,
          ['website.content.write', 'website.publish', 'website.form.manage', 'website.submission.manage'],
        ],
      ] as const) {
        const boot = await value(client, 'website_studio.bootstrap', { site: 'site-a' })
        assert.deepEqual((boot.actor as Row).capabilities, expected)
        assert.deepEqual((boot.sites as Row[]).map((s) => s.id).sort(), ['site-a', 'site-a2'])
        assert.equal(
          (await value(client, 'website_studio.bootstrap', { site: 'site-a2' })).site &&
            ((await value(client, 'website_studio.bootstrap', { site: 'site-a2' })).site as Row).id,
          'site-a2',
        )
      }
      const entry = (await value(editor, 'website.getEntry', { id: 'page-site-a' })).entry as Row
      const draft = { ...entry, title: 'Đã lưu qua HTTP', expectedRevisionId: entry.revisionId }
      assert.equal((await request(reader, 'website.saveEntry', draft)).status, 403)
      const saved = await value(editor, 'website.saveEntry', draft)
      const publish = { id: entry.id, expectedRevisionId: saved.revisionId, publishAt: null }
      assert.equal((await request(editor, 'website.publishEntry', publish)).status, 403)
      assert.equal((await request(reader, 'website.publishEntry', publish)).status, 403)
      assert.equal((await value(publisher, 'website.publishEntry', publish)).ok, true)
      assert.equal(
        ((await value(reader, 'website.getEntry', { id: entry.id })).entry as Row).title,
        draft.title,
      )
    },
  )
  await t.test('foreign sites and forged scope headers cannot escape the active company', async () => {
    for (const name of ['website_studio.bootstrap', 'website.listEntries']) {
      const response = await request(
        editor,
        name,
        name.endsWith('bootstrap') ? { site: 'site-b' } : { siteId: 'site-b', type: 'page' },
      )
      assert.equal(response.status, 404)
      assert.doesNotMatch(await response.text(), /Trang site-b/)
    }
    const forged = await request(
      editor,
      'website_studio.bootstrap',
      {},
      { 'x-ket-company': 'studio-b', 'x-ket-companies': 'studio-b' },
    )
    const boot = (await forged.json()).value
    assert.deepEqual(boot.sites.map((s: Row) => s.id).sort(), ['site-a', 'site-a2'])
    assert.equal(
      (
        await request(editor, 'website.saveEntry', {
          id: 'escape',
          siteId: 'site-b',
          type: 'page',
          title: 'escape',
          path: '/escape',
          layout: [],
          fields: {},
        })
      ).status,
      404,
    )
  })
  await t.test(
    'company switches recalculate grants and do not include other selected companies',
    async () => {
      const mover = await login('mover')
      await context(mover, 'studio-b')
      const boot = await value(mover, 'website_studio.bootstrap')
      assert.deepEqual(
        (boot.sites as Row[]).map((s) => s.id),
        ['site-b'],
      )
      assert.deepEqual((boot.actor as Row).capabilities, [])
      assert.equal((await request(mover, 'website_studio.bootstrap', { site: 'site-a' })).status, 404)
      const direct = await mover.call<Row>('website.getEntry', { id: 'page-site-a' })
      assert.ok(!direct.value?.entry, 'the domain API must also refuse a different selected company')
      await context(mover, 'studio-a')
      assert.deepEqual(((await value(mover, 'website_studio.bootstrap')).actor as Row).capabilities, [
        'website.content.write',
        'website.form.manage',
      ])
    },
  )
  await t.test('branch scoped editor grants follow the active branch', async () => {
    const client = await login('branch')
    assert.deepEqual(((await value(client, 'website_studio.bootstrap')).actor as Row).capabilities, [])
    await context(client, 'studio-a', 'studio-a:north')
    assert.deepEqual(((await value(client, 'website_studio.bootstrap')).actor as Row).capabilities, [
      'website.content.write',
      'website.form.manage',
    ])
    await context(client, 'studio-a')
    assert.deepEqual(((await value(client, 'website_studio.bootstrap')).actor as Row).capabilities, [])
  })
  await t.test('cross-site posts, unknown operations and live grant revocation are refused', async () => {
    assert.equal(
      (await request(editor, 'website_studio.bootstrap', {}, { origin: 'https://outside.example' })).status,
      403,
    )
    for (const operation of ['constructor', 'website.activatePublication'])
      assert.equal((await request(editor, operation)).status, 404)
    await fixture('user.unassignScopedRole', {
      userId: 'studio-reader',
      roleId: 'studio-reader',
      scopeKey: 'company:studio-a',
      expectedAuthorizationRevision: await revision(),
      idempotencyKey: 'revoke-reader',
    })
    assert.equal((await reader.get('/website')).status, 403)
    assert.equal((await request(reader, 'website_studio.bootstrap')).status, 403)
  })
})
