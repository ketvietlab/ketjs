import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMenu, compose, defineModule, restrictManifest } from 'ketjs'

/** Composition reports every violation at once, so a test asks what is in the pile. */
const violations = (fn: () => unknown): Array<{ code: string; message: string }> => {
  try {
    fn()
  } catch (e) {
    return (e as { items?: Array<{ code: string; message: string }> }).items ?? []
  }
  throw new Error('expected compose to refuse')
}

const sales = defineModule({
  name: 'sales',
  functions: {
    listOrders: { effects: [], handler: () => [] },
    listQuotes: { effects: [], handler: () => [] },
  },
  menus: {
    sales: { label: 'menu.app', icon: 'S', sequence: 20 },
    'sales.orders': { parent: 'sales', label: 'menu.orders', icon: 'shopping-bag', sequence: 10 },
    'sales.list': { parent: 'sales.orders', label: 'menu.list', path: '/sales', needs: 'sales.listOrders' },
    'sales.quotes': {
      parent: 'sales.orders',
      label: 'menu.quotes',
      path: '/quotes',
      needs: 'sales.listQuotes',
      sequence: 5,
    },
  },
  messages: {
    vi: {
      'menu.app': 'Bán hàng',
      'menu.orders': 'Đơn hàng',
      'menu.list': 'Đơn hàng',
      'menu.quotes': 'Báo giá',
    },
  },
})

const admin = defineModule({
  name: 'admin',
  menus: {
    admin: { label: 'menu.app', sequence: 90 },
    'admin.settings': { parent: 'admin', label: 'menu.settings', path: '/admin' },
  },
})

test('menu: a module declares its entries and composition gathers them', () => {
  const m = compose([sales, admin])
  assert.equal(m.menus['sales.list']!.by, 'sales', 'every entry remembers who declared it')
  const tree = buildMenu(m)
  assert.deepEqual(
    tree.map((n) => n.id),
    ['sales', 'admin'],
    'sequence orders the apps',
  )
  assert.deepEqual(
    tree[0]!.children[0]!.children.map((n) => n.id),
    ['sales.quotes', 'sales.list'],
    'sequence orders inside a section too',
  )
  assert.equal(tree[0]!.icon, 'S', 'the root keeps the icon declared by its module')
  assert.equal(
    tree[0]!.children[0]!.icon,
    'shopping-bag',
    'a nested entry keeps the icon declared by its module too',
  )
})

test('menu: two modules cannot claim one id', () => {
  const other = defineModule({ name: 'other', menus: { sales: { label: 'x' } } })
  const [v] = violations(() => compose([sales, other]))
  assert.equal(v!.code, 'E_MENU_DUPLICATE')
  assert.match(v!.message, /"sales".*"other"|"other".*"sales"/, 'the message names both modules')
})

test('menu: hanging an entry under another module needs the dependency', () => {
  const rogue = defineModule({
    name: 'rogue',
    menus: { 'rogue.x': { parent: 'sales', label: 'x', path: '/x' } },
  })
  assert.equal(violations(() => compose([sales, rogue]))[0]!.code, 'E_MENU_NOT_DEPENDED')
})

test('menu: a parent nobody declared is refused at composition, not at render', () => {
  const orphan = defineModule({
    name: 'orphan',
    menus: { 'orphan.x': { parent: 'nowhere', label: 'x', path: '/x' } },
  })
  assert.equal(violations(() => compose([orphan]))[0]!.code, 'E_MENU_UNKNOWN_PARENT')
})

test('menu: what the viewer may not call, the viewer does not see', () => {
  const m = compose([sales, admin])
  const tree = buildMenu(m, { allow: ['sales.listQuotes'] })
  assert.deepEqual(
    tree[0]!.children[0]!.children.map((n) => n.id),
    ['sales.quotes'],
    'the entry behind a function they cannot call is gone',
  )

  const none = buildMenu(m, { allow: [] })
  assert.deepEqual(
    none.map((n) => n.id),
    ['admin'],
    'a section with nothing left under it goes, and so does the app above it',
  )
})

