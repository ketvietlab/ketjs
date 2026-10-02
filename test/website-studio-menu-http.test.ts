import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

test('Studio menu edits the native navigation tree atomically with revision CAS and ERP grants', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  const login = async (name: string) => {
    const client = app.client.anonymous()
    await client.login({ login: `studio-${name}`, password: 'studio-local' })
    return client
  }
  const editor = await login('editor')
  const reader = await login('reader')
  const send = async (client: typeof editor, fn: string, input: Row) => {
    const response = await client.post('/website/api/' + fn, JSON.stringify(input), {
      headers: { 'content-type': 'application/json' },
    })
    return { status: response.status, ...((await response.json()) as { value: Row; message?: string }) }
  }
  const call = async (fn: string, input: Row, client = editor) => {
    const r = await send(client, fn, input)
    assert.equal(r.status, 200, JSON.stringify(r))
    return r.value
  }
  const menu = (client = editor) =>
    call('website_studio.getResource', { siteId: 'site-a', kind: 'menus', id: 'site-a' }, client)
  const save = (expectedRevisionId: unknown, items: Row[], client = editor, extra: Row = {}) =>
    send(client, 'website_studio.saveResource', {
      siteId: 'site-a',
      kind: 'menus',
      id: 'site-a',
      expectedRevisionId,
      values: { title: 'Menu chính', position: 'header', locale: 'vi', items, ...extra },
    })
  const tree = [
    { id: 'm-home', label: 'Trang chủ', href: '/', parentId: null },
    { id: 'm-about', label: 'Giới thiệu', href: '/gioi-thieu', parentId: null },
    { id: 'm-team', label: 'Đội ngũ', href: '/doi-ngu', parentId: 'm-about' },
    { id: 'm-shop', label: 'Cửa hàng', href: 'https://shop.example.test/', parentId: null },
  ]
  const shape = (items: unknown) =>
    (items as Row[]).map((i) => `${i.id}<${i.parentId ?? ''}>@${i.position}`).join(' ')

  const list = await call('website_studio.listResources', { siteId: 'site-a', kind: 'menus' }, reader)
  assert.equal(list.creatable, false, 'one native menu per site: no create action')
  assert.deepEqual(
    (list.rows as Row[]).map((r) => [r.id, r.position, r.revisionId, r.archivable]),
    [['site-a', 'header', 'initial', false]],
  )
  assert.equal((await save('initial', tree, reader)).status, 403, 'reader cannot arrange navigation')

  const saved = await save('initial', tree)
  assert.equal(saved.status, 200, JSON.stringify(saved))
  assert.notEqual(saved.value.revisionId, 'initial')
  assert.equal(shape(saved.value.items), 'm-home<>@0 m-about<>@1 m-team<m-about>@2 m-shop<>@3')
  const read = await menu(reader)
  assert.equal(read.title, 'Menu chính')
  assert.deepEqual(
    (read.warnings as Row[]).map((w) => `${w.target}:${w.state}`),
    ['/:draft', '/gioi-thieu:missing', '/doi-ngu:missing'],
    'links to unpublished pages are reported, not refused',
  )

  await t.test('a stale or invalid tree changes nothing', async () => {
    const stale = await save('initial', tree.slice(0, 1))
    assert.deepEqual(
      [stale.status, stale.message],
      [400, 'Nội dung đã thay đổi ở nơi khác. Hãy tải lại trước khi lưu.'],
    )
    const revisionId = saved.value.revisionId
    for (const [items, message] of [
      [
        [
          { id: 'a', label: 'A', href: '/a', parentId: 'b' },
          { id: 'b', label: 'B', href: '/b', parentId: 'a' },
        ],
        'Cấu trúc menu tạo thành vòng lặp.',
      ],
      [[{ id: 'a', label: 'A', href: '/a', parentId: 'missing' }], 'Mục cha không có trong menu này.'],
      [
        [
          { id: 'a', label: 'A', href: '/a', parentId: 'b' },
          { id: 'b', label: 'B', href: '/b', parentId: 'missing' },
        ],
        'Mục cha không có trong menu này.',
      ],
      [
        [{ id: 'a', label: 'A', href: 'javascript:alert(1)', parentId: null }],
        'Liên kết phải là đường dẫn trong website hoặc địa chỉ http(s).',
      ],
      [
        [{ id: 'a', label: ' ', href: '/a', parentId: null }],
        'Tên mục menu không được để trống và tối đa 200 ký tự.',
      ],
      [
        [
          { id: 'a', label: 'A', href: '/a', parentId: null },
          { id: 'a', label: 'A2', href: '/a2', parentId: null },
        ],
        'Mục menu không hợp lệ.',
      ],
      [
        Array.from({ length: 101 }, (_, i) => ({ id: `x${i}`, label: 'X', href: '/x', parentId: null })),
        'Menu có tối đa 100 mục.',
      ],
    ] as const) {
      const refused = await save(revisionId, items as unknown as Row[])
      assert.deepEqual([refused.status, refused.message], [400, message])
    }
    assert.equal((await save(revisionId, tree, editor, { position: 'footer' })).status, 400, 'footer')
    const current = await menu()
    assert.equal(current.revisionId, revisionId)
    assert.equal(shape(current.items), shape(saved.value.items))
    assert.equal(
      (
        await send(editor, 'website_studio.saveResource', {
          siteId: 'site-b',
          kind: 'menus',
          id: 'site-b',
          expectedRevisionId: 'initial',
          values: { items: [] },
        })
      ).status,
      404,
      'another company site is not addressable',
    )
  })

  await t.test('a drag that moves a branch saves order and parent together', async () => {
    const current = await menu()
    // Đội ngũ moves to the top level before Trang chủ; Cửa hàng moves under Giới thiệu.
    const moved = await save(current.revisionId, [
      { id: 'm-team', label: 'Đội ngũ', href: '/doi-ngu', parentId: null },
      { id: 'm-home', label: 'Trang chủ', href: '/', parentId: null },
      { id: 'm-about', label: 'Giới thiệu', href: '/gioi-thieu', parentId: null },
      { id: 'm-shop', label: 'Cửa hàng', href: 'https://shop.example.test/', parentId: 'm-about' },
    ])
    assert.equal(moved.status, 200, JSON.stringify(moved))
    const after = await menu(reader)
    assert.equal(shape(after.items), 'm-team<>@0 m-home<>@1 m-about<>@2 m-shop<m-about>@3')
    const visitor = (await fixture('website_menu.publicMenu', { siteId: 'site-a' })) as unknown as Row[]
    assert.equal(shape(visitor), shape(after.items), 'visitors read what the Studio saved')
    const history = await call('website_studio.entryHistory', { id: 'page-site-a', siteId: 'site-a' })
    const header = (history.resources as Row[]).find((r) => r.kind === 'menus')!
    assert.equal(header.position, 'header')
    assert.equal(shape(header.items), shape(after.items), 'the builder frame reads the same tree')
  })

  await t.test('two editors from one revision: exactly one replaces the tree', async () => {
    const current = await menu()
    const results = await Promise.all(
      ['A', 'B'].map((label) =>
        save(current.revisionId, [{ id: `m-${label}`, label, href: '/', parentId: null }]),
      ),
    )
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400])
    assert.equal(((await menu()).items as Row[]).length, 1)
  })

  await t.test('older menu functions move the revision, so an open form cannot overwrite them', async () => {
    const current = await menu()
    await fixture('website_menu.addMenuItem', { id: 'm-legacy', siteId: 'site-a', label: 'Cũ', href: '/cu' })
    assert.equal((await save(current.revisionId, [])).status, 400)
    assert.ok(((await menu()).items as Row[]).some((i) => i.id === 'm-legacy'))
  })

  await t.test('an item id from another site is refused instead of moved', async () => {
    const other = await send(editor, 'website_studio.saveResource', {
      siteId: 'site-a2',
      kind: 'menus',
      id: 'site-a2',
      expectedRevisionId: 'initial',
      values: { items: [{ id: 'm-legacy', label: 'Chiếm', href: '/', parentId: null }] },
    })
    assert.equal(other.status, 400)
    assert.equal(other.message, 'Không thể chuyển dữ liệu sang website khác.')
    assert.ok(((await menu()).items as Row[]).some((i) => i.id === 'm-legacy' && i.label === 'Cũ'))
  })
})

