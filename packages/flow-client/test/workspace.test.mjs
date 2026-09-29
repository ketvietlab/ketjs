import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { renderToStaticString, renderIsland } from '@ketvietlab/ketjs-view'
import { createFlowWorkspace, routes } from '@ketvietlab/flow-client/workspace.mjs'
import { contentWidths, contentWidthFor } from '@ketvietlab/flow-client/content-layout.mjs'
import { createFnClient, FlowApiError } from '@ketvietlab/flow-client/api.mjs'
import { createFixtureSession } from '../atlas/store.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

// No browser simulation: these stubs only let the controller receive mount's
// lifetime and resolve its API read before inspecting pure view output.
const oldWindow = globalThis.window,
  oldObserver = globalThis.MutationObserver
globalThis.window = new EventTarget()
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
}
const root = () =>
  Object.assign(new EventTarget(), {
    ownerDocument: new EventTarget(),
    querySelector: () => null,
    querySelectorAll: () => [],
  })
async function renderScreen(screen, scenario = 'baseline', props = {}) {
  const fixture = createOrganizationSession(scenario, screen)
  const lifetime = new AbortController()
  const call = createFnClient({
    fetch: async (_, request) =>
      new Response(
        JSON.stringify(fixture.call(decodeURIComponent(_.split('/').pop()), JSON.parse(request.body))),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  })
  const island = createFlowWorkspace({ screen, ...props }, { call })
  island.mount({ root: root(), lifetime: lifetime.signal })
  await new Promise((r) => setTimeout(r, 0))
  const output = renderToStaticString(island.view())
  lifetime.abort()
  island.dispose()
  return output
}
test('SSR is only the shared loading view, without private fixture data', () => {
  const output = renderIsland('flow.workspace', createFlowWorkspace, { screen: 'board' }, { tag: 'div' })
  assert.match(output, /data-ket-island/)
  assert.match(output, /Đang mở/)
  assert.doesNotMatch(output, /KV-142|Mai Anh|task-card|shell-sidebar/)
})
test('every route renders its client presenter after the same API bootstrap', async () => {
  // Core alone: the pro package adds its own routes only when it is registered.
  assert.equal(Object.keys(routes).length, 76)
  for (const key of ['goals', 'goal', 'goal-new', 'goal-edit']) assert.equal(routes[key], undefined)
  for (const [key, route] of Object.entries(routes)) {
    const output = await renderScreen(key)
    if (!['record', 'overlay'].includes(route.pattern))
      assert.ok(contentWidths[key], `${key} needs an explicit content width`)
    assert.ok(['standard', 'wide', 'full'].includes(contentWidthFor(key, route)), key)
    assert.match(output, /data-flow="content-container"|data-flow-layout="documents"/, key)
    assert.match(output, /data-flow="shell"/, key)
    if (['pages', 'page', 'page-archived'].includes(key)) {
      assert.match(output, /data-flow-layout="documents"/, key)
      assert.doesNotMatch(output, /data-flow="docs-header"/, key)
    } else assert.ok(output.includes(route.title.replaceAll('&', '&amp;')), key)
    const invalid = /\[object Object\]|undefined|Không thể khởi động/.exec(output)
    assert.equal(invalid, null, key + (invalid ? output.slice(invalid.index - 80, invalid.index + 120) : ''))
    assert.equal((output.match(/<h1(?: |>|\n)/g) || []).length, 1, key)
  }
})

test('core hides goal entry points in workspace and epic views even with pro-shaped fixture data', async () => {
  const overview = await renderScreen('workspace-overview')
  assert.doesNotMatch(overview, /href="[^"]*\/goals[?\"]|data-tab="goals"/)
  assert.doesNotMatch(await renderScreen('epic-new'), /name="goalId"/)
  assert.doesNotMatch(await renderScreen('epic'), /name="epic-goal"/)
})
test('empty, readonly and forbidden are API states, without a second presenter', async () => {
  assert.match(await renderScreen('my-work', 'empty'), /Không có công việc phù hợp/)
  assert.match(await renderScreen('pages', 'empty'), /Chưa có tài liệu/)
  assert.match(await renderScreen('all-epics', 'empty'), /Chưa có dữ liệu/)
  assert.match(await renderScreen('issue', 'readonly'), /Chỉ xem/)
  const forbidden = await renderScreen('issue', 'forbidden')
  assert.match(forbidden, /Không có quyền/)
  assert.doesNotMatch(forbidden, /KV-142|Đồng bộ tồn phòng/)
})
test('HTTP client handles both domain failures and failed HTTP responses', async () => {
  const client = createFnClient({
    fetch: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          value: {
            ok: false,
            errors: [{ code: 'conflict', message: 'Stale' }],
            fields: { title: 'Invalid' },
          },
        }),
      ),
  })
  await assert.rejects(
    client('flow.issue.save', {}),
    (e) => e instanceof FlowApiError && e.code === 'conflict' && e.fields.title === 'Invalid',
  )
  const denied = createFnClient({
    fetch: async () =>
      new Response(JSON.stringify({ ok: false, code: 'forbidden', message: 'Denied' }), {
        status: 403,
      }),
  })
  await assert.rejects(denied('x'), /Denied/)
})
test('fixture commands preserve blocking, CAS, replay and dependency-cycle behaviors', () => {
  const f = createFixtureSession()
  assert.equal(
    f.call('flow.issue.move', {
      id: 'KV-142',
      columnId: 'done',
      expectedVersion: 1,
      idempotencyKey: 'a',
    }).value.errors[0].code,
    'blocked',
  )
  const args = { id: 'KV-144', columnId: 'done', expectedVersion: 1, idempotencyKey: 'b' }
  assert.equal(f.call('flow.issue.move', args).value.ok, true)
  assert.equal(f.call('flow.issue.move', args).value.ok, true)
  assert.equal(f.data.tasks.find((t) => t.id === 'KV-144').version, 2)
  assert.equal(f.call('flow.issue.move', { ...args, idempotencyKey: 'c' }).value.errors[0].code, 'conflict')
  assert.equal(
    f.call('flow.issue.dependency', { id: 'KV-144', target: 'KV-142', idempotencyKey: 'd' }).value.errors[0]
      .code,
    'cycle',
  )
  assert.equal(
    f.call('flow.issue.move', {
      id: 'KV-142',
      columnId: 'done',
      expectedVersion: 1,
      idempotencyKey: 'e',
    }).value.ok,
    true,
  )
})
test('fixture sessions isolate edits and replay a creation only once', () => {
  const a = createFixtureSession(),
    b = createFixtureSession()
  const input = { title: 'New task', idempotencyKey: 'same' }
  a.call('flow.issue.save', input)
  a.call('flow.issue.save', input)
  assert.equal(a.data.tasks.length, 13)
  assert.equal(b.data.tasks.length, 12)
  assert.equal(
    createFixtureSession('readonly').call('flow.issue.save', input).value.errors[0].code,
    'forbidden',
  )
})
test('Atlas owns no duplicate screen markup, CSS, tokens or package installation', async () => {
  const source = await readFile(new URL('../client/workspace.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /from ["'][^"']*\/atlas\/|isAtlas|\.innerHTML|fetch\(/)
  const packageJSON = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  assert.equal(packageJSON.private, undefined)
  assert.equal(packageJSON.license, 'MIT')
})

test('attachment metadata and history stay associated with their own task', () => {
  const fixture = createFixtureSession()
  fixture.call('flow.entity.save', {
    collection: 'files',
    taskId: 'KV-131',
    title: 'check.csv',
    idempotencyKey: 'file-131',
  })
  assert.equal(fixture.data.files.find((f) => f.title === 'check.csv').taskId, 'KV-131')
  assert.equal(fixture.data.files.find((f) => f.id === 'file1').taskId, 'KV-142')
  assert.equal(fixture.data.history[0].taskId, 'KV-131')
  fixture.call('flow.issue.save', { title: 'A fresh task', idempotencyKey: 'new-task' })
  assert.equal(fixture.data.history[0].taskId, 'KV-160')
  assert.equal(fixture.data.files.filter((f) => f.taskId === 'KV-160').length, 0)
})

test('document editing stores structured blocks without dropping the page hierarchy', () => {
  const fixture = createFixtureSession()
  const page = fixture.data.pages.find((p) => p.id === 'checklist')
  const blocks = [
    { id: 'heading', type: 'heading', text: 'Release plan' },
    { id: 'table', type: 'table', rows: [['Version', '1.1']] },
    { id: 'check', type: 'check', text: 'Approved', checked: true },
  ]
  const result = fixture.call('flow.entity.save', {
    collection: 'pages',
    entityId: page.id,
    title: page.title,
    parentId: page.parentId,
    projectId: page.projectId,
    blocks,
    idempotencyKey: 'document-save',
  })
  assert.equal(result.ok, true)
  assert.deepEqual(page.blocks, blocks)
  assert.equal(page.parentId, 'handoff')
  assert.notEqual(page.blocks, blocks)
})

test('navigation separates workspace settings, project tools and document ownership', async () => {
  const ops = await renderScreen('settings', 'baseline', { project: 'ops' })
  assert.match(ops, /Thiết lập dự án · Vận hành nội bộ/)
  assert.match(ops, /Công cụ dự án/)
  assert.doesNotMatch(ops, /title="KetSuite Core"/)
  assert.match(ops, /Chuyển Workspace/)
  const docs = await renderScreen('pages', 'baseline', { project: 'ops' })
  assert.match(docs, /View dự án/)
  assert.match(docs, /Sổ tay vận hành/)
  assert.doesNotMatch(docs, /data-flow="doc-tree-page"[^>]*>[^<]*Quy ước bàn giao/)
  const library = await renderScreen('all-pages')
  assert.match(library, /Nơi sở hữu tài liệu/)
  assert.match(library, /Hướng dẫn làm việc chung/)
  assert.doesNotMatch(library, /aria-label="View dự án"/)
  const workspace = await renderScreen('page', 'baseline', { record: 'workspace-guide', scope: 'workspace' })
  assert.match(workspace, /Hướng dẫn làm việc chung/)
  assert.doesNotMatch(workspace, /aria-label="View dự án"/)
})

test('document form routes render as dialogs over their document background', async () => {
  for (const key of ['page-new', 'page-child', 'page-move']) {
    const output = await renderScreen(key, 'baseline', { project: 'core', record: 'handoff' })
    assert.match(output, /data-flow-layout="documents"/)
    assert.match(output, /<dialog[^>]*[\s\S]*id="flow-document-modal"/)
    assert.ok(output.indexOf('data-flow="doc-paper"') < output.indexOf('id="flow-document-modal"'))
    assert.match(output, /Quy ước bàn giao/)
    assert.doesNotMatch(output, /id="flow-task-modal"/)
  }
})

test('all form and action overlays keep a background and use a native dialog', async () => {
  for (const key of [
    'project-new',
    'project-profile',
    'column-edit',
    'type-edit',
    'field-edit',
    'tag-edit',
    'sprint-new',
    'epic-new',
    'sprint-close',
    'display',
    'timezone',
    'cmdk',
    'issue',
    'issue-new',
    'issue-move',
  ]) {
    const output = await renderScreen(key)
    assert.match(output, /data-flow="shell"/, key)
    assert.match(output, /<dialog/, key)
    assert.equal((output.match(/<dialog/g) || []).length, 1, key)
    assert.ok(output.indexOf('data-flow="shell"') < output.indexOf('<dialog'), key)
    assert.doesNotMatch(output, /data-flow="sheet"/, key)
  }
})

test('task dialogs are only as wide as their content: the record gets the wide layout, one-step actions a form width', async () => {
  const dialog = (output) =>
    output.match(/<dialog[^>]*id="flow-task-modal"[^>]*>/)?.[0] ??
    output.match(/<dialog[^>]*data-size="[^"]*"[^>]*>/)?.[0]
  for (const key of ['issue', 'issue-new']) {
    const output = await renderScreen(key)
    assert.match(dialog(output), /data-size="task"/, key)
    assert.match(output, /data-flow="record-layout"/, key)
  }
  for (const key of [
    'issue-move',
    'board-move',
    'issue-sprint',
    'dependency-new',
    'subtask-link',
    'issue-archive',
    'comment',
  ]) {
    const output = await renderScreen(key),
      modal = output.slice(output.indexOf('id="flow-task-modal"'))
    assert.ok(output.includes('id="flow-task-modal"'), key)
    assert.match(dialog(output), /data-size="default"/, key)
    assert.doesNotMatch(
      modal,
      /data-flow="record-layout"|data-flow="section"(?![^>]*data-inset="none")|<footer/,
      key,
    )
  }
})

test('reloading a workspace-scoped modal retains the originating project and filters', async () => {
  const previousLocation = globalThis.location,
    previousHistory = globalThis.history
  const state = {
    flowBackground: {
      screen: 'board',
      url: '/flow/board?project=ops&q=handoff&status=todo&group=priority',
      record: 'KV-129',
    },
    flowModalDepth: 1,
  }
  globalThis.location = { href: 'http://flow.local/flow/project-new?lang=vi' }
  globalThis.history = {
    state,
    replaceState(next, _, url) {
      this.state = next
      globalThis.location.href = new URL(url, globalThis.location.href).href
    },
  }
  try {
    const output = await renderScreen('project-new')
    assert.match(output, /Vận hành nội bộ/)
    assert.match(output, /value="handoff"/)
    assert.match(output, /value="todo" selected/)
    assert.match(output, /value="priority" selected/)
    assert.match(output, /id="flow-form-modal"/)
    assert.match(output, /Bảng công việc/)
  } finally {
    if (previousLocation === undefined) delete globalThis.location
    else globalThis.location = previousLocation
    if (previousHistory === undefined) delete globalThis.history
    else globalThis.history = previousHistory
  }
})

test('management routes render scoped tabs and sidebar links instead of disclosure menus', async () => {
  for (const key of ['organization', 'workspaces', 'organization-members', 'teams', 'team', 'permissions']) {
    const out = await renderScreen(key)
    assert.match(out, /data-flow="scope-tabs" aria-label="Quản lý tổ chức/)
    assert.doesNotMatch(out, /<summary>Công cụ Workspace|<summary>Tổ chức ·/)
  }
  for (const key of [
    'workspace-overview',
    'all-issues',
    'all-pages',
    'workspace-members',
    'workspace-settings',
  ])
    assert.match(await renderScreen(key), /data-flow="scope-tabs" aria-label="Quản lý Workspace/)
  assert.doesNotMatch(await renderScreen('board'), /data-flow="scope-tabs"/)
  // Without the pro package its destinations disappear instead of rendering locked or dead links.
  for (const key of ['all-issues', 'organization'])
    assert.doesNotMatch(await renderScreen(key), /quality-inbox|performance-rules|performance\b|workload/)
})

test('sidebar separates workspace switching from user organization controls and project settings', async () => {
  const out = await renderScreen('board')
  const picker = out.slice(
    out.indexOf('<details data-flow="context-picker"'),
    out.indexOf('<details data-flow="mobile-nav"'),
  )
  assert.match(picker, /Quản lý Workspace/)
  assert.doesNotMatch(picker, /<select|Chuyển tổ chức/)
  const navigation = out.slice(
    out.indexOf('data-flow="navigation-content"'),
    out.indexOf('data-flow="navigation-footer"'),
  )
  assert.doesNotMatch(navigation, /Công cụ Workspace|Tổ chức ·|Thư viện tài liệu|>Quản lý<|project-subnav/)
  assert.match(out, /data-flow="navigation-footer"[\s\S]*aria-label="Chuyển tổ chức"/)
  const views = out.slice(
    out.indexOf('data-flow="project-views"'),
    out.indexOf('data-flow="content-container"'),
  )
  assert.doesNotMatch(views, />Cài đặt<|>Thiết lập dự án</)
  assert.match(out, />Thiết lập dự án\s*<\/button>/)
})

test('workspace, documents and modal failures use one recoverable toast without inline error banners', async () => {
  for (const screen of ['board', 'page', 'project-new', 'issue']) {
    const output = await renderScreen(screen, 'conflict')
    assert.equal((output.match(/data-flow="toast"/g) ?? []).length, 1, screen)
    assert.match(output, /Tải phiên bản mới/)
    assert.doesNotMatch(output, /data-flow="notice"\s+data-tone="red"/)
    if (['project-new', 'issue'].includes(screen)) {
      assert.ok(output.indexOf('data-flow="toast"') > output.indexOf('<dialog'), screen)
      assert.ok(output.indexOf('data-flow="toast"') < output.indexOf('</dialog>'), screen)
    }
  }
})

test('task search lives in the topbar and my-work workspace filtering shares the status toolbar', async () => {
  for (const screen of [
    'my-work',
    'all-issues',
    'issue-filter',
    'project-issues',
    'issues-archived',
    'filter-limit',
    'bulk',
    'board',
    'calendar',
  ]) {
    const out = await renderScreen(screen)
    const start = out.indexOf('<header data-flow="shell-header"')
    const header = out.slice(start, out.indexOf('</header>', start))
    assert.match(header, /data-flow="shell-search"/)
    assert.match(header, /aria-label="Tìm công việc"/)
    assert.equal((out.match(/aria-label="Tìm công việc"/g) ?? []).length, 1)
    if (screen === 'my-work') {
      assert.equal((out.match(/aria-label="Lọc theo Workspace"/g) ?? []).length, 1)
      const workspace = out.indexOf('aria-label="Lọc theo Workspace"'),
        status = out.indexOf('aria-label="Lọc trạng thái"')
      assert.ok(workspace < status)
      assert.doesNotMatch(out.slice(workspace, status), /data-flow="toolbar"/)
    }
  }
})

// Saved views reuse the project task list and its single shared topbar search.
test('saved project views retain the shared topbar search', async () => {
  const out = await renderScreen('project-issues', 'baseline', {
    company: 'demo',
    workspace: 'product',
    project: 'core',
    view: 'v1',
  })
  const start = out.indexOf('<header data-flow="shell-header"')
  const header = out.slice(start, out.indexOf('</header>', start))
  assert.match(header, /data-has-search="true"/)
  assert.match(header, /data-flow="shell-search"/)
  assert.equal((out.match(/aria-label="Tìm công việc"/g) ?? []).length, 1)
})

test('content keeps two bounded widths with boards, scheduling and document work surfaces unbounded', async () => {
  const { managementTabs } = await import('@ketvietlab/flow-client/navigation.mjs')
  assert.deepEqual([...new Set(Object.values(contentWidths).filter((width) => width !== 'full'))].sort(), [
    'standard',
    'wide',
  ])
  for (const [scope, tabs] of Object.entries(managementTabs)) {
    assert.equal(new Set(tabs.map((tab) => contentWidthFor(tab.value))).size, 1, scope)
  }
  for (const key of ['project-issues', 'sprints', 'epics', 'atlas', 'settings', 'project-members'])
    assert.equal(contentWidthFor(key), 'wide', key)
  assert.deepEqual(
    Object.entries(contentWidths)
      .filter(([, width]) => width === 'full')
      .map(([key]) => key)
      .sort(),
    ['board', 'calendar', 'page', 'page-archived', 'pages'],
  )
  for (const key of ['board', 'calendar']) {
    const output = await renderScreen(key)
    assert.match(output, /data-flow="content-container" data-width="full"/)
  }
  const library = await renderScreen('all-pages')
  assert.match(library, /data-flow="content-container" data-width="wide"/)
})
test('without pro, organization and member settings carry no work week or holidays', async () => {
  const settings = await renderScreen('organization-settings')
  assert.match(settings, /data-flow="content-container"/)
  assert.doesNotMatch(settings, /Giờ làm việc|Ngày nghỉ chung|name="day0"/)
  const member = await renderScreen('member-edit', 'baseline', { record: 'bao' })
  assert.match(member, /<form/)
  assert.doesNotMatch(member, /Giờ làm việc riêng|name="day6"/)
  assert.doesNotMatch(await renderScreen('issue'), /Giờ làm|Ghi giờ thực tế/)
})

test('task detail accepts files in place instead of opening a second attachments dialog', async () => {
  const out = await renderScreen('issue')
  const start = out.indexOf('data-flow="file-drop"')
  assert.ok(start > out.indexOf('<dialog'))
  assert.ok(start < out.indexOf('</dialog>'))
  assert.match(out.slice(start), /^[^>]*>[\s\S]*?type="file" multiple/)
  assert.doesNotMatch(out, /\/attachments|>\s*Thêm tệp\s*</)
})

// Finds the event handler bound right after an opening tag carrying `marker` in a rendered template tree.
const findHandler = (node, marker, event) => {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const x of node) {
      const h = findHandler(x, marker, event)
      if (h) return h
    }
    return null
  }
  if (node.items && node.render)
    return findHandler(
      node.items.map((x, i) => node.render(x, i)),
      marker,
      event,
    )
  if (!node.strings) return null
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
      return node.values[i]
    const h = findHandler(node.values[i], marker, event)
    if (h) return h
  }
  return null
}

test('dropping a file on the task uploads its bytes, saves the reference and opens an in-place preview', async () => {
  const fixture = createOrganizationSession('baseline', 'issue'),
    lifetime = new AbortController(),
    uploads = [],
    saves = []
  const call = createFnClient({
    fetch: async (url, request) => {
      const name = decodeURIComponent(url.split('/').pop()),
        input = JSON.parse(request.body)
      if (name === 'flow.entity.save') saves.push({ input, uploadsSoFar: uploads.length })
      return new Response(JSON.stringify(fixture.call(name, input)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  const upload = async (file) => {
    uploads.push(file.name)
    return { ok: true, uploadId: '0f8fad5b-d9cb-469f-a165-70867728950e' }
  }
  const island = createFlowWorkspace({ screen: 'issue', record: 'KV-142' }, { call, upload })
  island.mount({ root: root(), lifetime: lifetime.signal })
  await new Promise((r) => setTimeout(r, 0))
  const drop = findHandler(island.view(), 'data-flow="file-drop"', 'drop')
  assert.equal(typeof drop, 'function')
  drop({
    preventDefault() {},
    stopPropagation() {},
    currentTarget: { dataset: {} },
    dataTransfer: { files: [new File(['x'], 'Ảnh.png', { type: 'image/png' })] },
  })
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(uploads, ['Ảnh.png'])
  assert.equal(saves.length, 1)
  assert.equal(saves[0].uploadsSoFar, 1)
  assert.equal(saves[0].input.files[0].uploadId, '0f8fad5b-d9cb-469f-a165-70867728950e')
  const out = renderToStaticString(island.view())
  assert.match(out, /<img src="\/_ket\/files\/0f8fad5b-d9cb-469f-a165-70867728950e"/)
  assert.doesNotMatch(out, /flow-file-preview/)
  findHandler(island.view(), 'data-flow="attachment-thumb"', 'click')()
  const preview = renderToStaticString(island.view())
  assert.match(preview, /id="flow-file-preview"[\s\S]*data-flow="media-preview"/)
  lifetime.abort()
  island.dispose()
})

test('workspace members put search and the grant action in the shell topbar', async () => {
  const output = await renderScreen('workspace-members', 'baseline', {
    workspaceId: 'product',
    companyId: 'demo',
  })
  const header = output.match(/<header data-flow="shell-header"[\s\S]*?<\/header>/)?.[0] ?? ''
  assert.match(header, /data-flow="shell-search"><label data-flow="search"/)
  assert.match(header, /data-flow="shell-actions">[\s\S]*data-variant="primary"/)
  assert.doesNotMatch(output.slice(output.indexOf(header) + header.length), /type="search"/)
})

test('core has no GitHub routes, task links or integration navigation', async () => {
  for (const key of ['github', 'atlas', 'workspace-integrations', 'organization-integrations'])
    assert.equal(routes[key], undefined)
  for (const key of ['issue', 'settings', 'organization', 'workspace-settings', 'workspace-overview']) {
    const output = await renderScreen(key, 'connected')
    assert.doesNotMatch(
      output,
      /github-url|\/flow\/(?:github|atlas|workspace-integrations|organization-integrations)(?:[?"\/])/i,
      key,
    )
  }
})

test('core does not register or advertise the Gantt view', async () => {
  assert.equal(routes.gantt, undefined)
  assert.doesNotMatch(await renderScreen('board'), /data-value="gantt"/)
})

test('core retains intake forms without automation routes or tools', async () => {
  assert.equal(routes.automations, undefined)
  assert.ok(routes.forms)
  assert.match(await renderScreen('forms'), /data-flow="section"/)
  assert.doesNotMatch(await renderScreen('settings'), /\/flow\/automations|Tự động hóa/)
})

test('core overview and sprint report do not require paid components', async () => {
  assert.equal(routes['epic-map'], undefined)
  assert.ok(routes['sprint-report'])
  assert.match(await renderScreen('workspace-overview'), /data-flow="quality-columns"/)
  assert.doesNotMatch(await renderScreen('epic'), /\/flow\/epic-map/)
})
