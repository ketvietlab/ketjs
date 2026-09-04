import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website, websiteMenu } from '@ketvietlab/ketsuite'

const SCOPE = { company: 'acme', branches: null }
const modules = [address, partner, website, websiteMenu, paperTheme]
const manifest = compose(modules)

const boot = async (): Promise<Adapter> => {
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, manifest)
  registerFunctions(modules)
  return db
}

const call = async (db: Adapter, name: string, input: Record<string, unknown>) =>
  (await callFn(name, input, { adapter: db, manifest, scope: SCOPE })).value

type Result = { ok?: boolean; id?: string; errors?: Array<{ field: string; message: string }> }

const seedSite = async (db: Adapter) => {
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
}

const addItem = async (db: Adapter, id: string, extra: Record<string, unknown> = {}) =>
  (await call(db, 'website_menu.addMenuItem', {
    id,
    siteId: 'site1',
    label: id,
    href: `/${id}`,
    ...extra,
  })) as Result

test('menu: a two-step cycle is refused, not only self-parenting', async () => {
  const db = await boot()
  await seedSite(db)
  assert.equal((await addItem(db, 'a')).ok, true)
  assert.equal((await addItem(db, 'b', { parentId: 'a' })).ok, true)

  // Closing the loop: a's parent becomes b, whose ancestor is already a.
  const cycle = await addItem(db, 'a', { parentId: 'b' })
  assert.equal(cycle.ok, false)
  assert.equal(cycle.errors?.[0]?.field, 'parentId')
  assert.equal(cycle.errors?.[0]?.message, 'website_menu.error.menuCycle')
})

test('menu: a longer cycle is refused too', async () => {
  const db = await boot()
  await seedSite(db)
  await addItem(db, 'a')
  await addItem(db, 'b', { parentId: 'a' })
  await addItem(db, 'c', { parentId: 'b' })

  const cycle = await addItem(db, 'a', { parentId: 'c' })
  assert.equal(cycle.ok, false)
  assert.equal(cycle.errors?.[0]?.message, 'website_menu.error.menuCycle')
})

test('menu: self-parenting stays refused', async () => {
  const db = await boot()
  await seedSite(db)
  await addItem(db, 'a')
  const self = await addItem(db, 'a', { parentId: 'a' })
  assert.equal(self.ok, false)
  assert.equal(self.errors?.[0]?.message, 'website_menu.error.menuCycle')
})

