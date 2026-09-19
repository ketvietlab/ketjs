import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, defineModule, table } from '@ketvietlab/ketjs'
import type { Ctx, Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { housekeeping } from '../packages/ketsuite/src/modules/hospitality_core/housekeeping.ts'
import { cleaningTasksScreen } from '../packages/ketsuite/src/modules/hospitality_core/screens/cleaning-tasks.tsx'
import type { CleaningTaskRow } from '../packages/ketsuite/src/modules/hospitality_core/screens/shared.tsx'

const translate = ((key: string) =>
  ({
    'hospitality_core.cleaningState.todo': 'Pending cleaning',
    'hospitality_core.cleaningPriority.urgent': 'Urgent cleaning',
  })[key] ?? key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const manifest = compose([
  defineModule({
    name: 'hospitality_core',
    models: {
      CleaningTask: {
        scope: 'company',
        fields: {
          id: 'id',
          code: 'text',
          propertyId: 'id',
          roomId: 'id',
          state: 'text',
          priority: 'text',
          requestedAt: 'datetime',
          assigneeId: 'text?',
        },
      },
    },
  }),
])

test('cleaning list API supports offset with stable ordering and unchanged scoped filters', async () => {
  let query: { toSQL: () => { text: string; params: unknown[] } } | undefined
  const ctx = {
    table: (name: string) => table(manifest, name),
    db: {
      all: async (value: typeof query) => {
        query = value
        return []
      },
    },
  } as unknown as Ctx
  const args = {
    propertyId: 'hotel-authorized',
    roomId: 'room-1',
    state: 'todo',
    assigneeId: 'staff-1',
    limit: 500,
    offset: 500,
  }
  await housekeeping.listCleaningTasks.handler(ctx, args)
  assert.ok(query)
  const sql = query.toSQL()
  assert.deepEqual(sql.params, ['hotel-authorized', 'room-1', 'todo', 'staff-1', 500, 500])
  assert.match(sql.text, /"priority" DESC[\s\S]*"requestedAt" ASC[\s\S]*"id" ASC[\s\S]*LIMIT \? OFFSET \?/)
  assert.deepEqual(housekeeping.listCleaningTasks.effects, [
    'read:hospitality_core.CleaningTask',
    'read:hospitality_core.Room',
  ])
  assert.equal(housekeeping.listCleaningTasks.anonymous, undefined)
  assert.equal(housekeeping.listCleaningTasks.crossCompany, undefined)
  await housekeeping.listCleaningTasks.handler(ctx, { propertyId: 'hotel-authorized', offset: -5 })
  const defaultSql = query.toSQL()
  assert.deepEqual(defaultSql.params, ['hotel-authorized', 100, 0])
  assert.match(defaultSql.text, /"requestedAt" DESC[\s\S]*"id" DESC/)
})

const taskRows: CleaningTaskRow[] = Array.from({ length: 535 }, (_, index) => ({
  id: `task-${index + 1}`,
  code: `HK-${String(index + 1).padStart(4, '0')}`,
  propertyId: 'hotel-authorized',
  roomId: `room-${index + 1}`,
  room: { name: index >= 500 ? 'Late tower' : 'Early tower' },
  state: 'todo',
  priority: 'urgent',
  taskType: 'daily_clean',
  assigneeId: 'staff-1',
  requestedAt: '2026-09-19T01:00:00Z',
}))
const render = (rows: CleaningTaskRow[], url: string, canCreate = false) =>
  renderToString(
    cleaningTasksScreen(
      translate,
      {
        rows,
        properties: [],
        propertyId: 'hotel-authorized',
        state: 'todo',
        rooms: [],
        summary: { todo: 535, inProgress: 7, done: 11, cancelled: 3 },
        id: 'new-task',
        code: 'HK-NEW',
      },
      'en',
      'Asia/Ho_Chi_Minh',
      { collectionUrl: url },
      undefined,
      undefined,
      canCreate,
    ),
  )
const links = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/g)].map(
    (match) => new URL(match[1].replaceAll('&amp;', '&'), 'https://ket.test'),
  )

