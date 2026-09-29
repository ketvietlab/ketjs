import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString, signal } from '@ketvietlab/ketjs-view'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { createFlowWorkspace } from '@ketvietlab/flow-client/workspace.mjs'
import { createFnClient } from '@ketvietlab/flow-client/api.mjs'
import { projectCode, parseInvites, createFirstRun } from '@ketvietlab/flow-client/first-run.mjs'
import { createWorkspaceOverview } from '@ketvietlab/flow-client/workspace-overview.mjs'
import { gettingStarted } from '@ketvietlab/flow-client/getting-started.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { BLANK_OWNER } from '../atlas/blank-organization.mjs'
setFlowLocale('en')

// No browser: the controller only needs a lifetime, a root and the history calls it makes when switching workspace.
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
const signedIn = () => {
  const s = createOrganizationSession('blank', 'workspace-overview', { profile: 'realistic' }),
    c = call(s)
  c('flow.auth.signIn', { email: BLANK_OWNER.email, password: BLANK_OWNER.password })
  c('flow.auth.setPassword', { password: 'my-own-secret', confirm: 'my-own-secret' })
  return c
}

test('a project code comes from the initials of the name, without Vietnamese marks', () => {
  assert.equal(projectCode('Website khách hàng'), 'WKH')
  assert.equal(projectCode('Đặt phòng khách sạn mới nhất'), 'DPKS')
  assert.equal(projectCode('website'), 'WEBS')
  assert.equal(projectCode('Ứng dụng'), 'UD')
  assert.equal(projectCode('x'), '', 'one letter is too short')
  assert.equal(projectCode('2026 plan'), '', 'a code starts with a letter')
})

test('invite addresses split on lines, commas and spaces, deduplicate, and keep what is not an address', () => {
  assert.deepEqual(parseInvites('Ha@Hoasen.example, bao@hoasen.example\nha@hoasen.example  nope;\n\n'), {
    emails: ['ha@hoasen.example', 'bao@hoasen.example'],
    invalid: ['nope'],
  })
  assert.deepEqual(parseInvites(''), { emails: [], invalid: [] })
})

test('the blank organization answers nothing before sign-in, then only the password change', () => {
  const c = call(createOrganizationSession('blank', 'workspace-overview', { profile: 'realistic' }))
  assert.equal(c('flow.workspace.bootstrap').code, 'unauthenticated')
  assert.equal(
    c('flow.auth.setPassword', { password: 'my-own-secret', confirm: 'my-own-secret' }).code,
    'unauthenticated',
  )
  assert.equal(c('flow.auth.signIn', { email: BLANK_OWNER.email, password: 'wrong' }).code, 'credentials')
  assert.equal(
    c('flow.auth.signIn', { email: 'other@hoasen.example', password: BLANK_OWNER.password }).code,
    'credentials',
  )
  assert.deepEqual(
    c('flow.auth.signIn', { email: ` ${BLANK_OWNER.email.toUpperCase()} `, password: BLANK_OWNER.password }),
    { mustChangePassword: true },
  )
  assert.equal(c('flow.workspace.bootstrap').code, 'password_change')
  assert.equal(c('flow.auth.setPassword', { password: 'short', confirm: 'short' }).code, 'validation')
  assert.equal(
    c('flow.auth.setPassword', { password: '123456789', confirm: '123456789' }).code,
    'validation',
    'nine characters are one too few',
  )
  assert.equal(
    c('flow.auth.setPassword', { password: BLANK_OWNER.password, confirm: BLANK_OWNER.password }).code,
    'validation',
    'the issued password cannot be kept',
  )
  assert.equal(
    c('flow.auth.setPassword', { password: 'my-own-secret', confirm: 'my-own-secreT' }).code,
    'validation',
  )
  assert.deepEqual(c('flow.auth.setPassword', { password: '1234567890', confirm: '1234567890' }), {})
  assert.equal(
    c('flow.auth.signIn', { email: BLANK_OWNER.email, password: BLANK_OWNER.password }).code,
    'credentials',
    'the issued password stops working once replaced',
  )
  const d = c('flow.workspace.bootstrap')
  assert.equal(d.company.name, 'Hoa Sen Studio')
  assert.deepEqual(
    d.members.map((m) => [m.id, m.role]),
    [['mai', 'owner']],
  )
  for (const key of [
    'workspaces',
    'projects',
    'tasks',
    'pages',
    'epics',
    'sprints',
    'teams',
    'grants',
    'invitations',
    'inbox',
    'history',
    'views',
    'forms',
    'tags',
    'fields',
  ])
    assert.equal(d[key].length, 0, key)
  for (const key of ['github', 'workHours', 'quality', 'goals', 'automations'])
    assert.equal(d[key], undefined, key)
  assert.equal(d.columns.length, 4, 'built-in task statuses stay')
  assert.equal(d.capabilities.manageOrganization, true)
})