test('Studio navigation reaches visitors on save even when an older publication froze a menu', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'menu-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  await fixture('website_menu.addMenuItem', { id: 'frozen', siteId: 'site-a', label: 'Đóng băng', href: '/' })
  // The native presenter serves entries published with a style snapshot.
  await fixture('website.saveStudioStyle', {
    siteId: 'site-a',
    expectedRevisionId: 'initial',
    values: { footer: 'Chân trang' },
  })
  const entry = (await fixture('website.getEntry', { id: 'page-site-a' })).entry as Row
  await fixture('website.publishEntry', { id: 'page-site-a', expectedRevisionId: entry.currentRevisionId })
  const snapshot = await fixture('website_menu.snapshotMenu', { siteId: 'site-a' })
  await fixture('website.preparePublication', {
    id: 'legacy-publication',
    siteId: 'site-a',
    entryIds: ['page-site-a'],
    attachments: { website_menu: snapshot },
  })
  await fixture('website.activatePublication', { id: 'legacy-publication' })
  const labels = async () =>
    ((await fixture('website_menu.publicMenu', { siteId: 'site-a' })) as unknown as Row[]).map((i) => i.label)
  assert.deepEqual(await labels(), ['Đóng băng'], 'before the Studio owns it, the frozen menu is served')

  const editor = app.client.anonymous()
  await editor.login({ login: 'studio-editor', password: 'studio-local' })
  const response = await editor.post(
    '/website/api/website_studio.saveResource',
    JSON.stringify({
      siteId: 'site-a',
      kind: 'menus',
      id: 'site-a',
      expectedRevisionId: 'initial',
      values: {
        items: [
          { id: 'parent', label: 'Dịch vụ', href: '/', parentId: null },
          { id: 'child', label: 'Chăm sóc da', href: '/cham-soc-da', parentId: 'parent' },
        ],
      },
    }),
    { headers: { 'content-type': 'application/json' } },
  )
  assert.equal(response.status, 200, await response.text())
  assert.deepEqual(await labels(), ['Dịch vụ', 'Chăm sóc da'])
  const page = (await (await app.client.anonymous().get('/')).text()).replace(/<!--.*?-->/g, '')
  assert.match(
    page,
    /<li><a href="\/"[^>]*>Dịch vụ<\/a><ul><li><a href="\/cham-soc-da"[^>]*>Chăm sóc da<\/a>/,
  )
  assert.doesNotMatch(page, /Đóng băng/)
})

test('legacy items sharing a position read in the same order in the Studio and on the public site', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  // addMenuItem without a position stores 0 for every item; insert against id order so
  // storage order and id order disagree.
  for (const [id, label] of [
    ['c-home', 'Trang chủ'],
    ['b-services', 'Dịch vụ'],
    ['a-contact', 'Liên hệ'],
  ])
    await fixture('website_menu.addMenuItem', { id, siteId: 'site-a', label, href: '/' })
  const studio = ((await fixture('website_menu.menuState', { siteId: 'site-a' })).items as Row[]).map(
    (i) => i.label,
  )
  const visitors = ((await fixture('website_menu.publicMenu', { siteId: 'site-a' })) as unknown as Row[]).map(
    (i) => i.label,
  )
  assert.deepEqual(visitors, studio, 'saving the Studio tree unchanged must not reorder the public menu')
})
