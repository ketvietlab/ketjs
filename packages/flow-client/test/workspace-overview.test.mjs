import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString, signal } from '@ketvietlab/ketjs-view'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import {
  workspaceOverviewModel,
  createWorkspaceOverview,
  HORIZON_DAYS,
} from '@ketvietlab/flow-client/workspace-overview.mjs'
import { statusKind } from '@ketvietlab/flow-client/project-catalogs.mjs'
import { addDays } from '@ketvietlab/flow-client/timeline.mjs'
setFlowLocale('en')
const TODAY = '2026-09-23'
const load = (profile = 'compact') =>
  createOrganizationSession('baseline', 'workspace-overview', { profile }).call('flow.workspace.bootstrap', {
    companyId: 'demo',
  }).value
// Every click handler whose opening tag carries `marker`, in document order.
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
const setup = (profile) => {
  const data = load(profile),
    nav = []
  const ctx = {
    data: signal(data),
    navigate: (key, params) => nav.push([key, params ?? {}]),
    canWrite: () => true,
    busy: () => false,
  }
  const overview = createWorkspaceOverview(ctx),
    ws = data.workspaces.find((w) => w.id === 'product')
  return {
    data,
    nav,
    overview,
    render: () => overview.view({ workspace: ws, empty: null, canCreate: true, today: TODAY }),
  }
}

for (const profile of ['compact', 'realistic'])
  test(`overview numbers reconcile with the tasks they summarise (${profile})`, () => {
    const data = load(profile),
      m = workspaceOverviewModel(data, 'product', TODAY)
    const inWs = new Set(data.projects.filter((p) => p.workspaceId === 'product').map((p) => p.id))
    const tasks = data.tasks.filter((t) => !t.archived && inWs.has(t.projectId)),
      open = tasks.filter((t) => statusKind(data, t) !== 'done')
    assert.equal(m.tasks.length, tasks.length)
    assert.equal(
      Object.values(m.counts).reduce((a, b) => a + b, 0),
      tasks.length,
      'status mix covers every task once',
    )
    assert.equal(
      m.rows.reduce((n, r) => n + r.total, 0),
      tasks.length,
      'project rows add up to the workspace',
    )
    assert.equal(
      m.rows.reduce((n, r) => n + r.overdue, 0),
      m.overdue.length,
    )
    assert.deepEqual(
      m.overdue.map((t) => t.id).sort(),
      open
        .filter((t) => t.dueDate && t.dueDate < TODAY)
        .map((t) => t.id)
        .sort(),
    )
    assert.deepEqual(
      m.overdue.map((t) => t.dueDate),
      [...m.overdue.map((t) => t.dueDate)].sort(),
      'oldest overdue first',
    )
    assert.equal(m.horizon.length, HORIZON_DAYS + 1)
    assert.equal(m.horizon[0].tasks, m.overdue)
    const end = addDays(TODAY, HORIZON_DAYS)
    assert.equal(
      m.horizon.slice(1).reduce((n, x) => n + x.tasks.length, 0),
      open.filter((t) => t.dueDate >= TODAY && t.dueDate < end).length,
      'each upcoming task lands in exactly one day',
    )
    assert.ok(m.goals.every((g) => g.workspaceId === 'product'))
    for (const p of m.people) assert.ok(p.open >= p.overdue && p.open > 0)
  })

test('blocked counts only tasks whose blocker is still unfinished', () => {
  const data = load('realistic'),
    m = workspaceOverviewModel(data, 'product', TODAY)
  const target = m.blocked[0]
  assert.ok(target, 'fixture has a blocked task')
  const done = data.columns.find((c) => c.kind === 'done').id
  const cleared = {
    ...data,
    tasks: data.tasks.map((t) => (target.blockedBy.includes(t.id) ? { ...t, status: done } : t)),
  }
  assert.ok(!workspaceOverviewModel(cleared, 'product', TODAY).blocked.some((t) => t.id === target.id))
})

test('overview page leads with clickable totals and a deadline chart whose days open their tasks', () => {
  const { nav, render } = setup('realistic'),
    m = workspaceOverviewModel(load('realistic'), 'product', TODAY)
  let html = renderToStaticString(render())
  assert.equal((html.match(/data-flow="stat"/g) ?? []).length, 4)
  assert.doesNotMatch(
    html.slice(html.indexOf('stat-grid'), html.indexOf('column-chart')),
    /aria-pressed/,
    'tiles navigate, they are not toggles',
  )
  assert.equal((html.match(/data-flow="column" /g) ?? []).length, HORIZON_DAYS + 1)
  assert.match(html, /data-clipped="true"/, 'overdue backlog does not flatten the upcoming days')
  assert.match(html, /<th scope="col" data-size="wide">Overdue tasks<\/th>/)
  assert.match(html, /aria-current="date"/)
  const day = m.horizon.findIndex((x, i) => i > 0 && x.tasks.length)
  handlers(render(), 'data-flow="column"', 'click')[day]()
  html = renderToStaticString(render())
  assert.match(
    html,
    new RegExp(
      `Due ${new Date(m.horizon[day].date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</th>`,
    ),
  )
  for (const t of m.horizon[day].tasks.slice(0, 8)) assert.match(html, new RegExp(t.id))
  handlers(render(), 'data-flow="stat"', 'click')[1]()
  assert.deepEqual(nav.at(-1), ['dashboard', { risk: 'overdue' }])
})

test('each project row shows its status mix, risk and running sprint in one line', () => {
  const { render } = setup(),
    html = renderToStaticString(render())
  const table = html.slice(html.indexOf('aria-label="Projects"'))
  assert.match(
    table,
    /data-flow="segment-track" role="img" aria-label="KetSuite Core: Done \d+ · Confirming \d+ · In progress \d+ · To do \d+"/,
  )
  assert.match(table, /\d+% <\/span>|\d+%<\/span>/)
  assert.match(table, /Actions for KetSuite Core/)
  assert.doesNotMatch(table, /data-flow="evidence-value" data-tone/)
})