test('Atlas can open the blank organization at each stage without clicking through the earlier ones', () => {
  const at = (stage) => call(createOrganizationSession(stage, 'workspace-overview', { profile: 'realistic' }))
  assert.equal(at('blank')('flow.workspace.bootstrap').code, 'unauthenticated')
  const password = at('blank-password')
  assert.equal(password('flow.workspace.bootstrap').code, 'password_change')
  assert.deepEqual(
    password('flow.auth.setPassword', { password: 'my-own-secret', confirm: 'my-own-secret' }),
    {},
  )
  const onboarding = at('blank-onboarding')('flow.workspace.bootstrap')
  assert.deepEqual([onboarding.workspaces.length, onboarding.capabilities.manageOrganization], [0, true])
  const workspace = at('blank-workspace')('flow.workspace.bootstrap', { workspaceId: 'first' })
  assert.deepEqual(
    workspace.workspaces.map((w) => w.id),
    ['first'],
  )
  const today = new Date().toISOString().slice(0, 10),
    start = gettingStarted(workspace, 'first', today)
  assert.deepEqual(
    [start.show, start.done, start.total],
    [true, 0, 4],
    'a workspace made today shows the whole checklist',
  )
})

test('other scenarios need no sign-in', () => {
  assert.ok(
    call(createOrganizationSession('baseline', 'workspace-overview'))('flow.workspace.bootstrap').workspaces
      .length,
  )
})

test('the checklist ticks itself from data and only shows for workspaces created in the last thirty days', () => {
  const c = signedIn(),
    d0 = c('flow.workspace.bootstrap')
  const ws = c('flow.organization.command', {
    action: 'workspace.save',
    title: 'Sản phẩm',
    access: 'internal',
    idempotencyKey: 'w',
    expectedRevision: d0.organizationRevision,
  }).id
  const today = new Date().toISOString().slice(0, 10),
    read = () => c('flow.workspace.bootstrap', { workspaceId: ws })
  let g = gettingStarted(read(), ws, today)
  assert.deepEqual([g.done, g.total, g.show, g.project], [0, 4, true, null])
  const project = c('flow.entity.save', {
    collection: 'projects',
    workspaceId: ws,
    title: 'Website',
    code: 'WEB',
    access: 'workspace',
    defaultView: 'board',
    idempotencyKey: 'p',
  }).id
  g = gettingStarted(read(), ws, today)
  assert.deepEqual(
    g.steps.filter((s) => s.done).map((s) => s.id),
    ['project'],
  )
  assert.equal(g.project.id, project)
  const d = read()
  assert.equal(
    c('flow.organization.command', {
      action: 'member.invite',
      email: 'ha@hoasen.example',
      role: 'member',
      idempotencyKey: 'i',
      expectedRevision: d.organizationRevision,
    }).code,
    undefined,
  )
  const next = { ...read() }
  next.tasks = [{ id: 'WEB-1', projectId: project }]
  next.pages = [{ id: 'p1', workspaceId: ws }]
  next.goals = [{ id: 'g', workspaceId: ws }]
  next.github = { connections: [{ projectId: project }] }
  assert.deepEqual(
    gettingStarted({ ...read(), tasks: [{ id: 'WEB-1', projectId: project }] }, ws, today)
      .steps.filter((s) => s.done)
      .map((s) => s.id),
    ['project', 'task', 'invite'],
  )
  assert.equal(gettingStarted(next, ws, today).complete, true)
  assert.equal(gettingStarted(next, ws, today).show, false, 'a finished checklist goes away')
  assert.equal(
    gettingStarted({ ...next, pages: [{ id: 'p1', workspaceId: ws, archived: true }] }, ws, today).steps.find(
      (s) => s.id === 'page',
    ).done,
    false,
    'an archived document does not count',
  )
  assert.equal(
    gettingStarted({ ...next, pages: [{ id: 'p1', workspaceId: 'elsewhere' }] }, ws, today).steps.find(
      (s) => s.id === 'page',
    ).done,
    false,
  )
  assert.ok(
    !gettingStarted(next, ws, today).steps.some((s) => s.id === 'goal'),
    'core onboarding does not link to pro goals',
  )
  assert.equal(
    gettingStarted(
      { ...next, invitations: [], members: [...next.members, { id: 'ha', status: 'active' }] },
      ws,
      today,
    ).steps.find((s) => s.id === 'invite').done,
    true,
    'a joined member counts',
  )
  assert.equal(
    gettingStarted(
      { ...next, invitations: [], members: [...next.members, { id: 'ha', status: 'revoked' }] },
      ws,
      today,
    ).steps.find((s) => s.id === 'invite').done,
    false,
  )
  const created = read().workspaces[0].createdAt.slice(0, 10),
    day = (n) => new Date(Date.parse(created) + n * 864e5).toISOString().slice(0, 10)
  assert.equal(gettingStarted(read(), ws, day(30)).show, true)
  assert.equal(gettingStarted(read(), ws, day(31)).show, false)
  const old = createOrganizationSession('baseline', 'workspace-overview').call('flow.workspace.bootstrap', {
    companyId: 'demo',
  }).value
  assert.equal(
    gettingStarted(old, 'product', today).show,
    false,
    'seeded workspaces have no creation date and predate the checklist',
  )
})

