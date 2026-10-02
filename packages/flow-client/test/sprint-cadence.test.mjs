import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { createFlowWorkspace } from '@ketvietlab/flow-client/workspace.mjs'
import { createFnClient } from '@ketvietlab/flow-client/api.mjs'
import {
  sprintCadence,
  validCadence,
  nextSprint,
  overlappingSprint,
  DEFAULT_CADENCE,
} from '@ketvietlab/flow-client/sprint-cadence.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
setFlowLocale('en')
// Thursday. The form proposes dates from the clock, so pin it.
const TODAY = '2026-09-24'
mock.timers.enable({ apis: ['Date'], now: Date.parse(TODAY + 'T05:00:00Z') })

globalThis.window = new EventTarget()
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
}
globalThis.history = { state: null, pushState() {}, replaceState() {}, back() {} }
const root = () =>
  Object.assign(new EventTarget(), {
    ownerDocument: new EventTarget(),
    querySelector: () => null,
    querySelectorAll: () => [],
  })
const tick = () => new Promise((r) => setTimeout(r, 5))
const handlers = (node, marker, event, out = []) => {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const x of node) handlers(x, marker, event, out)
    return out
  }
  if (node.items && node.render)
    return handlers(
      node.items.map((x, i) => node.render(x, i)),
      marker,
      event,
      out,
    )
  if (!node.strings) return out
  let open = ''
  for (let i = 0; i < node.values.length; i++) {
    open = node.strings[i].includes('<')
      ? node.strings[i].slice(node.strings[i].lastIndexOf('<'))
      : open + node.strings[i]
    if (typeof node.values[i] === 'string' || typeof node.values[i] === 'number') open += node.values[i]
    if (
      open.includes(marker) &&
      node.strings[i].endsWith(`on:${event}=`) &&
      typeof node.values[i] === 'function'
    )
      out.push(node.values[i])
    else handlers(node.values[i], marker, event, out)
  }
  return out
}
const call =
  (session) =>
  (name, args = {}) => {
    const r = session.call(name, { companyId: 'demo', ...args })
    return r.value?.ok === false ? r.value.errors[0] : r.value
  }
const newProject = (c, code, extra = {}) =>
  c('flow.entity.save', {
    collection: 'projects',
    workspaceId: 'product',
    title: 'Project ' + code,
    code,
    access: 'workspace',
    idempotencyKey: 'create-' + code,
    ...extra,
  })