test('cleaning collection includes tasks after row 500 before searching, counting and paging', async () => {
  const { loadCollectionRows } = await import('../packages/ketsuite/src/modules/backend/collection-search.ts')
  const calls: number[] = []
  const complete = await loadCollectionRows(async ({ limit, offset }) => {
    calls.push(offset)
    return taskRows.slice(offset, offset + limit)
  })
  assert.deepEqual(calls, [0, 500])
  const html = render(
    complete,
    '/admin/hospitality/housekeeping?property=hotel-authorized&state=todo&q=Late%20tower&page=2&columns=code,room,status&lang=en',
  )
  assert.match(html, /31-35 \/ 35/)
  assert.match(html, /HK-0531/)
  assert.match(html, /HK-0535/)
  assert.doesNotMatch(html, /HK-0501|HK-0001|data-col="priority"/)
  const previous = links(html).find((url) => url.searchParams.get('page') === '1')
  assert.ok(previous)
  for (const [key, value] of Object.entries({
    property: 'hotel-authorized',
    state: 'todo',
    q: 'Late tower',
    columns: 'code,room,status',
    lang: 'en',
  }))
    assert.equal(previous.searchParams.get(key), value)
  assert.match(html, /name="q"[^>]*value="Late tower"/)
  assert.doesNotMatch(html, /create=1|hospitality-cleaning-task-create-form|kanban/)
  assert.match(html, /href="\/admin\/hospitality\/housekeeping\/tasks\/task-531\?lang=en"/)
})

test('cleaning search uses translated visible values and clamps an out-of-range page', () => {
  const html = render(
    taskRows,
    '/admin/hospitality/housekeeping?property=hotel-authorized&state=todo&q=Pending%20cleaning&page=999&lang=en',
  )
  assert.match(html, /511-535 \/ 535/)
  assert.match(html, /HK-0535/)
  assert.doesNotMatch(html, /HK-0001/)
  const empty = render(
    taskRows,
    '/admin/hospitality/housekeeping?property=hotel-authorized&state=todo&q=No%20match&lang=en',
  )
  assert.match(empty, /data-ui="pager-range">(?:<!--.*?-->)*0</)
  assert.doesNotMatch(empty, /data-ui="ket-table"/)
  assert.match(empty, /hospitality_core.screen.cleaningTasks.empty/)
})

test('cleaning route batches only an authorized property and retains state and creation permission', async () => {
  const { routes } = await import('../packages/ketsuite/src/modules/hospitality_core/routes.ts')
  const url = new URL(
    'https://ket.test/admin/hospitality/housekeeping?property=outside-access&state=todo&q=Late&lang=en',
  )
  const req = { method: 'GET', headers: {} } as Parameters<Route>[1]
  const reachedSecondBatch = new Error('Second cleaning batch observed')
  const batches: Array<Record<string, unknown>> = []
  const requested: string[] = []
  const ctx = {
    localeOf: () => 'en',
    translate: () => translate,
    allows: async () => false,
    call: async (
      name: string,
      args: Record<string, unknown>,
      calledUrl: URL,
      calledReq: Parameters<Route>[1],
    ) => {
      requested.push(name)
      assert.equal(calledUrl, url)
      assert.equal(calledReq, req)
      if (name === 'hospitality_core.listProperties') return [{ id: 'hotel-authorized' }]
      if (name === 'hospitality_core.cleaningTaskSummary')
        return { todo: 535, inProgress: 0, done: 0, cancelled: 0 }
      if (name === 'hospitality_core.listCleaningTasks') {
        batches.push(args)
        if (args.offset === 500) throw reachedSecondBatch
        return taskRows.slice(0, 500)
      }
      throw new Error(`Unexpected read ${name}`)
    },
  } as unknown as ServeContext
  const route = (routes['/admin/hospitality/housekeeping'] as (ctx: ServeContext) => Route)(ctx)
  await assert.rejects(
    async () => route(url, req, {}),
    (error: unknown) => error === reachedSecondBatch,
  )
  assert.deepEqual(batches, [
    { propertyId: 'hotel-authorized', state: 'todo', limit: 500, offset: 0 },
    { propertyId: 'hotel-authorized', state: 'todo', limit: 500, offset: 500 },
  ])
  assert.ok(!requested.includes('hospitality_core.listRooms'))
})
