import { setFlowLocale } from '../src/i18n.mjs'
setFlowLocale('vi')
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { html, renderToStaticString } from '@ketvietlab/ketjs-view'
import * as ui from '../src/index.mjs'
import { FlowEvidenceValue } from '../src/workspace.mjs'

test('loading actions are disabled and named; event handlers never leak into SSR', () => {
  const output = renderToStaticString(
    ui.FlowButton({
      label: 'Lưu',
      loading: true,
      onClick: () => {
        throw new Error('must not execute in SSR')
      },
    }),
  )
  assert.match(output, /disabled/)
  assert.match(output, /aria-busy="true"/)
  assert.match(output, /Lưu/)
  assert.doesNotMatch(output, /on:click|must not execute/)
  const enabled = renderToStaticString(ui.FlowButton({ label: 'Tạo', icon: 'plus', iconOnly: true }))
  assert.match(enabled, /aria-label="Tạo"/)
  assert.doesNotMatch(enabled, /disabled/)
})

test('user-controlled content is escaped in text and attributes', () => {
  const attack = '"><img src=x onerror=alert(1)>'
  const output = renderToStaticString(
    ui.FlowInput({ id: 'title', label: attack, value: attack, error: attack }),
  )
  assert.doesNotMatch(output, /<img/)
  assert.match(output, /&lt;img/)
  assert.match(output, /aria-invalid="true"/)
  assert.match(output, /aria-describedby="title-error"/)
  assert.match(output, /id="title-error"/)
})

test('collections render real options and buttons through KetJS each', () => {
  const options = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ]
  const output = renderToStaticString(
    html`${ui.FlowSelect({ label: 'Chọn', value: 'b', options })}${ui.FlowSegmented({ label: 'View', value: 'b', options, onChange: () => {} })}`,
  )
  assert.equal((output.match(/<option /g) ?? []).length, 2)
  assert.match(output, /value="b" selected/)
  assert.match(output, /aria-pressed="true"/)
  assert.doesNotMatch(output, /\[object Object\]/)
})

test('status retains its text label even in compact mode', () => {
  for (const [status, label] of Object.entries(ui.FLOW_STATUSES)) {
    const output = renderToStaticString(ui.FlowStatus({ status, compact: true }))
    assert.match(output, new RegExp(`data-status="${status}"`))
    assert.ok(output.includes(label))
    assert.match(output, /data-flow="sr"/)
  }
})

test('row selection and record opening are separate accessible controls', () => {
  const task = {
    id: 'FLW-1',
    title: 'Review <script>',
    project: 'Flow',
    status: 'todo',
    priority: 'normal',
    assignee: 'Thu Hà',
    due: 'Mai',
  }
  const output = renderToStaticString(
    ui.FlowTaskRow({ task, selected: false, onSelect: () => {}, onOpen: () => {} }),
  )
  assert.match(output, /aria-label="Chọn FLW-1"/)
  assert.match(output, /<button[^>]+data-flow="task-open"/)
  assert.doesNotMatch(output, /checked|<script>/)
  assert.match(output, /Review &lt;script&gt;/)
})

test('dialog is native and has a unique associated heading', () => {
  const output = renderToStaticString(
    ui.FlowDialog({ id: 'create', title: 'Tạo việc', body: html`<p>Nội dung</p>` }),
  )
  assert.match(output, /<dialog[^>]+aria-labelledby="create-title"/)
  assert.match(output, /<h2 id="create-title">Tạo việc<\/h2>/)
  assert.match(output, /aria-label="Đóng"/)
  assert.doesNotMatch(output, / open[=> ]/)
})

test('package publishes only built output; components have no Suite dependency or shared hooks', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.license, 'MIT')
  assert.ok(Object.values(manifest.exports).every((entry) => JSON.stringify(entry).includes('./dist/')))
  const source = await readFile(new URL('../src/index.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /data-ui=|from ['"].*(?:ketsuite|design-system)/)
  const components = Object.keys(ui).filter((name) => name.startsWith('Flow'))
  assert.equal(components.length, 24)
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /:root|\[data-kv-design-system\]/)
  // Every rule that styles an element must explicitly opt into the Flow root.
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = [...cleaned.matchAll(/(?:^|[{}])\s*([^{}]+)\{/g)].map((match) => match[1].trim())
  for (const selector of selectors) {
    if (selector.startsWith('@') || selector === 'to') continue
    assert.ok(selector.includes('[data-flow-ui]'), `Unscoped CSS: ${selector}`)
  }
})