const island = async (session, props) => {
  const transport = createFnClient({
    fetch: async (url, request) =>
      new Response(
        JSON.stringify(session.call(decodeURIComponent(url.split('/').pop()), JSON.parse(request.body))),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  })
  const lifetime = new AbortController(),
    flow = createFlowWorkspace(props, { call: transport })
  flow.mount({ root: root(), lifetime: lifetime.signal })
  await tick()
  return {
    flow,
    html: () => renderToStaticString(flow.view()),
    close: () => {
      lifetime.abort()
      flow.dispose()
    },
  }
}

test('a cadence is null for Kanban; projects saved before cadences keep two-week Monday sprints', () => {
  assert.equal(sprintCadence(undefined), null)
  assert.equal(sprintCadence({ id: 'old' }), DEFAULT_CADENCE)
  assert.equal(sprintCadence({ id: 'k', sprintCadence: null }), null)
  assert.deepEqual(sprintCadence({ id: 'w', sprintCadence: { weeks: 1, weekday: 3 } }), {
    weeks: 1,
    weekday: 3,
  })
  assert.equal(validCadence(null), true)
  assert.equal(validCadence({ weeks: 4, weekday: 0 }), true)
  for (const bad of [
    undefined,
    {},
    { weeks: 5, weekday: 1 },
    { weeks: 0, weekday: 1 },
    { weeks: 2, weekday: 7 },
    { weeks: 2, weekday: 1.5 },
    { weeks: '2', weekday: 1 },
    { weeks: 2, weekday: 1, extra: true },
  ])
    assert.equal(validCadence(bad), false, JSON.stringify(bad))
})

test('the next sprint follows the last one, or starts on the next cadence day, and continues its numbering', () => {
  const sprints = [
    { projectId: 'p', title: 'KV · Sprint 12', start: '2026-09-21', end: '2026-10-04', state: 'active' },
    { projectId: 'p', title: 'KV · Sprint 9', start: '2026-07-01', end: '2026-07-14', state: 'closed' },
    { projectId: 'q', title: 'Sprint 40', start: '2026-11-01', end: '2026-12-01', state: 'planned' },
  ]
  assert.deepEqual(nextSprint({ sprints }, { id: 'p' }, TODAY), {
    title: 'KV · Sprint 13',
    start: '2026-10-05',
    end: '2026-10-18',
  })
  assert.deepEqual(
    nextSprint({ sprints }, { id: 'p', sprintCadence: { weeks: 3, weekday: 1 } }, TODAY),
    { title: 'KV · Sprint 13', start: '2026-10-05', end: '2026-10-25' },
    'the length comes from the cadence',
  )
  const ended = [
    { projectId: 'p', title: 'Sprint 2', start: '2026-09-07', end: '2026-09-20', state: 'closed' },
  ]
  assert.deepEqual(
    nextSprint({ sprints: ended }, { id: 'p', sprintCadence: { weeks: 1, weekday: 3 } }, TODAY),
    { title: 'Sprint 3', start: '2026-09-30', end: '2026-10-06' },
    'after a gap it waits for the cadence day',
  )
  assert.equal(
    nextSprint({ sprints: [] }, { id: 'p', sprintCadence: { weeks: 1, weekday: 4 } }, TODAY).start,
    TODAY,
    'the cadence day itself is today',
  )
  assert.deepEqual(
    nextSprint(
      {
        sprints: [
          { projectId: 'p', title: 'Launch', start: '2026-09-21', end: '2026-09-24', state: 'active' },
        ],
      },
      { id: 'p' },
      TODAY,
    ),
    { title: 'Sprint 2', start: '2026-09-25', end: '2026-10-08' },
    'a sprint ending today is still running, so the next one follows it; an unnumbered name counts sprints instead',
  )
  assert.deepEqual(nextSprint({ sprints: [] }, { id: 'new' }, TODAY), {
    title: 'Sprint 1',
    start: '2026-09-28',
    end: '2026-10-11',
  })
})

test('only unfinished sprints of the same project clash, including a shared last day', () => {
  const data = {
    sprints: [
      { id: 'a', projectId: 'p', title: 'A', start: '2026-09-21', end: '2026-10-04', state: 'active' },
      { id: 'b', projectId: 'p', title: 'B', start: '2026-10-05', end: '2026-10-18', state: 'closed' },
      { id: 'c', projectId: 'p', title: 'C', start: '2026-08-01', end: '2026-08-14', state: 'completed' },
      { id: 'd', projectId: 'q', title: 'D', start: '2026-10-05', end: '2026-10-18', state: 'planned' },
    ],
  }
  assert.equal(overlappingSprint(data, 'p', '2026-10-04', '2026-10-10')?.id, 'a')
  assert.equal(
    overlappingSprint(data, 'p', '2026-10-05', '2026-10-18'),
    null,
    'closed B and other-project D do not block',
  )
  assert.equal(
    overlappingSprint(data, 'p', '2026-08-01', '2026-08-14'),
    null,
    'completed sprints do not block',
  )
  assert.equal(overlappingSprint(data, 'p', '2026-09-01', '2026-09-21')?.id, 'a')
  assert.equal(
    overlappingSprint(data, 'p', '2026-09-01', '2026-09-30', 'a'),
    null,
    'a sprint does not clash with itself',
  )
})

test('the store keeps the cadence with the project and refuses sprints that break it', () => {
  const c = call(createOrganizationSession('baseline', 'sprints', { profile: 'realistic' }))
  const kanban = newProject(c, 'KAN', { sprintCadence: null }).id,
    plain = newProject(c, 'PLN').id,
    weekly = newProject(c, 'WK', { sprintCadence: { weeks: 1, weekday: 3 } }).id
  let d = c('flow.workspace.bootstrap')
  const cadence = (id) => d.projects.find((p) => p.id === id).sprintCadence
  assert.deepEqual(
    [cadence(kanban), cadence(plain), cadence(weekly)],
    [null, { weeks: 2, weekday: 1 }, { weeks: 1, weekday: 3 }],
  )
  assert.equal(newProject(c, 'BAD', { sprintCadence: { weeks: 6, weekday: 1 } }).code, 'validation')
  assert.equal(newProject(c, 'BAD2', { sprintCadence: 'weekly' }).code, 'validation')

  const sprint = (projectId, title, start, end) =>
    c('flow.entity.save', {
      collection: 'sprints',
      projectId,
      title,
      start,
      end,
      description: '',
      idempotencyKey: 'sprint-' + title,
    })
  assert.match(sprint(kanban, 'Sprint 1', '2026-09-28', '2026-10-11').message, /Kanban/)
  const core = d.projects.find((p) => p.id === 'core')
  const turnOff = c('flow.entity.save', {
    collection: 'projects',
    entityId: 'core',
    workspaceId: core.workspaceId,
    access: core.access,
    title: core.title,
    code: core.code,
    idempotencyKey: 'core-off',
    sprintCadence: null,
  })
  assert.match(turnOff.message, /Đóng sprint đang chạy/)
  assert.equal(
    c('flow.workspace.bootstrap').projects.find((p) => p.id === 'core').sprintCadence,
    undefined,
    'the refused change left core as it was',
  )
  assert.match(sprint('core', 'Overlap', '2026-10-01', '2026-10-10').message, /Trùng lịch/)
  assert.match(
    sprint('core', 'kv · sprint 13', '2027-01-04', '2027-01-17').message,
    /Tên sprint đã có/,
    'names are compared without case because tasks point at sprints by name',
  )
  const proposed = nextSprint(d, core, TODAY)
  assert.deepEqual([proposed.start, proposed.end], ['2026-10-19', '2026-11-01'])
  assert.equal(
    typeof sprint('core', proposed.title, proposed.start, proposed.end).id,
    'string',
    'the proposed sprint saves as is',
  )

  const task = c('flow.workspace.bootstrap').tasks.find((t) => t.projectId === 'core' && t.status === 'todo')
  assert.match(
    c('flow.issue.assignSprint', { id: task.id, sprint: 'OPS · Sprint 13', idempotencyKey: 'other' }).message,
    /cùng dự án/,
    'a sprint of another project is refused',
  )
  assert.match(
    c('flow.issue.save', {
      id: task.id,
      expectedVersion: task.version,
      idempotencyKey: 'to-kanban',
      projectId: kanban,
      sprint: 'KV · Sprint 13',
    }).message,
    /Kanban/,
    'a Kanban project takes no sprint',
  )
  assert.equal(
    c('flow.issue.assignSprint', { id: task.id, sprint: 'KV · Sprint 13', idempotencyKey: 'own' }).code,
    undefined,
    'its own project sprint is fine',
  )
  assert.deepEqual(
    c('flow.entity.save', {
      collection: 'projects',
      entityId: weekly,
      workspaceId: 'product',
      access: 'workspace',
      title: 'Project WK',
      code: 'WK',
      idempotencyKey: 'wk-kanban',
      sprintCadence: null,
    }).id,
    weekly,
    'a project without a running sprint can switch to Kanban',
  )
  d = c('flow.workspace.bootstrap')
  assert.equal(cadence(weekly), null)
})

test('project creation shows the sprint cadence up front, previews the first sprint and can switch to Kanban', async () => {
  const session = createOrganizationSession('baseline', 'project-new', { profile: 'realistic' })
  const { flow, html, close } = await island(session, { screen: 'project-new', workspaceId: 'product' })
  let page = html()
  assert.match(
    page,
    /<h2>Sprints<\/h2>[\s\S]*?data-flow="checkbox"[^>]*checked="true"[\s\S]*?Plan in sprints/,
  )
  assert.match(page, /<option value="2" selected="true">2 weeks<\/option>/)
  assert.match(page, /<option value="1">1 week<\/option>/)
  assert.match(page, /<option value="1" selected="true">Monday<\/option>/)
  assert.match(page, /Next sprint: Sprint 1 · 2026-09-28 → 2026-10-11\./)
  handlers(flow.view(), 'name=sprint-weeks', 'change')[0]({ target: { value: '1' } })
  handlers(flow.view(), 'name=sprint-weekday', 'change')[0]({ target: { value: '3' } })
  assert.match(html(), /Next sprint: Sprint 1 · 2026-09-30 → 2026-10-06\./)
  const [toggle] = handlers(flow.view(), 'data-flow="checkbox"', 'change')
  toggle({ target: { checked: false } })
  page = html()
  assert.doesNotMatch(page, /name="sprint-weeks"/)
  assert.match(page, /Off means Kanban/)
  toggle({ target: { checked: true } })
  assert.match(
    html(),
    /Next sprint: Sprint 1 · 2026-09-28 → 2026-10-11\./,
    'turning sprints back on starts from the default cadence',
  )
  toggle({ target: { checked: false } })
  handlers(flow.view(), 'id=title', 'input')[0]({ target: { value: 'Kanban board' } })
  handlers(flow.view(), 'id=code', 'input')[0]({ target: { value: 'KB' } })
  handlers(flow.view(), '<form', 'submit')[0]({ preventDefault() {} })
  await tick()
  await tick()
  const saved = call(session)('flow.workspace.bootstrap').projects.find((p) => p.code === 'KB')
  assert.equal(saved?.sprintCadence, null)
  close()
})

test('a Kanban project has no Sprint tab, field or form; a sprint project proposes the next sprint', async () => {
  const session = createOrganizationSession('baseline', 'sprints', { profile: 'realistic' }),
    c = call(session)
  const kanban = newProject(c, 'KAN', { sprintCadence: null }).id
  let view = await island(session, { screen: 'sprints', project: kanban, workspaceId: 'product' })
  let page = view.html()
  assert.match(page, /This project uses Kanban/)
  assert.match(page, /Open project profile/)
  assert.doesNotMatch(
    page,
    /data-flow="project-view-link"[^>]*>[\s\S]{0,1200}?<\/svg>Sprint<\/button>/,
    'no Sprint tab',
  )
  assert.match(page, /<\/svg>Epic<\/button>/, 'the other project tabs stay')
  view.close()
  view = await island(session, { screen: 'sprint-new', project: kanban, workspaceId: 'product' })
  page = view.html()
  assert.match(page, /This project uses Kanban/)
  assert.doesNotMatch(page, /id="start"/)
  view.close()

  view = await island(session, { screen: 'issue-new', project: 'core', workspaceId: 'product' })
  page = view.html()
  const options = [
    ...(/name="sprint"[\s\S]*?<\/select>/.exec(page)?.[0] ?? '').matchAll(/<option value="([^"]+)"/g),
  ].map((m) => m[1])
  assert.ok(
    options.includes('KV · Sprint 13') && !options.some((o) => /^(OPS|DOC|MOB) /.test(o)),
    'only sprints of the task project are offered: ' + options.join(', '),
  )
  handlers(view.flow.view(), 'id=projectId', 'change')[0]({ target: { value: kanban } })
  assert.doesNotMatch(
    view.html(),
    /name="sprint"/,
    'moving the new task to a Kanban project drops the Sprint field',
  )
  view.close()

  view = await island(session, { screen: 'sprints', project: 'core', workspaceId: 'product' })
  assert.match(
    view.html(),
    /aria-current="page"[^>]*>[\s\S]{0,1200}?<\/svg>Sprint<\/button>/,
    'core keeps its Sprint tab',
  )
  assert.doesNotMatch(view.html(), /This project uses Kanban/)
  view.close()
  const task = c('flow.workspace.bootstrap').tasks.find((t) => t.projectId === 'core' && t.status === 'todo')
  view = await island(session, { screen: 'issue', record: task.id, project: 'core', workspaceId: 'product' })
  page = view.html()
  const detail = [
    ...(/name="task-sprint"[\s\S]*?<\/select>/.exec(page)?.[0] ?? '').matchAll(/<option value="([^"]+)"/g),
  ].map((m) => m[1])
  assert.ok(
    detail.includes('KV · Sprint 13') && !detail.some((o) => /^(OPS|DOC|MOB) /.test(o)),
    'task detail offers only its project sprints: ' + detail.join(', '),
  )
  view.close()
  const moved = c('flow.issue.save', {
    id: task.id,
    expectedVersion: task.version,
    idempotencyKey: 'move-kanban',
    projectId: kanban,
    sprint: 'Backlog',
  })
  assert.equal(moved.code, undefined, moved.message)
  view = await island(session, { screen: 'issue', record: task.id, project: kanban, workspaceId: 'product' })
  assert.doesNotMatch(view.html(), /name="task-sprint"/, 'a task in a Kanban project has no Sprint field')
  view.close()
  view = await island(session, { screen: 'sprint-new', project: 'core', workspaceId: 'product' })
  page = view.html()
  assert.match(page, /id="title"[^>]*value="(KV · )?Sprint 14"/)
  assert.match(page, /id="start"[^>]*value="2026-10-19"/)
  assert.match(page, /id="end"[^>]*value="2026-11-01"/)
  view.close()
})