test('the owner signs in, replaces the password, sets up a workspace and project, skips invites and lands on the checklist', async () => {
  const session = createOrganizationSession('blank', 'workspace-overview', { profile: 'realistic' }),
    calls = [],
    lifetime = new AbortController()
  const transport = createFnClient({
    fetch: async (url, request) => {
      const name = decodeURIComponent(url.split('/').pop()),
        input = JSON.parse(request.body)
      calls.push(name)
      return new Response(JSON.stringify(session.call(name, input)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  const island = createFlowWorkspace(
    {
      screen: 'workspace-overview',
      signInDemo: { email: BLANK_OWNER.email, password: BLANK_OWNER.password },
    },
    { call: transport },
  )
  island.mount({ root: root(), lifetime: lifetime.signal })
  await tick()
  const html = () => renderToStaticString(island.view()),
    on = (marker, event, value) => {
      const [fn] = handlers(island.view(), marker, event)
      assert.equal(typeof fn, 'function', marker + ' ' + event)
      return fn(value)
    }
  const type = (id, value) => on('id=' + id, 'input', { target: { value } }),
    submit = () => on('<form', 'submit', { preventDefault() {} })

  let page = html()
  assert.match(page, /data-flow="entry-page"/)
  assert.match(page, /<h1>Sign in to Flow<\/h1>/)
  assert.match(page, /Atlas mock account: mai@hoasen\.example · password HoaSen-2026/)
  assert.match(page, /autocomplete="current-password"/)
  assert.doesNotMatch(page, /data-flow="shell"|ZITADEL|OAuth|SSO/)
  type('sign-in-email', BLANK_OWNER.email)
  type('sign-in-password', 'wrong')
  submit()
  await tick()
  assert.match(html(), /Email or password is incorrect\./)
  assert.match(html(), /<h1>Sign in to Flow<\/h1>/)
  type('sign-in-password', BLANK_OWNER.password)
  submit()
  await tick()

  page = html()
  assert.match(page, /<h1>Choose your own password<\/h1>/)
  assert.match(page, /autocomplete="new-password"/)
  const before = calls.length
  type('new-password', 'short')
  type('confirm-password', 'short')
  submit()
  await tick()
  assert.match(html(), /Use at least 10 characters\./)
  assert.equal(calls.length, before, 'a short password never leaves the browser')
  type('new-password', 'my-own-secret')
  type('confirm-password', 'my-own-secreX')
  submit()
  await tick()
  assert.match(html(), /The two passwords do not match\./)
  assert.equal(calls.length, before)
  type('confirm-password', 'my-own-secret')
  submit()
  await tick()

  page = html()
  assert.match(page, /<h1>Create your first workspace<\/h1>/)
  assert.match(page, /<li data-complete="false" aria-current="step"><span>1<\/span>Workspace<\/li>/)
  assert.match(page, /Everyone in Hoa Sen Studio can open this workspace/)
  submit()
  await tick()
  assert.match(html(), /Enter a name\./)
  type('workspace-title', '  Sản phẩm ')
  submit()
  await tick()

  page = html()
  assert.match(page, /<h1>Create your first project<\/h1>/)
  assert.match(page, /A project in Sản phẩm gathers/)
  assert.match(page, /<li data-complete="true"><span>/, 'the workspace step is ticked')
  type('project-title', 'Website khách hàng')
  assert.match(html(), /id="project-code"[^>]*value="WKH"/)
  assert.match(html(), /like WKH-1\./)
  type('project-code', 'w')
  submit()
  await tick()
  assert.match(html(), /Use 2–12 capital letters or digits/)
  type('project-code', 'web')
  type('project-title', 'Website khách hàng mới')
  assert.match(
    html(),
    /id="project-code"[^>]*value="WEB"/,
    'a code typed by hand is not overwritten by later name edits',
  )
  assert.match(
    html(),
    /<option value="sprint" selected="true">Two-week sprints, starting Monday<\/option><option value="kanban">Kanban, no sprints<\/option>/,
  )
  submit()
  await tick()

  page = html()
  assert.match(page, /<h1>Invite your team<\/h1>/)
  type('invite-emails', 'ha@hoasen.example, not-an-email')
  submit()
  await tick()
  assert.match(html(), /Not an email address: not-an-email/)
  const [skip] = handlers(island.view(), 'data-variant=ghost', 'click')
  skip()
  await tick()
  await tick()

  page = html()
  assert.doesNotMatch(page, /data-flow="entry-page"/)
  assert.match(page, /data-flow="checklist"/)
  assert.match(page, /1 of 4 done/)
  assert.match(page, /<li data-done="true">[\s\S]*?Create a project/)
  assert.doesNotMatch(page, /data-flow="stat-grid"/, 'no zero counters before the first task')
  const d = call(session)('flow.workspace.bootstrap')
  assert.deepEqual(
    [
      d.workspaces.map((w) => [w.title, w.access]),
      d.projects.map((p) => [p.title, p.code, p.defaultView, p.sprintCadence]),
      d.invitations.length,
    ],
    [[['Sản phẩm', 'internal']], [['Website khách hàng mới', 'WEB', 'board', { weeks: 2, weekday: 1 }]], 0],
  )
  lifetime.abort()
  island.dispose()
})

test('sending invitations finishes onboarding; a failed address stays in the box with its reason', async () => {
  const session = createOrganizationSession('blank', 'workspace-overview', { profile: 'realistic' }),
    lifetime = new AbortController()
  const c = call(session)
  c('flow.auth.signIn', { email: BLANK_OWNER.email, password: BLANK_OWNER.password })
  c('flow.auth.setPassword', { password: 'my-own-secret', confirm: 'my-own-secret' })
  const transport = createFnClient({
    fetch: async (url, request) =>
      new Response(
        JSON.stringify(session.call(decodeURIComponent(url.split('/').pop()), JSON.parse(request.body))),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  })
  const island = createFlowWorkspace({ screen: 'workspace-overview' }, { call: transport })
  island.mount({ root: root(), lifetime: lifetime.signal })
  await tick()
  const html = () => renderToStaticString(island.view()),
    on = (marker, event, value) => handlers(island.view(), marker, event)[0](value)
  const type = (id, value) => on('id=' + id, 'input', { target: { value } }),
    submit = async () => {
      on('<form', 'submit', { preventDefault() {} })
      await tick()
      await tick()
    }
  assert.doesNotMatch(html(), /Atlas mock account/, 'without Atlas nobody hands out a password')
  type('workspace-title', 'Sản phẩm')
  await submit()
  // A pending invitation for the same address makes the second send fail after the first went out.
  const d = c('flow.workspace.bootstrap')
  c('flow.organization.command', {
    action: 'member.invite',
    email: 'bao@hoasen.example',
    role: 'member',
    idempotencyKey: 'x',
    expectedRevision: d.organizationRevision,
  })
  type('project-title', 'Website')
  on('id=project-plan', 'change', { target: { value: 'kanban' } })
  await submit()
  assert.equal(
    c('flow.workspace.bootstrap').projects[0].sprintCadence,
    null,
    'choosing Kanban saves a project without sprints',
  )
  assert.match(
    html(),
    /<h1>Invite your team<\/h1>/,
    'a one-word name suggests its first four letters as the code',
  )
  type('invite-emails', 'ha@hoasen.example\nbao@hoasen.example')
  on('id=invite-role', 'change', { target: { value: 'admin' } })
  await submit()
  assert.match(html(), /bao@hoasen\.example: Email này đã có lời mời đang chờ\./)
  assert.match(html(), /<h1>Invite your team<\/h1>/)
  assert.deepEqual(
    c('flow.workspace.bootstrap').invitations.map((i) => [i.email, i.role]),
    [
      ['bao@hoasen.example', 'member'],
      ['ha@hoasen.example', 'admin'],
    ],
  )
  // Someone else changed the organization meanwhile: the send fails once, reloads, and the retry goes through.
  c('flow.organization.command', {
    action: 'workspace.save',
    title: 'Vận hành',
    idempotencyKey: 'y',
    expectedRevision: c('flow.workspace.bootstrap').organizationRevision,
  })
  type('invite-emails', 'linh@hoasen.example')
  await submit()
  assert.match(html(), /linh@hoasen\.example: Quyền hoặc cấu trúc đã thay đổi/)
  await submit()
  assert.match(html(), /data-flow="checklist"/)
  assert.match(html(), /2 of 4 done/)
  lifetime.abort()
  island.dispose()
})

test('onboarding is only for people who can manage the organization, and never replaces a loaded organization with workspaces', () => {
  const page = (data) =>
    createFirstRun({
      data: () => data,
      call: async () => ({}),
      reload: async () => {},
      finish: async () => {},
    }).page(null)
  const base = { company: { name: 'Hoa Sen' }, user: { id: 'mai' }, organizationRevision: 1 }
  assert.match(
    renderToStaticString(page({ ...base, workspaces: [], capabilities: { manageOrganization: true } })),
    /Create your first workspace/,
  )
  assert.equal(
    page({ ...base, workspaces: [], capabilities: { manageOrganization: false } }),
    null,
    'a member waits for a workspace instead',
  )
  assert.equal(page({ ...base, workspaces: [{ id: 'w' }], capabilities: { manageOrganization: true } }), null)
  const signedOut = createFirstRun({
    data: () => null,
    call: async () => ({}),
    reload: async () => {},
    finish: async () => {},
  })
  assert.equal(signedOut.page({ code: 'forbidden' }), null, 'other failures keep the normal error screen')
  assert.equal(signedOut.page(null), null)
})

test('the overview checklist leads with the first open step, waits for a project where one is needed, and hides on request', () => {
  const c = signedIn(),
    ws = c('flow.organization.command', {
      action: 'workspace.save',
      title: 'Sản phẩm',
      access: 'internal',
      idempotencyKey: 'w',
      expectedRevision: c('flow.workspace.bootstrap').organizationRevision,
    }).id
  const data = signal(c('flow.workspace.bootstrap', { workspaceId: ws })),
    nav = [],
    today = new Date().toISOString().slice(0, 10)
  const overview = createWorkspaceOverview({ data, navigate: (key, params) => nav.push([key, params]) })
  const view = (canCreate = true) =>
    overview.view({ workspace: data().workspaces[0], empty: null, canCreate, today })
  const out = renderToStaticString(view())
  assert.match(out, /0 of 4 done/)
  assert.match(
    out,
    /data-variant="primary"[^>]*>\s*Create project/,
    'the first open step is the primary action',
  )
  assert.match(out, /disabled[^>]*title="Create a project first"[^>]*>\s*Create task/)
  assert.doesNotMatch(out, /Connect GitHub/)
  assert.doesNotMatch(out, /disabled[^>]*>\s*Invite member/)
  assert.equal(
    renderToStaticString(view(false)).includes('data-flow="checklist"'),
    false,
    'people who cannot manage the workspace see no setup steps',
  )
  // Core secondary actions: task, invite, document, GitHub.
  const [, invite, page] = handlers(view(), 'data-variant=secondary', 'click')
  invite()
  page()
  assert.deepEqual(nav, [
    ['member-invite', {}],
    ['page-new', {}],
  ])
  const [hide] = handlers(view(), 'data-variant=ghost', 'click')
  hide()
  assert.doesNotMatch(renderToStaticString(view()), /data-flow="checklist"/)
})