test('the atlas shell has one page heading and distinct navigation, content and footer', () => {
  const output = renderToStaticString(
    ui.FlowShell({
      title: 'Việc của nhóm',
      breadcrumb: 'Flow',
      sidebar: html`<nav>Điều hướng</nav>`,
      actions: ui.FlowButton({ label: 'Tạo việc' }),
      navigation: html`<nav>Tab dự án</nav>`,
      contentWidth: 'wide',
      children: html`<p>Nội dung</p>`,
      footer: html`<span>Dữ liệu mẫu</span>`,
    }),
  )
  assert.equal((output.match(/<h1>/g) ?? []).length, 1)
  assert.match(output, /<aside[^>]+aria-label="Điều hướng Flow"/)
  assert.match(output, /<main data-flow="shell-main">/)
  assert.match(
    output,
    /<div data-flow="shell-content">\s*<nav>Tab dự án<\/nav>\s*<div data-flow="content-container" data-width="wide"><p>Nội dung<\/p>/,
  )
  assert.match(output, /<footer data-flow="shell-footer">/)
})

test('visual tokens come from the design system without a private palette', async () => {
  // Same repository and release train as the design system: its token source is the contract.
  const upstream = await readFile(
    new URL('../../design-system/src/foundations/tokens.css', import.meta.url),
    'utf8',
  )
  const declared = new Set([...upstream.matchAll(/(--kv-[\w-]+)\s*:/g)].map((match) => match[1]))
  for (const file of ['../src/styles.css', '../demo/demo.css']) {
    const css = await readFile(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(\s*\d|hsla?\(\s*\d/i, 'Do not fork colors')
    assert.doesNotMatch(
      css,
      /font-size:\s*\d|font-weight:\s*\d|border-radius:\s*\d|@font-face/,
      'Use shared typography and radius tokens',
    )
    for (const [, name] of css.matchAll(/var\((--kv-[\w-]+)/g))
      assert.ok(declared.has(name), `Unknown public token: ${name}`)
  }
})

test('workspace components expose custom status labels and separate-tab ERP entry', async () => {
  const { FlowLaunchLink, FlowTable } = await import('../src/workspace.mjs')
  assert.match(
    renderToStaticString(ui.FlowStatus({ status: 'review', label: 'QA nghiệm thu' })),
    /QA nghiệm thu/,
  )
  const link = renderToStaticString(FlowLaunchLink({ href: '/flow/my-work?company=demo' }))
  assert.match(link, /target="_blank"/)
  assert.match(link, /rel="noopener"/)
  assert.match(link, /tab mới/)
  assert.match(
    renderToStaticString(
      ui.FlowSelect({
        label: 'Owner',
        value: 'a',
        options: [{ value: 'a', label: 'A' }],
        disabled: true,
      }),
    ),
    /disabled/,
  )
  assert.match(
    renderToStaticString(
      FlowTable({
        label: 'Work',
        columns: ['Title'],
        children: html`<tr>
          <td>Work</td>
        </tr>`,
      }),
    ),
    /scope="col"/,
  )
})

test('document workspace retains the shared Flow menu and safely renders editable blocks', async () => {
  const { FlowDocsShell, FlowDocEditor } = await import('../src/documents.mjs')
  const editor = FlowDocEditor({
    title: 'A document',
    subtitle: '',
    blocks: [
      { id: 'intro', type: 'heading', text: '<script>unsafe</script>' },
      { id: 'check', type: 'check', text: 'Review', checked: true },
    ],
    readOnly: true,
    onTitle: () => {},
    onText: () => {},
    onFocus: () => {},
    onBlur: () => {},
    onCheck: () => {},
  })
  const output = renderToStaticString(
    FlowDocsShell({
      sidebar: 'Normal Flow navigation',
      top: '',
      navigation: 'Project tabs',
      tree: '',
      toolbar: '',
      inspector: '',
      children: editor,
    }),
  )
  assert.match(output, /aria-label="Điều hướng Flow"/)
  assert.match(output, /Normal Flow navigation/)
  assert.match(output, /data-project-context="true"/)
  assert.match(output, /Project tabs/)
  assert.match(output, /contenteditable="false"/)
  assert.match(output, /&lt;script&gt;unsafe/)
  assert.doesNotMatch(output, /<script>/)
  assert.match(output, /data-flow="checkbox"[^>]*disabled/)
})

test('Atlas viewer slot stays a labeled host without copying viewer markup', async () => {
  const { FlowAtlasViewport } = await import('../src/workspace.mjs')
  const output = renderToStaticString(FlowAtlasViewport({ label: 'Atlas · <private>' }))
  assert.match(output, /data-flow="atlas-viewport"/)
  assert.match(output, /aria-label="Atlas · &lt;private&gt;"/)
  assert.doesNotMatch(output, /iframe|script/)
})

test('Atlas onboarding labels its illustration and keeps setup guidance accessible', async () => {
  const { FlowAtlasWelcome } = await import('../src/workspace.mjs')
  const output = renderToStaticString(
    FlowAtlasWelcome({ projectName: '<Dự án>', action: ui.FlowButton({ label: 'Kết nối GitHub' }) }),
  )
  assert.match(output, /&lt;Dự án&gt;/)
  assert.match(output, /Minh họa/)
  assert.match(output, /<ol[^>]*data-flow="atlas-welcome-steps"/)
  assert.match(output, /<summary>Repository cần có gì\?/)
  assert.equal((output.match(/<button\b/g) || []).length, 1)
})

test('inline task properties retain label associations, error descriptions and native controls', async () => {
  const { FlowPropertyFields, FlowSelectField } = await import('../src/workspace.mjs')
  const output = renderToStaticString(
    FlowPropertyFields({
      children: html`${FlowSelectField({ name: 'owner', label: 'Người phụ trách', icon: 'user', value: 'mai', disabled: true, options: [{ value: 'mai', label: 'Mai Anh' }] })}${ui.FlowInput({ id: 'estimate', label: 'Điểm ước lượng', icon: 'clock', type: 'number', error: 'Nhập số dương' })}`,
    }),
  )
  assert.match(output, /role="group" aria-label="Thuộc tính công việc"/)
  assert.match(output, /for="owner"/)
  assert.match(output, /id="owner"/)
  assert.match(output, /disabled/)
  assert.match(output, /value="mai" selected/)
  assert.match(output, /aria-describedby="estimate-error"/)
  assert.match(output, /aria-hidden="true"/)
  assert.doesNotMatch(output, /\[object Object\]/)
})

test('document tree keeps nested order and offers creation without drag handles', async () => {
  const { FlowDocTree } = await import('../src/documents.mjs')
  const props = {
    items: [
      { id: 'root', title: 'Root' },
      { id: 'z', title: 'Zebra', parentId: 'root' },
      { id: 'a', title: 'Alpha', parentId: 'root' },
    ],
    active: 'a',
    collapsed: [],
    onOpen: () => {},
    onToggle: () => {},
  }
  const readonly = renderToStaticString(FlowDocTree(props))
  assert.ok(readonly.indexOf('Zebra') < readonly.indexOf('Alpha'))
  assert.doesNotMatch(readonly, /doc-tree-drag|doc-tree-add|draggable="true"/)
  const editable = renderToStaticString(
    FlowDocTree({ ...props, onReorder: () => {}, onCreate: () => {}, onAddChild: () => {} }),
  )
  assert.doesNotMatch(editable, /doc-tree-drag/)
  assert.match(editable, /aria-label="Tạo tài liệu con trong Alpha"/)
  assert.ok(editable.indexOf('doc-tree-create') > editable.indexOf('Alpha'))
  assert.match(editable, /draggable="true"/)
})
test('saved view picker identifies the selected view and escapes custom names', async () => {
  const { FlowProjectViews } = await import('../src/workspace.mjs')
  const output = renderToStaticString(
    FlowProjectViews({
      value: 'project-issues',
      selectedView: 'v',
      options: [{ value: 'project-issues', label: 'Danh sách', icon: 'list' }],
      views: [{ id: 'v', title: '<private>' }],
      onChange: () => {},
      onView: () => {},
      onSave: () => {},
    }),
  )
  assert.match(output, /popovertarget="flow-saved-view-menu"/)
  assert.match(output, /aria-current="page"/)
  assert.match(output, /aria-pressed="true"/)
  assert.match(output, /&lt;private&gt;/)
  assert.match(output, /disabled/)
})

test('toast announces escaped feedback politely without taking focus', async () => {
  const { FlowToast } = await import('../src/workspace.mjs')
  const output = renderToStaticString(FlowToast({ message: 'Saved <task>', onClose: () => {} }))
  assert.match(output, /popover="manual"/)
  assert.match(output, /role="status" aria-live="polite" aria-atomic="true"/)
  assert.match(output, /Saved &lt;task&gt;/)
  assert.match(output, /aria-label="Đóng thông báo"/)
  assert.doesNotMatch(output, /autofocus|role="alert"/)
})

test('tag picker renders labeled multiple choices, colors, removal and read-only semantics', async () => {
  const { FlowTagPicker } = await import('../src/workspace.mjs')
  const options = [
    { id: 'a', title: 'Thiết kế', color: 'blue' },
    { id: 'b', title: 'Phát hành', color: 'green' },
    { id: 'c', title: 'Cũ', archived: true },
  ]
  const output = renderToStaticString(FlowTagPicker({ id: 'labels', value: ['a'], options, onChange() {} }))
  assert.equal((output.match(/type="checkbox"/g) ?? []).length, 2)
  assert.match(output, /aria-label="Thiết kế"/)
  assert.match(output, /data-tone="blue"/)
  assert.match(output, /aria-label="Gỡ nhãn Thiết kế"/)
  assert.match(output, /popover="auto"/)
  assert.doesNotMatch(output, /Phân cách|\[object Object\]/)
  const readonly = renderToStaticString(
    FlowTagPicker({ id: 'readonly-labels', value: ['a'], options, disabled: true, onChange() {} }),
  )
  assert.match(readonly, /disabled/)
})

test('whole task rows and cards expose drop targets only when writable, without drag handles', () => {
  const task = {
    id: 'A',
    title: 'Task',
    project: 'Flow',
    status: 'todo',
    priority: 'normal',
    assignee: 'Mai Anh',
    due: '22/09',
  }
  const row = renderToStaticString(
    ui.FlowTaskRow({ task, selected: false, dragCount: 3, onSelect() {}, onOpen() {}, onDropTask() {} }),
  )
  const card = renderToStaticString(ui.FlowTaskCard({ task, onOpen() {}, onDropTask() {} }))
  for (const output of [row, card]) {
    assert.match(output, /data-task-id="A"/)
    assert.match(output, /data-flow-task-drop="item"/)
    assert.doesNotMatch(output, /task-grip/)
  }
  assert.match(row, /aria-label="Chọn A"/)
  assert.match(row, /data-flow-drag-count="3"/)
  assert.doesNotMatch(renderToStaticString(ui.FlowTaskCard({ task, onOpen() {} })), /data-flow-task-drop/)
})

test('timeline renders real date cells and accessible bars in a focusable scroll region', async () => {
  const { FlowTimeline } = await import('../src/workspace.mjs')
  const output = renderToStaticString(
    FlowTimeline({
      label: 'Gantt',
      mode: 'week',
      focusKey: 'week:2026-09-21',
      focusIndex: 0,
      days: [{ id: '2026-09-21', label: '21', today: true }],
      groups: [{ id: 'week', label: 'Tuần 21/09', start: 1, span: 1 }],
      rows: [
        {
          id: 'T1',
          title: 'Task',
          start: 1,
          span: 1,
          dateLabel: '2026-09-21 → 2026-09-21',
          onOpen() {},
          onLocate() {},
        },
      ],
    }),
  )
  assert.match(output, /role="region" tabindex="0"/)
  assert.match(output, /data-date="2026-09-21"/)
  assert.match(output, /data-focus-key="week:2026-09-21"/)
  assert.match(output, /aria-label="Đi tới lịch của T1"/)
  assert.match(output, /Task · 2026-09-21 → 2026-09-21/)
})

test('timeline editing exposes independent accessible handles only for writable, unclipped edges', async () => {
  const { FlowTimeline } = await import('../src/workspace.mjs')
  const props = {
    label: 'Gantt',
    mode: 'week',
    focusKey: 'edit',
    focusIndex: 0,
    days: [{ id: '2026-09-21', label: '21' }],
    groups: [],
    rows: [
      {
        id: 'T1',
        title: 'Task',
        start: 1,
        span: 1,
        rawStart: -4,
        rawSpan: 6,
        dateLabel: 'Dates',
        clippedStart: true,
        onOpen() {},
        onSchedule() {},
      },
    ],
  }
  const html = renderToStaticString(FlowTimeline(props))
  assert.match(html, /data-editable="true"/)
  assert.match(html, /data-raw-start="-4"/)
  assert.match(html, /aria-label="Đổi hạn hoàn thành của T1"/)
  assert.doesNotMatch(html, /aria-label="Đổi ngày bắt đầu của T1"/)
  props.rows[0].onSchedule = undefined
  const read = renderToStaticString(FlowTimeline(props))
  assert.doesNotMatch(read, /data-flow="timeline-resize"/)
  assert.doesNotMatch(read, /data-editable="true"/)
})

test('scope menu labels and destinations remain distinct with a personal footer placement', async () => {
  const { FlowScopeMenu } = await import('../src/workspace.mjs')
  const output = renderToStaticString(
    FlowScopeMenu({ label: 'Mai Anh', placement: 'up', items: [{ label: 'Cài đặt cá nhân', onClick() {} }] }),
  )
  assert.match(output, /data-placement="up"/)
  assert.match(output, /<summary>Mai Anh/)
  assert.match(output, /Cài đặt cá nhân/)
})

test('organization components expose independent context, access sources and project navigation', async () => {
  const {
    FlowSearchTrigger,
    FlowCheckboxField,
    FlowContextPicker,
    FlowUserMenu,
    FlowAccessList,
    FlowProjectDirectory,
  } = await import('../src/workspace.mjs')
  assert.match(
    renderToStaticString(FlowCheckboxField({ label: 'Giữ quyền', checked: true })),
    /<span>Giữ quyền<\/span>/,
  )
  const picker = renderToStaticString(
    FlowContextPicker({
      companyId: 'c',
      workspaceId: 'w',
      companies: [{ id: 'c', name: 'Company' }],
      workspaces: [{ id: 'w', title: 'Workspace' }],
      onManage() {},
      onWorkspace() {},
    }),
  )
  assert.doesNotMatch(picker, /<select|Chuyển tổ chức|Company/)
  assert.match(picker, /Quản lý Workspace/)
  assert.match(picker, /aria-label="Workspace hiện tại"/)
  const search = renderToStaticString(FlowSearchTrigger({ onClick() {} }))
  assert.match(search, /aria-haspopup="dialog"/)
  assert.match(search, /<kbd aria-hidden="true">⌘K<\/kbd>/)
  assert.match(picker, /<details data-flow="context-picker"/)
  assert.match(picker, /Chuyển Workspace: Workspace/)
  assert.match(picker, /aria-current="true"/)
  const userMenu = renderToStaticString(
    FlowUserMenu({
      name: 'An',
      companyId: 'c',
      companies: [{ id: 'c', name: 'Company' }],
      onCompany() {},
      items: [{ label: 'Tổ chức · Company', onClick() {} }],
    }),
  )
  assert.match(userMenu, /data-placement="up"/)
  assert.match(userMenu, /aria-label="Chuyển tổ chức"/)
  assert.match(userMenu, /Tổ chức · Company/)
  const access = renderToStaticString(
    FlowAccessList({
      rows: [{ id: 'a', name: 'An', role: 'Chỉ xem', sources: 'Team → Workspace', status: 'Đã thu hồi' }],
    }),
  )
  assert.match(access, /Team → Workspace/)
  assert.match(access, /Đã thu hồi/)
  const directory = renderToStaticString(
    FlowProjectDirectory({
      onCreate() {},
      projects: [
        { id: 'p', title: 'Private', href: '/flow/board?company=c&workspace=w&project=p', onOpen() {} },
      ],
    }),
  )
  assert.match(directory, /Tạo dự án/)
  assert.doesNotMatch(directory, /<input|<select|project-filters|Tìm dự án|Gần đây/)
  assert.match(directory, /company=c&amp;workspace=w&amp;project=p/)
})

test('layout surfaces distinguish page gutters from embedded content', async () => {
  const { FlowSection, FlowToolbar, FlowMetrics, FlowListItem } = await import('../src/workspace.mjs')
  const embedded = renderToStaticString(
    FlowSection({
      inset: 'none',
      title: 'Nested',
      children: FlowToolbar({
        inset: 'none',
        children: FlowMetrics({ inset: 'none', items: [{ label: 'Done', value: 3 }] }),
      }),
    }),
  )
  assert.equal((embedded.match(/data-inset="none"/g) || []).length, 3)
  assert.match(renderToStaticString(FlowSection({ children: 'Body' })), /data-inset="page"/)
  assert.match(renderToStaticString(FlowToolbar({ children: 'Filters' })), /data-inset="page"/)
  const described = renderToStaticString(
    FlowSection({
      title: 'Workspace',
      description: 'Workspace description',
      actions: 'Manage',
      children: FlowListItem({ title: 'Independent information' }),
    }),
  )
  assert.match(
    described,
    /<header>[\s\S]*data-flow="section-heading"[\s\S]*<h2>Workspace<\/h2><p>Workspace description<\/p>[\s\S]*Manage[\s\S]*<\/header>/,
  )
  assert.match(described, /data-flow="list-item" data-variant="auto"/)
})

test('scope tabs expose addressable destinations and exactly one current page', async () => {
  const { FlowScopeTabs } = await import('../src/workspace.mjs')
  const out = renderToStaticString(
    FlowScopeTabs({
      label: 'Workspace · Product',
      value: 'members',
      options: [
        {
          value: 'overview',
          label: 'Tổng quan',
          icon: 'grid',
          href: '/flow/workspace-overview?company=c&workspace=w',
        },
        {
          value: 'members',
          label: 'Thành viên',
          icon: 'list',
          href: '/flow/workspace-members?company=c&workspace=w',
        },
      ],
      onChange() {},
    }),
  )
  assert.match(out, /<nav data-flow="scope-tabs" aria-label="Workspace · Product"/)
  assert.equal((out.match(/aria-current="page"/g) || []).length, 1)
  assert.match(out, /href="\/flow\/workspace-members\?company=c&amp;workspace=w" aria-current="page"/)
  assert.doesNotMatch(out, /role="tab"|<details|popover/)
})

test('responsive task rail keeps one set of fields inside its original form', async () => {
  const { FlowRecordLayout, FlowRecordAsideTrigger } = await import('../src/workspace.mjs')
  const out = renderToStaticString(
    ui.FlowDialog({
      id: 'task',
      size: 'task',
      title: 'Task',
      headerActions: FlowRecordAsideTrigger({ controls: 'task-properties' }),
      body: html`<form id="create">${FlowRecordLayout({ asideId: 'task-properties', main: 'Main', aside: ui.FlowInput({ id: 'priority', label: 'Priority' }) })}</form>`,
    }),
  )
  assert.match(out, /popovertarget="task-properties" aria-controls="task-properties"/)
  assert.match(out, /id="task-properties" aria-label="Thuộc tính công việc" data-flow-record-panel/)
  assert.equal((out.match(/id="priority"/g) || []).length, 1)
  assert.ok(
    out.indexOf('id="create"') < out.indexOf('id="priority"') &&
      out.indexOf('id="priority"') < out.indexOf('</form>'),
  )
  assert.match(out, /aria-label="Đóng thuộc tính"/)
})

test('spotlight exposes combobox/listbox selection and bounded dialog semantics', async () => {
  const { FlowSpotlight } = await import('../src/workspace.mjs')
  const render = (groups) =>
    renderToStaticString(
      FlowSpotlight({
        id: 'search',
        query: '',
        activeId: 'missing',
        scope: 'Company',
        groups,
        onQuery() {},
        onActive() {},
        onSelect() {},
        onClose() {},
      }),
    )
  const out = render([
    {
      id: 'tasks',
      label: 'Công việc',
      items: [{ id: 'task:1', title: 'A task', description: 'Core', icon: 'list' }],
    },
  ])
  assert.match(out, /data-size="spotlight"/)
  assert.match(out, /role="combobox"/)
  assert.match(out, /aria-activedescendant="search-option-task%3A1"/)
  assert.match(out, /role="option" aria-selected="true"/)
  assert.match(out, /autofocus/)
  const empty = render([])
  assert.match(empty, /Không tìm thấy kết quả/)
  assert.doesNotMatch(empty, /aria-activedescendant=/)
})

test('setup form owns responsive field grid, submit actions and rich inheritance content', async () => {
  const { FlowSetupForm, FlowFormGrid, FlowNotice, FlowProperties } = await import('../src/workspace.mjs')
  const output = renderToStaticString(
    FlowSetupForm({
      onSubmit: () => {},
      children: FlowFormGrid({
        children: FlowNotice({
          title: 'Kế thừa',
          children: FlowProperties({ items: [{ label: 'Engineering', value: 'Chỉnh sửa' }] }),
        }),
      }),
      actions: ui.FlowButton({ label: 'Tạo dự án', type: 'submit' }),
    }),
  )
  assert.match(output, /data-flow="setup-form"/)
  assert.match(output, /data-flow="form-grid"/)
  assert.match(output, /type="submit"/)
  assert.doesNotMatch(output, /<p>\s*<dl/)
  assert.match(output, /Engineering/)
})
test('task-focused shared surfaces expose disclosure, grouped content and named calendar actions', async () => {
  const { FlowDisclosure, FlowList, FlowListItem, FlowHint, FlowCalendarEvent } = await import(
    '../src/workspace.mjs'
  )
  const output = renderToStaticString(
    FlowDisclosure({
      title: 'Căn cứ',
      children: FlowList({
        children: FlowListItem({
          title: 'Đầu ra',
          description: FlowHint({ children: 'Đã kiểm chứng' }),
          actions: FlowCalendarEvent({ label: 'Mở KV-142', title: 'Bàn giao', onClick: () => {} }),
        }),
      }),
    }),
  )
  assert.match(output, /<details[^>]*data-flow="disclosure"/)
  assert.match(output, /<summary>/)
  assert.match(output, /aria-label="Mở KV-142"/)
  assert.doesNotMatch(output, /\[object Object\]/)
  const input = renderToStaticString(
    ui.FlowInput({ id: 'capacity-mai', name: 'hours', label: 'Giờ khả dụng' }),
  )
  assert.match(input, /for="capacity-mai"/)
  assert.match(input, /name="hours"/)
})

test('configured status color preserves its semantic label and completion marker', () => {
  const output = renderToStaticString(ui.FlowStatus({ status: 'done', label: 'Đã bàn giao', color: 'red' }))
  assert.match(output, /data-color="red"/)
  assert.match(output, /data-status="done"/)
  assert.match(output, /Đã bàn giao/)
  assert.match(output, /status-mark/)
})

test('table headings support a named mixed select-all checkbox', async () => {
  const { FlowTable } = await import('../src/workspace.mjs')
  const output = renderToStaticString(
    FlowTable({
      label: 'Công việc',
      columns: [
        ui.FlowCheckbox({ label: 'Chọn tất cả công việc trong nhóm', checked: false, indeterminate: true }),
        'Công việc',
      ],
      children: null,
    }),
  )
  assert.match(output, /<th scope="col"><input/)
  assert.match(output, /aria-checked="mixed"/)
  assert.match(output, /data-flow-indeterminate="true"/)
  assert.match(output, /aria-label="Chọn tất cả công việc trong nhóm"/)
})

test('error toast carries its recovery action inside the active dialog', async () => {
  const { FlowToast } = await import('../src/workspace.mjs')
  const toast = FlowToast({
    title: 'Chưa lưu được',
    message: 'Kết nối gián đoạn',
    tone: 'error',
    onClose: () => {},
    action: ui.FlowButton({ label: 'Thử lại', onClick: () => {} }),
  })
  const output = renderToStaticString(
    ui.FlowDialog({ id: 'edit', title: 'Chỉnh sửa', body: html`<p>Thông tin</p>`, feedback: toast }),
  )
  assert.match(output, /data-flow="toast" data-tone="error"/)
  assert.match(output, /role="alert" aria-live="assertive"/)
  assert.match(output, /Thử lại/)
  assert.ok(output.indexOf('data-flow="toast"') > output.indexOf('data-flow="dialog-body"'))
  assert.ok(output.indexOf('data-flow="toast"') < output.indexOf('</dialog>'))
})

test('the shared tone tint never fills text-only surfaces as a bare block', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  assert.match(
    css.replace(/\s+/g, ''),
    /:is\(\[data-flow="hint"\],\[data-flow="metric"\]\)\[data-tone\]\{background:none;\}/,
  )
  assert.doesNotMatch(
    css,
    /\[data-flow="evidence-value"\]\[data-tone/,
    'evidence cells show status through FlowTag',
  )
  assert.doesNotMatch(renderToStaticString(FlowEvidenceValue({ value: 'x' })), /data-tone/)
})