test('menu: an entry with no needs is visible to anyone who reaches the page', () => {
  const tree = buildMenu(compose([sales, admin]), { allow: [] })
  assert.equal(tree[0]!.children[0]!.path, '/admin')
})

test('menu: uninstalling a module takes its entries with it', () => {
  const m = compose([sales, admin])
  const live = restrictManifest(m, new Set(['admin']))
  assert.deepEqual(Object.keys(live.menus).sort(), ['admin', 'admin.settings'])
  assert.deepEqual(
    buildMenu(live).map((n) => n.id),
    ['admin'],
  )
})

test('menu: the branch leading to the open page is marked, all the way up', () => {
  const tree = buildMenu(compose([sales, admin]), { active: '/quotes' })
  assert.equal(tree[0]!.active, true, 'the app')
  assert.equal(tree[0]!.children[0]!.active, true, 'the section')
  assert.equal(tree[0]!.children[0]!.children.find((n) => n.id === 'sales.quotes')!.active, true)
  assert.equal(tree[0]!.children[0]!.children.find((n) => n.id === 'sales.list')!.active, false)
  assert.equal(tree[1]!.active, false, 'the other app is not')
})

test('menu: a detail subroute keeps the longest matching app branch active', () => {
  const tree = buildMenu(compose([sales, admin]), { active: '/quotes/q-42' })
  assert.equal(tree[0]!.active, true)
  assert.equal(tree[0]!.children[0]!.children.find((n) => n.id === 'sales.quotes')!.active, true)
  assert.equal(tree[1]!.active, false)
})

test('menu: labels resolve against the module that declared them', () => {
  const m = compose([sales, admin])
  const vi = m.messages?.['vi'] ?? {}
  const tree = buildMenu(m, { translate: (k) => (vi[k] as string | undefined) ?? k })
  assert.equal(tree[0]!.label, 'Bán hàng')
  assert.equal(tree[0]!.children[0]!.label, 'Đơn hàng')
  assert.equal(tree[1]!.label, 'menu.app', 'a module with no translation shows the key rather than crashing')
})

test('menu: a gate on a module this build does not ship hides the entry, quietly', () => {
  // backend gating its pages entry on website.listPages, in a build with no website.
  const gated = defineModule({
    name: 'gated',
    menus: {
      gated: { label: 'x' },
      'gated.pages': { parent: 'gated', label: 'p', path: '/p', needs: 'website.listPages' },
    },
  })
  const m = compose([gated])
  assert.deepEqual(
    buildMenu(m).map((n) => n.id),
    [],
    'nothing to lead to, so nothing shown',
  )
})

test('menu: a gate on a module that is here, naming a function that is not, is a typo', () => {
  const typo = defineModule({
    name: 'typo',
    depends: ['sales'],
    menus: { typo: { label: 'x', path: '/x', needs: 'sales.listOrdrs' } },
  })
  const [v] = violations(() => compose([sales, typo]))
  assert.equal(v!.code, 'E_MENU_UNKNOWN_FUNCTION')
  assert.match(v!.message, /"sales" does not declare/)
})

test('menu: the sidebar search keeps a branch that matches anywhere along it', () => {
  const m = compose([sales, admin])
  const vi = m.messages?.['vi'] ?? {}
  const t = (q: string) => buildMenu(m, { translate: (k) => (vi[k] as string | undefined) ?? k, q })

  const quotes = t('báo giá')
  assert.deepEqual(
    quotes.map((n) => n.id),
    ['sales'],
    'the app above the match survives',
  )
  assert.deepEqual(
    quotes[0]!.children[0]!.children.map((n) => n.id),
    ['sales.quotes'],
    'and its siblings do not — a leaf arrives with the words that explain where it lives',
  )

  assert.deepEqual(
    t('BÁO GIÁ').map((n) => n.id),
    ['sales'],
    'case does not matter',
  )
  assert.deepEqual(
    t('không có gì').map((n) => n.id),
    [],
    'nothing matching leaves nothing behind',
  )
  assert.deepEqual(
    t('').map((n) => n.id),
    ['sales', 'admin'],
    'an empty search is not a search',
  )
})