test('menu: a parent on another site is still refused', async () => {
  const db = await boot()
  await seedSite(db)
  await call(db, 'website.saveSite', {
    id: 'site2',
    name: 'an-nhien',
    title: 'An Nhiên',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  await call(db, 'website_menu.addMenuItem', {
    id: 'other',
    siteId: 'site2',
    label: 'other',
    href: '/other',
  })
  const crossSite = await addItem(db, 'a', { parentId: 'other' })
  assert.equal(crossSite.ok, false)
  assert.equal(crossSite.errors?.[0]?.message, 'website.error.invalidParent')
})

test('menu: deleting a parent does not orphan its children', async () => {
  const db = await boot()
  await seedSite(db)
  await addItem(db, 'a')
  await addItem(db, 'b', { parentId: 'a' })

  const blocked = (await call(db, 'website_menu.removeMenuItem', { id: 'a' })) as Result
  assert.equal(blocked.ok, false)
  assert.equal(blocked.errors?.[0]?.message, 'website_menu.error.menuInUse')

  const items = (await call(db, 'website_menu.listMenu', { siteId: 'site1' })) as Array<{ id: string }>
  assert.equal(items.length, 2, 'a refused delete removes nothing')

  // Remove the child first, then the parent is deletable.
  assert.equal(((await call(db, 'website_menu.removeMenuItem', { id: 'b' })) as Result).ok, true)
  assert.equal(((await call(db, 'website_menu.removeMenuItem', { id: 'a' })) as Result).ok, true)
  assert.deepEqual(await call(db, 'website_menu.listMenu', { siteId: 'site1' }), [])
})

test('menu: removing an item that is already gone reports success', async () => {
  const db = await boot()
  await seedSite(db)
  const gone = (await call(db, 'website_menu.removeMenuItem', { id: 'missing' })) as Result
  assert.equal(gone.ok, true)
})

test('menu: a valid nested tree still saves', async () => {
  const db = await boot()
  await seedSite(db)
  assert.equal((await addItem(db, 'a', { position: 0 })).ok, true)
  assert.equal((await addItem(db, 'b', { parentId: 'a', position: 1 })).ok, true)
  assert.equal((await addItem(db, 'c', { parentId: 'b', position: 2 })).ok, true)
  const items = (await call(db, 'website_menu.listMenu', { siteId: 'site1' })) as Array<{
    id: string
    parentId: string | null
  }>
  assert.deepEqual(
    items.map((i) => [i.id, i.parentId]),
    [
      ['a', null],
      ['b', 'a'],
      ['c', 'b'],
    ],
  )
})

/** Write a row the way the orphaning delete this module used to allow. */
const orphan = async (db: Adapter, id: string) => {
  await db.run(`DELETE FROM ${db.quoteIdent('website_menu_menu_item')} WHERE ${db.quoteIdent('id')} = ?`, [
    id,
  ])
}

test('menu: damage further up does not block editing a descendant', async () => {
  const db = await boot()
  await seedSite(db)
  await addItem(db, 'a')
  await addItem(db, 'b', { parentId: 'a' })
  await addItem(db, 'c', { parentId: 'b' })
  // `a` disappears the way the previous delete allowed, leaving b.parentId dangling.
  await orphan(db, 'a')

  // Renaming c must still work: its own parent, b, exists and is on this site.
  // Walking the whole chain would report parentId invalid while naming a parent
  // that is fine, with nothing pointing at the row that actually needs repair.
  const renamed = await addItem(db, 'c', { parentId: 'b', label: 'Chuyện trà' })
  assert.equal(renamed.ok, true)

  // And a brand-new leaf under the same subtree.
  const added = await addItem(db, 'd', { parentId: 'c' })
  assert.equal(added.ok, true)
})

test('menu: a loop that already existed above is not reported as too deep', async () => {
  const db = await boot()
  await seedSite(db)
  await addItem(db, 'a')
  await addItem(db, 'b', { parentId: 'a' })
  // Close a loop between a and b directly in storage, as older data can hold.
  await db.run(
    `UPDATE ${db.quoteIdent('website_menu_menu_item')} SET ${db.quoteIdent('parentId')} = ? WHERE ${db.quoteIdent('id')} = ?`,
    ['b', 'a'],
  )
  const added = await addItem(db, 'c', { parentId: 'b' })
  assert.equal(added.ok, true, 'a two-item menu must not answer "nested too deeply"')
})

test('menu: the depth cap is the documented number of ancestors', async () => {
  const db = await boot()
  await seedSite(db)
  await addItem(db, 'n0')
  for (let i = 1; i <= 99; i += 1) {
    const step = await addItem(db, `n${i}`, { parentId: `n${i - 1}` })
    assert.equal(step.ok, true, `n${i} should save`)
  }
  // n99 has 99 ancestors; n100 has 100, the documented maximum.
  const atCap = await addItem(db, 'n100', { parentId: 'n99' })
  assert.equal(atCap.ok, true, '100 ancestors is the cap, not one past it')

  const past = await addItem(db, 'n101', { parentId: 'n100' })
  assert.equal(past.ok, false)
  assert.equal(past.errors?.[0]?.message, 'website_menu.error.menuTooDeep')
})

test('menu: an editor without site membership cannot change the tree', async () => {
  const db = await boot()
  await seedSite(db)
  await addItem(db, 'a')

  // With an actor present, site membership is a second boundary after the
  // framework's function grants. None of the other tests reach this branch.
  const denied = (
    await callFn(
      'website_menu.addMenuItem',
      { id: 'x', siteId: 'site1', label: 'x', href: '/x' },
      { adapter: db, manifest, scope: SCOPE, actor: 'stranger' },
    )
  ).value as Result
  assert.equal(denied.ok, false)
  assert.equal(denied.errors?.[0]?.message, 'website.error.forbidden')

  const removal = (
    await callFn(
      'website_menu.removeMenuItem',
      { id: 'a' },
      { adapter: db, manifest, scope: SCOPE, actor: 'stranger' },
    )
  ).value as Result
  assert.equal(removal.ok, false)
  assert.equal(removal.errors?.[0]?.message, 'website.error.forbidden')
})
