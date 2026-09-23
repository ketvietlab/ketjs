// The areas form of a custom role: one expanded form, a row per area, and a box
// that ticks a whole row or a whole group. The view is render-pure, so it is read
// through the definition with a context standing in for the runtime; the runtime
// half — what an "all" box does to its form — is read from its source.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { roleModalDefinition } from '../packages/ketsuite/src/modules/user_backend/modal/role-modal-view.tsx'
import type { RoleModalData } from '../packages/ketsuite/src/modules/user_backend/modal/role-modal-view.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'

const render = (node: JSXChild): string => renderToString(<>{node}</>)
const runtime = readFileSync('packages/ketsuite/src/ui/client/record-modal.tsx', 'utf8')

const bundle = (module: string, capability: string, over: Record<string, unknown> = {}) => ({
  key: `${module}.${capability}`,
  short: capability,
  module,
  area: module.toUpperCase(),
  group: 'store',
  tone: null,
  held: false,
  ...over,
})

const dataOf = (bundles: Array<Record<string, unknown>>): RoleModalData => ({
  record: {
    id: 'lead',
    name: 'Trưởng cửa hàng',
    description: '',
    mode: 'custom',
    templateKey: null,
    templateVersion: null,
    revision: 1,
    healthy: true,
  },
  sources: [],
  bundles,
  groups: [
    { id: 'store', label: 'Cửa hàng' },
    { id: 'other', label: 'Khác' },
  ],
  holders: [],
  revision: 3,
  permissions: { grant: true, save: true },
  lang: 'vi',
})

/** `checks` is what the runtime kept from the form, by field name; anything absent falls back. */
const contextOf = (
  data: RoleModalData,
  checks: Record<string, boolean> = {},
): RecordModalContext<RoleModalData> => ({
  kind: 'user.role',
  id: data.record.id,
  creating: false,
  tab: 'permissions',
  data,
  t: (key) => key,
  fieldError: () => null,
  draft: (_name, fallback = '') => fallback,
  draftChecked: (name, _value = '1', fallback = false) => checks[name] ?? fallback,
  outcome: () => null,
  busy: false,
  dialog: null,
  href: () => '',
  state: (_key, fallback = '') => fallback,
})

const permissionsView = () => {
  const tab = (roleModalDefinition.tabs ?? []).find((item) => item.id === 'permissions')
  assert.ok(tab)
  return tab.view
}

/** Whether the checkbox with this exact name renders checked. */
const isChecked = (html: string, name: string): boolean => {
  const input = new RegExp(
    `<input[^>]*name="${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}"[^>]*>`,
    'u',
  ).exec(html)
  assert.ok(input, `a checkbox named ${name} is rendered`)
  return /\schecked(?:=|\s|>|\/)/u.test(input[0])
}

const POS = [
  bundle('pos', 'view', { held: true }),
  bundle('pos', 'refund', { held: true }),
  bundle('pos', 'configure', { tone: 'admin' }),
]
const PRICING = [bundle('pricing', 'view', { held: true })]

test('each row and each group leads with a box that stands for all of it', () => {
  const html = render(permissionsView()(contextOf(dataOf([...POS, ...PRICING]))))

  // The row box names the row by prefix; the colon keeps `stock:` from reaching `stock_staff_channel:`.
  assert.equal(isChecked(html, '__all:bundle:store:pos:'), false, 'POS is not all held')
  assert.equal(isChecked(html, '__all:bundle:store:pricing:'), true, 'Pricing is all held')
  assert.equal(isChecked(html, '__all:bundle:store:'), false, 'the store group is not all held')
  // Every bundle box sits under both prefixes, so either "all" box reaches it.
  assert.equal(isChecked(html, 'bundle:store:pos:pos.refund'), true)
  assert.ok(html.indexOf('__all:bundle:store:pos:') < html.indexOf('bundle:store:pos:pos.view'))
})

test('an all box reads full from what was ticked, not only from what is saved', () => {
  const ticked = {
    'bundle:store:pos:pos.configure': true,
  }
  const html = render(permissionsView()(contextOf(dataOf([...POS, ...PRICING]), ticked)))
  assert.equal(isChecked(html, '__all:bundle:store:pos:'), true)
  assert.equal(isChecked(html, '__all:bundle:store:'), true)

  // Clearing one box empties both boxes that stand over it, and the summary follows.
  const cleared = render(
    permissionsView()(
      contextOf(dataOf([...POS, ...PRICING]), { 'bundle:store:pricing:pricing.view': false }),
    ),
  )
  assert.equal(isChecked(cleared, '__all:bundle:store:pricing:'), false)
  assert.equal(isChecked(cleared, '__all:bundle:store:'), false)
})

test('a whole group ticked shows every row in it as whole, whatever those rows last showed', () => {
  // What the runtime keeps after "Cả nhóm": every bundle ticked, while each row's own
  // box was still unticked on screen when the form was read.
  const kept = {
    '__all:bundle:store:': true,
    '__all:bundle:store:pos:': false,
    '__all:bundle:store:pricing:': false,
    'bundle:store:pos:pos.view': true,
    'bundle:store:pos:pos.refund': true,
    'bundle:store:pos:pos.configure': true,
    'bundle:store:pricing:pricing.view': true,
  }
  const html = render(permissionsView()(contextOf(dataOf([...POS, ...PRICING]), kept)))
  assert.equal(isChecked(html, '__all:bundle:store:pos:'), true)
  assert.equal(isChecked(html, '__all:bundle:store:pricing:'), true)

  // And the other way: one bundle cleared under a whole group clears both boxes over it.
  const partial = render(
    permissionsView()(
      contextOf(dataOf([...POS, ...PRICING]), {
        ...kept,
        '__all:bundle:store:pos:': true,
        'bundle:store:pos:pos.refund': false,
      }),
    ),
  )
  assert.equal(isChecked(partial, '__all:bundle:store:pos:'), false)
  assert.equal(isChecked(partial, '__all:bundle:store:'), false)
})

test('saving sends the bundles ticked, never the all boxes', () => {
  const data = dataOf([...POS, ...PRICING])
  const form = new FormData()
  form.set('__all:bundle:store:pricing:', '1')
  form.set('bundle:store:pricing:pricing.view', '1')
  form.set('bundle:store:pos:pos.refund', '1')
  form.set('reason', 'Mở cửa hàng mới')
  const input = roleModalDefinition.commands!.setBundles!.input(form, contextOf(data), {})
  assert.deepEqual(input.bundleKeys, ['pos.refund', 'pricing.view'])
  assert.equal(input.reason, 'Mở cửa hàng mới')
})

test('the runtime ticks every enabled box under an all box, then re-renders from the form', () => {
  const branch = /if \(control\.name\.startsWith\(CHECK_ALL\)\) \{([\s\S]*?)\n {16}\}/u.exec(runtime)
  assert.ok(branch, 'the change handler has an all-box branch')
  assert.match(branch[1]!, /target\.name\.startsWith\(prefix\)/u)
  assert.match(branch[1]!, /!target\.disabled/u, 'a disabled box is never ticked on anyone’s behalf')
  assert.match(
    branch[1]!,
    /!target\.name\.startsWith\(CHECK_ALL\)/u,
    'an all box does not tick other all boxes',
  )
  // Any tick in a form with an all box is kept, so the boxes above it can read full or not.
  assert.match(runtime, /\}\n {16}keepAllDrafts\(\)\n {16}return/u)
})
