import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website, websiteMenu } from '@ketvietlab/ketsuite'

/**
 * Reordering a menu meant opening each item and typing a number into
 * `position`. Nothing has ever enforced distinct positions and `addMenuItem`
 * defaults them all to zero, so the interesting cases are the degenerate ones.
 */

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

type Item = { id: string; label: string; position: number; parentId?: string | null }

const order = async (db: Adapter, parentId: string | null = null) =>
  ((await call(db, 'website_menu.listMenu', { siteId: 'site1' })) as Item[])
    .filter((row) => (row.parentId ?? null) === parentId)
    .map((row) => row.label)

const seed = async (db: Adapter, positions: Array<number | undefined> = [0, 1, 2]) => {
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Moc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
    active: true,
  })
  for (const [index, label] of ['A', 'B', 'C'].entries())
    await call(db, 'website_menu.addMenuItem', {
      id: `m${index}`,
      siteId: 'site1',
      label,
      href: `/${label.toLowerCase()}`,
      ...(positions[index] === undefined ? {} : { position: positions[index] }),
    })
}

test('menu: an item moves one place, and only its siblings shift', async () => {
  const db = await boot()
  await seed(db)
  assert.deepEqual(await order(db), ['A', 'B', 'C'])

  await call(db, 'website_menu.moveMenuItem', { id: 'm2', direction: 'up' })
  assert.deepEqual(await order(db), ['A', 'C', 'B'])

  await call(db, 'website_menu.moveMenuItem', { id: 'm2', direction: 'up' })
  assert.deepEqual(await order(db), ['C', 'A', 'B'])
})

test('menu: items that all sit at zero still reorder', async () => {
  // addMenuItem defaults position to 0 and nothing makes them distinct, so a
  // swap of two equal numbers would move nothing and look broken.
  const db = await boot()
  await seed(db, [undefined, undefined, undefined])
  assert.deepEqual(await order(db), ['A', 'B', 'C'])
  await call(db, 'website_menu.moveMenuItem', { id: 'm0', direction: 'down' })
  assert.deepEqual(await order(db), ['B', 'A', 'C'])
})

test('menu: the ends are where a move stops, not where it fails', async () => {
  const db = await boot()
  await seed(db)
  const first = (await call(db, 'website_menu.moveMenuItem', { id: 'm0', direction: 'up' })) as {
    ok?: boolean
  }
  assert.equal(first.ok, true, 'already at the top is the state the caller asked for')
  assert.deepEqual(await order(db), ['A', 'B', 'C'])

  const last = (await call(db, 'website_menu.moveMenuItem', { id: 'm2', direction: 'down' })) as {
    ok?: boolean
  }
  assert.equal(last.ok, true)
  assert.deepEqual(await order(db), ['A', 'B', 'C'])
})

test('menu: a child moves among its own siblings, never past its parent', async () => {
  const db = await boot()
  await seed(db)
  for (const [index, label] of ['x', 'y'].entries())
    await call(db, 'website_menu.addMenuItem', {
      id: `c${index}`,
      siteId: 'site1',
      label,
      href: `/${label}`,
      parentId: 'm0',
      position: index,
    })
  assert.deepEqual(await order(db, 'm0'), ['x', 'y'])

  await call(db, 'website_menu.moveMenuItem', { id: 'c1', direction: 'up' })
  assert.deepEqual(await order(db, 'm0'), ['y', 'x'])
  // Moving a child must not reshuffle the top level: a reparent is a different
  // decision and has its own field.
  assert.deepEqual(await order(db), ['A', 'B', 'C'])
})

test('menu: only up or down', async () => {
  const db = await boot()
  await seed(db)
  const result = (await call(db, 'website_menu.moveMenuItem', {
    id: 'm0',
    direction: 'sideways',
  })) as { ok?: boolean; errors?: Array<{ message?: string }> }
  assert.equal(result.ok, false)
  assert.equal(result.errors?.[0]?.message, 'website_menu.error.invalidDirection')
})

test('menu: the move has a route composed for it', async () => {
  const backend = (await import('@ketvietlab/ketsuite/backend')).default
  const { company, storage, websiteBackend, websiteForm, websiteSeo } = await import('@ketvietlab/ketsuite')
  const composed = compose([
    address,
    partner,
    company,
    storage,
    backend,
    website,
    websiteMenu,
    websiteSeo,
    websiteForm,
    websiteBackend,
    paperTheme,
  ])
  assert.ok(composed.routes['/admin/website/menus/{id}/move'], 'the button needs somewhere to post')
  assert.ok(composed.functions['website_menu.moveMenuItem'])
})
