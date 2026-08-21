import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compileListFilter,
  compose,
  defineListSearch,
  defineModule,
  encodeListState,
  eq,
  parseListState,
  table,
} from '@ketvietlab/ketjs'
import type { FilterNode, ListState } from '@ketvietlab/ketjs'

const model = defineModule({
  name: 'searchable',
  models: {
    Item: {
      scope: 'shared',
      fields: { id: 'id', name: 'text', kind: 'text', amount: 'int', active: 'bool', createdAt: 'datetime?' },
    },
  },
})
const manifest = compose([model])
const I = table(manifest, 'searchable.Item')
const spec = defineListSearch({
  key: 'items',
  searchable: [{ key: 'name', col: I.name! }],
  filterable: [
    { key: 'name', label: 'Name', col: I.name!, type: 'text' },
    { key: 'kind', label: 'Kind', col: I.kind!, type: 'selection', choices: ['a', 'b'] },
    { key: 'amount', label: 'Amount', col: I.amount!, type: 'number' },
    { key: 'active', label: 'Active', col: I.active!, type: 'boolean' },
  ],
  groupable: [
    { key: 'kind', label: 'Kind', col: I.kind! },
    { key: 'createdAt', label: 'Created', col: I.createdAt!, intervals: ['day', 'month', 'year'] },
  ],
  sortable: [{ key: 'name', label: 'Name', col: I.name! }],
  presets: [
    { key: 'a', label: 'A', group: 'kind', expr: eq(I.kind!, 'a') },
    { key: 'b', label: 'B', group: 'kind', expr: eq(I.kind!, 'b') },
    { key: 'active', label: 'Active', group: 'state', expr: eq(I.active!, true) },
  ],
  defaultSort: [{ key: 'name', dir: 'asc' }],
})

const state = (filters: FilterNode[] = []): ListState => ({
  q: '100%_safe',
  presets: ['a', 'b', 'active'],
  filters,
  groupBy: [{ key: 'createdAt', interval: 'month' }],
  sort: [{ key: 'name', dir: 'desc' }],
  openGroups: [['2026-08']],
  groupPages: { x: 2 },
  page: 3,
  includeArchived: true,
})

test('list search: canonical URL round-trips nested filters and group state', () => {
  const original = state([
    {
      kind: 'group',
      op: 'or',
      children: [
        { kind: 'rule', field: 'amount', operator: 'gte', value: 10 },
        { kind: 'rule', field: 'kind', operator: 'equals', value: 'b' },
      ],
    },
  ])
  const href = encodeListState(original, 'http://x/items?lang=vi&junk=kept')
  const parsed = parseListState(spec, new URL(href, 'http://x'))
  assert.deepEqual(parsed.state, original)
  assert.match(href, /lang=vi/)
  assert.match(href, /junk=kept/)
})

test('list search: same preset group is OR, other groups and custom rules are AND', () => {
  const expr = compileListFilter(
    spec,
    state([{ kind: 'rule', field: 'amount', operator: 'gte', value: 10 }]),
  )!
  assert.equal(expr.op, 'and')
  const json = JSON.stringify(expr)
  assert.match(json, /"op":"or".*"value":"a".*"value":"b"/)
  assert.match(json, /"value":true/)
  assert.match(json, /"value":10/)
})

test('list search: contains is case-insensitive and escapes SQL wildcard input', () => {
  const expr = compileListFilter(spec, state())!
  const json = JSON.stringify(expr)
  assert.match(json, /100\\\\%\\\\_safe/)
  assert.match(json, /"insensitive":true/)
  assert.match(json, /"escape":true/)
})

test('list search: a local datetime day compiles to a UTC half-open range across DST', () => {
  const withDatetime = defineListSearch({
    ...spec,
    key: 'items-datetime',
    filterable: [{ key: 'createdAt', label: 'Created', col: I.createdAt!, type: 'datetime' }],
  })
  const next = state([{ kind: 'rule', field: 'createdAt', operator: 'equals', value: '2026-03-08' }])
  next.q = undefined
  next.presets = []
  const expr = compileListFilter(withDatetime, next, { timezone: 'America/New_York' })!
  const json = JSON.stringify(expr)
  assert.match(json, /2026-03-08T05:00:00\.000Z/)
  assert.match(json, /2026-03-09T04:00:00\.000Z/)
})

test('list search: stale URL fields are dropped while invalid custom filters are rejected', () => {
  const parsed = parseListState(spec, new URL('/items?group=ghost&preset=nope&sort=wat:up', 'http://x'))
  assert.deepEqual(parsed.state.groupBy, [])
  assert.deepEqual(parsed.state.presets, [])
  assert.equal(parsed.warnings.length, 3)
  assert.throws(
    () => compileListFilter(spec, state([{ kind: 'rule', field: 'ghost', operator: 'equals', value: 1 }])),
    (error: unknown) => (error as { code?: string }).code === 'E_LIST_FILTER',
  )
})

test('list search: nesting and rule limits are enforced server-side', () => {
  let node: FilterNode = { kind: 'rule', field: 'active', operator: 'isTrue' }
  for (let i = 0; i < 4; i++) node = { kind: 'group', op: 'and', children: [node] }
  assert.throws(
    () => compileListFilter(spec, state([node])),
    (error: unknown) => (error as { code?: string }).code === 'E_LIST_FILTER',
  )
})
