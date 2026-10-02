import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString, signal } from '@ketvietlab/ketjs-view'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { createOrganization } from '@ketvietlab/flow-client/organization.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
setFlowLocale('en')
const setup = ({
  canWrite = true,
  record = 'bao',
  params = { accessScope: 'workspace', target: 'product' },
} = {}) => {
  const data = createOrganizationSession('baseline', undefined, { profile: 'realistic' }).call(
      'flow.workspace.bootstrap',
      { companyId: 'demo' },
    ).value,
    nav = [],
    mutations = []
  const org = createOrganization({
    data: signal(data),
    workspaceId: () => 'product',
    projectId: () => null,
    record: () => record,
    params: () => params,
    canWrite: () => canWrite,
    busy: () => false,
    mutate: (fn, args) => mutations.push(args),
    call: async () => {},
    navigate: (key, params) => nav.push([key, params]),
    close: () => {},
    isModal: () => true,
    switchWorkspace: () => {},
  })
  return { data, nav, mutations, org }
}
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

test('members render as one table row per person with access, with no section header repeating the workspace', () => {
  const { data, org } = setup(),
    html = renderToStaticString(org.view('workspace-members'))
  const rows = html.match(/<tr data-open="true"/g) ?? []
  assert.equal(rows.length, 15)
  assert.match(html, /15 with access · 9 in the organization without access/)
  assert.equal(data.members.filter((m) => m.status === 'active').length, 24)
  assert.match(
    html,
    /<th scope="col" data-size="wide">Member<\/th><th scope="col">Access here<\/th><th scope="col">Access via<\/th><th scope="col">Teams<\/th><th scope="col">Organization role<\/th>/,
  )
  assert.match(
    html,
    /<span data-flow="evidence-person"><button[^>]*title="Trần Quốc Bảo"[\s\S]*?<small>bao@example\.test<\/small>/,
  )
  assert.doesNotMatch(
    html,
    /<header>|<h2>|Sản phẩm|type="search"/,
    'the workspace is already in the topbar; no section header repeats it',
  )
  assert.doesNotMatch(html, /data-flow="disclosure"|data-flow="notice"/)
})

test('clicking a row, its name or its button opens that person in the access modal', () => {
  const { nav, org } = setup()
  const view = org.view('workspace-members')
  const rowOpen = handlers(view, '<tr', 'click'),
    nameOpen = handlers(view, '<button type="button" title=', 'click')
  rowOpen[1]({ target: { closest: () => null } })
  assert.deepEqual(nav.pop(), ['member-access', { id: 'bao', accessScope: 'workspace', target: 'product' }])
  rowOpen[1]({ target: { closest: () => ({}) } })
  assert.equal(nav.length, 0, 'a click on a control inside the row is left to that control')
  nameOpen[0]()
  assert.deepEqual(nav.pop(), ['member-access', { id: 'mai', accessScope: 'workspace', target: 'product' }])
})

test('search narrows the table and explains an empty result', () => {
  const { org } = setup()
  handlers(org.topSearch('workspace-members'), 'type="search"', 'input')[0]({ target: { value: 'person9' } })
  const html = renderToStaticString(org.view('workspace-members'))
  assert.equal(html.match(/<tr data-open="true"/g)?.length, 1)
  assert.match(html, /Nguyễn Thảo Vy/)
  handlers(org.topSearch('workspace-members'), 'type="search"', 'input')[0]({
    target: { value: 'nobody-here' },
  })
  assert.match(renderToStaticString(org.view('workspace-members')), /No member matches “nobody-here”/)
})

test('the member modal explains every source and scopes each change to that person', () => {
  const { org, nav, mutations } = setup(),
    html = renderToStaticString(org.modal('member-access'))
  assert.match(html, /Trần Quốc Bảo · bao@example\.test/)
  assert.match(html, /Workspace · Team Engineering/)
  assert.match(html, /Team grant · applies to all 15 people in Engineering/)
  assert.match(html, /Remove for the whole team/)
  handlers(org.modal('member-access'), 'data-flow="button"', 'click').find(
    (_, i, all) => i === all.length - 1,
  )()
  assert.deepEqual(nav.pop(), ['access-grant', { accessScope: 'workspace', target: 'product', user: 'bao' }])
  const remove = handlers(org.modal('member-access'), 'data-flow="button"', 'click')[0]
  remove()
  assert.equal(mutations.pop().action, 'access.revoke')
})

test('read-only viewers can open a member but get no changes, and an unknown person is explained', () => {
  const { org } = setup({ canWrite: false })
  assert.match(renderToStaticString(org.view('workspace-members')), />\s*View\s*<\/button>/)
  const html = renderToStaticString(org.modal('member-access'))
  assert.doesNotMatch(html, /Remove for the whole team|Grant more access|Organization role &amp; work hours/)
  assert.match(
    renderToStaticString(setup({ record: 'ghost' }).org.modal('member-access')),
    /Member not found/,
  )
})

test('granting more access from a member starts with that member selected', () => {
  const pick = (params) =>
    renderToStaticString(setup({ params }).org.modal('access-grant')).match(
      /data-flow="tag-selection">([\s\S]*?)<\/div>/,
    )?.[1] ?? ''
  const vy = setup().data.members.find((m) => m.name === 'Nguyễn Thảo Vy').id
  assert.match(pick({ accessScope: 'workspace', target: 'product', user: vy }), /Nguyễn Thảo Vy/)
  assert.doesNotMatch(pick({ accessScope: 'workspace', target: 'product' }), /Nguyễn Thảo Vy/)
})

test('the prefilled member is the one actually granted when the form is submitted', () => {
  const { org, data, mutations } = setup({
    params: { accessScope: 'workspace', target: 'product', user: 'bao' },
  })
  const submit = handlers(org.modal('access-grant'), '<form', 'submit')[0]
  const saved = globalThis.FormData
  globalThis.FormData = class {
    *[Symbol.iterator]() {
      yield ['scope', 'workspace']
      yield ['targetId', 'product']
      yield ['subjectType', 'user']
      yield ['role', 'viewer']
    }
  }
  try {
    submit({ preventDefault() {}, currentTarget: {} })
  } finally {
    globalThis.FormData = saved
  }
  assert.deepEqual(mutations.pop()?.subjectIds, ['bao'])
  assert.ok(data.members.some((m) => m.id === 'bao'))
})

test('search and the grant action sit in the shell topbar like tasks and documents', () => {
  const { org, nav } = setup()
  assert.doesNotMatch(
    renderToStaticString(org.view('workspace-members')),
    /data-variant="primary"|type="search"/,
  )
  assert.match(
    renderToStaticString(org.topAction('workspace-members')),
    /data-variant="primary"[\s\S]*Grant permissions/,
  )
  handlers(org.topAction('workspace-members'), 'data-flow="button"', 'click')[0]()
  assert.deepEqual(nav.pop(), ['access-grant', { accessScope: 'workspace', target: 'product' }])
  assert.equal(setup({ canWrite: false }).org.topAction('workspace-members'), null)
  assert.equal(org.topAction('organization-members'), null)
  assert.match(
    renderToStaticString(org.topSearch('workspace-members')),
    /type="search"[^>]*aria-label="Search members"/,
  )
  assert.equal(org.topSearch('organization-members'), null)
})
