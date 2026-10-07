// The access tab of the user record modal: what a person holds, and the two
// steps it takes to change it. The views are render-pure, so they are read here
// the way the runtime renders them — through the definition, with a context
// standing in for what the runtime would have supplied.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  userModalDefinition,
  userPageDefinition,
} from '../packages/ketsuite/src/modules/user_backend/modal/user-modal-view.tsx'
import type { UserModalData } from '../packages/ketsuite/src/modules/user_backend/modal/user-modal-view.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import type { JSXChild } from '@ketvietlab/ketjs-view'

/** A view returns any child; rendering one is what the runtime does with it. */
const render = (node: JSXChild): string => renderToString(<>{node}</>)

type Options = {
  state?: Record<string, string>
  drafts?: Record<string, string>
  dialog?: { name: string; params: Record<string, string> } | null
  outcome?: { command: string; value: unknown } | null
}

const assignment = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  id: 'a1',
  roleId: 'care-agent',
  roleName: 'Chăm sóc khách hàng',
  scopeKind: 'branch',
  scopeKey: 'branch:company-a:cau-giay',
  companyId: 'company-a',
  branchId: 'cau-giay',
  company: 'An Việt Miền Bắc',
  branch: 'Cầu Giấy',
  ...over,
})

const dataOf = (over: Partial<UserModalData> = {}): UserModalData => ({
  record: {
    id: 'trang',
    name: 'Minh Trang',
    login: 'minhtrang',
    email: 'trang@ketviet.test',
    accessKind: 'internal',
    active: true,
    superuser: false,
    lastLoginAt: '16/09/2026 08:42',
    passwordReady: true,
    defaultCompanyId: 'company-a',
    defaultBranchId: 'cau-giay',
  },
  companies: [{ id: 'company-a', name: 'An Việt Miền Bắc' }],
  branches: [{ id: 'cau-giay', name: 'Cầu Giấy', companyId: 'company-a' }],
  assignments: [assignment()],
  audit: [],
  memberships: { companies: ['company-a'], branches: ['cau-giay'] },
  roleCoverage: {
    'care-agent': [
      { key: 'crm.care', labels: { vi: 'Chăm sóc', en: 'Care' }, covered: 4, total: 4 },
      { key: 'crm.claim', labels: { vi: 'Khiếu nại', en: 'Claims' }, covered: 2, total: 5 },
    ],
  },
  roles: [{ id: 'care-agent', name: 'Chăm sóc khách hàng' }],
  scopeKinds: ['company', 'branch', 'tenant'],
  revision: 7,
  permissions: {
    create: true,
    save: true,
    assign: true,
    remove: true,
    preview: true,
    resetPassword: true,
    audit: true,
    workplaces: true,
  },
  lang: 'vi',
  ...over,
})

const contextOf = (data: UserModalData, options: Options = {}): RecordModalContext<UserModalData> => ({
  kind: 'user.user',
  id: data.record.id,
  creating: false,
  tab: 'access',
  data,
  t: (key) => key,
  fieldError: () => null,
  draft: (name, fallback = '') => options.drafts?.[name] ?? fallback,
  draftChecked: (name, value = '1', fallback = false) => options.drafts?.[name] === value || fallback,
  outcome: <T,>(command: string) =>
    options.outcome?.command === command ? (options.outcome.value as T) : null,
  busy: false,
  dialog: options.dialog ?? null,
  href: () => '',
  state: (key, fallback = '') => options.state?.[key] ?? fallback,
})

const tabView = (id: string) => {
  const tab = (userModalDefinition.tabs ?? []).find((item) => item.id === id)
  assert.ok(tab, `the modal has a ${id} tab`)
  return tab.view
}

const dialogView = (name: string) => {
  const dialog = userModalDefinition.dialogs?.[name]
  assert.ok(dialog, `the modal has an ${name} dialog`)
  return dialog.view
}

const PREVIEW = {
  ok: true,
  contexts: [
    {
      companyId: 'company-a',
      branchId: 'cau-giay',
      superuser: false,
      sensitiveChange: true,
      bundles: [
        { key: 'crm.care', labels: { vi: 'Chăm sóc', en: 'Care' }, before: 0, after: 4, total: 4 },
        { key: 'crm.claim', labels: { vi: 'Khiếu nại', en: 'Claims' }, before: 1, after: 2, total: 5 },
      ],
    },
  ],
}

test('the access tab groups what a person holds by the place it applies', () => {
  const html = render(
    tabView('access')(
      contextOf(
        dataOf({
          assignments: [
            assignment(),
            assignment({ id: 'a2', roleId: 'cashier', roleName: 'Thu ngân' }),
            assignment({
              id: 'a3',
              roleId: 'auditor',
              roleName: 'Kiểm toán',
              scopeKind: 'tenant',
              scopeKey: 'tenant',
              companyId: null,
              branchId: null,
              company: null,
              branch: null,
            }),
          ],
        }),
      ),
    ),
  )

  // Two places, named as the person reads them — not two copies of one table.
  assert.match(html, /An Việt Miền Bắc · Cầu Giấy/)
  assert.match(html, /scope\.choice\.tenant/)
  assert.equal(html.match(/data-ui="table"/g)?.length, 2)
  // Every role opens itself, carrying the assignment the remove command needs.
  assert.match(html, /data-record-dialog="role"[^>]*data-record-param-id="a1"/)
  assert.match(html, /data-record-dialog="role"[^>]*data-record-param-id="a3"/)
  assert.match(html, /data-record-dialog="assign"/)
})

test('a viewer who may not assign is told so instead of being offered the action', () => {
  const html = render(
    tabView('access')(contextOf(dataOf({ permissions: { ...dataOf().permissions, assign: false } }))),
  )

  assert.doesNotMatch(html, /data-record-dialog="assign"/)
  assert.match(html, /access\.readOnlyHint/)
})

test('assigning asks for the consequence before it offers to commit', () => {
  const asked = render(dialogView('assign')(contextOf(dataOf())))

  // Before an answer there is one submit, and it is the one that writes nothing.
  assert.match(asked, /name="__command" value="previewAssign"/)
  assert.doesNotMatch(asked, /name="__command" value="assign"/)

  const answered = render(
    dialogView('assign')(
      contextOf(dataOf(), {
        outcome: { command: 'previewAssign', value: PREVIEW },
        drafts: { role_care_agent: '1' },
      }),
    ),
  )

  // The answer is on screen, and only now is the commit offered beside it.
  assert.match(answered, /preview\.sensitiveTitle/)
  assert.match(answered, /Chăm sóc/)
  assert.match(answered, /coverage\.none/)
  assert.match(answered, /coverage\.full/)
  assert.match(answered, /coverage\.partial/)
  assert.match(answered, /name="__command" value="assign"/)
})

test('a role dialog says where the role applies and takes it back behind a preview', () => {
  const open = { name: 'role', params: { id: 'a1' } }
  const html = render(dialogView('role')(contextOf(dataOf(), { dialog: open })))

  // Titled with the role, so the body says where it applies, who gave it and whether it gives
  // anything, in the words the page uses.
  assert.doesNotMatch(html, /field\.assignment/)
  assert.match(html, /page\.scopeColumn[\s\S]*An Việt Miền Bắc · Cầu Giấy/)
  assert.match(html, /access\.sourceColumn/)
  assert.match(html, /page\.stateColumn[\s\S]*page\.roleState\.current/)
  // What the role is for: the areas it touches and how much of each it holds.
  assert.match(html, /Chăm sóc/)
  assert.match(html, /coverage\.full/)
  assert.match(html, /Khiếu nại/)
  assert.match(html, /coverage\.partial/)
  assert.doesNotMatch(html, /name="reason"/)
  assert.match(html, /name="__command" value="previewUnassign"/)
  // Removal is committed only after its own preview, like an assignment.
  assert.doesNotMatch(html, /name="__command" value="unassign"/)

  const answered = render(
    dialogView('role')(
      contextOf(dataOf(), { dialog: open, outcome: { command: 'previewUnassign', value: PREVIEW } }),
    ),
  )
  assert.match(answered, /name="__command" value="unassign"/)

  // A company-wide role reads as the page reads it, and one whose template moved on says so.
  const companyWide = render(
    dialogView('role')(
      contextOf(
        dataOf({
          assignments: [
            assignment({
              scopeKind: 'company',
              scopeKey: 'company:company-a',
              branchId: null,
              branch: null,
              roleState: 'stale',
            }),
          ],
        }),
        { dialog: open },
      ),
    ),
  )
  assert.match(companyWide, /An Việt Miền Bắc · user_backend\.page\.allBranches/)
  assert.match(companyWide, /page\.roleState\.stale/)
})

test('a viewer who may not remove sees the role without a way to take it back', () => {
  const html = render(
    dialogView('role')(
      contextOf(dataOf({ permissions: { ...dataOf().permissions, remove: false } }), {
        dialog: { name: 'role', params: { id: 'a1' } },
      }),
    ),
  )

  assert.match(html, /An Việt Miền Bắc · Cầu Giấy/)
  assert.doesNotMatch(html, /name="__command"/)
})

test('the sign-in tab offers a reset and nothing else, and shows what it gets back once', () => {
  const before = render(tabView('login')(contextOf(dataOf())))

  assert.match(before, /login\.accountTitle/)
  assert.match(before, /name="__command"|value="resetPassword"|command="resetPassword"/)
  // The block the mock dropped: no session list, no setting somebody else's password.
  assert.doesNotMatch(before, /session|Session/i)
  assert.doesNotMatch(before, /login\.oneTimeLabel/, 'nothing to show before a reset')

  const after = render(
    tabView('login')(
      contextOf(dataOf(), { outcome: { command: 'resetPassword', value: { ok: true, token: 'k3t-9f2x' } } }),
    ),
  )
  assert.match(after, /k3t-9f2x/, 'the one-time credential reaches the reader')
  assert.match(after, /login\.oneTimeHint/)
})

test('a viewer who may not reset sees the account without the action', () => {
  const html = render(
    tabView('login')(contextOf(dataOf({ permissions: { ...dataOf().permissions, resetPassword: false } }))),
  )

  assert.match(html, /login\.accountTitle/)
  assert.doesNotMatch(html, /type="submit"/)
  assert.match(html, /login\.readOnlyHint/)
})

test('the log says what changed and who did it — and is its own permission', () => {
  const rows = [
    {
      id: 'e1',
      event: 'authorization.assignment.created',
      occurredAt: '16/09/2026 09:10',
      actor: 'an@ketviet.test',
      reason: 'Chuyển sang tổ chăm sóc',
      scopeKey: 'branch:company-a:cau-giay',
      outcome: 'success',
      roleIds: ['care-agent'],
    },
  ]
  const html = render(tabView('audit')(contextOf(dataOf({ audit: rows }))))

  assert.match(html, /audit\.event\.authorization\.assignment\.created/)
  assert.match(html, /an@ketviet\.test/)
  assert.doesNotMatch(html, /Chuyển sang tổ chăm sóc/)
  // The role is named, not shown as the id it was recorded under.
  assert.match(html, /Chăm sóc khách hàng/)
  assert.match(html, /audit\.outcome\.success/)

  const empty = render(tabView('audit')(contextOf(dataOf())))
  assert.match(empty, /audit\.empty/)

  // Without the read the tab is not offered at all.
  const tab = (userModalDefinition.tabs ?? []).find((item) => item.id === 'audit')!
  assert.equal(tab.visible?.(contextOf(dataOf({ audit: rows }))), true)
  assert.equal(
    tab.visible?.(contextOf(dataOf({ permissions: { ...dataOf().permissions, audit: false } }))),
    false,
  )
})

test('the profile dialog edits who a person is and where they work as two decisions', () => {
  const html = render(dialogView('edit')(contextOf(dataOf())))

  assert.match(html, /name="__command" value="save"|command="save"/)
  assert.match(html, /users\.workplaceTitle/)
  // The company they already work for comes back ticked, and its branch is offered
  // because that company is held.
  assert.match(html, /name="company_company-a"[^>]*checked/)
  assert.match(html, /name="branch_cau-giay"/)
  assert.match(html, /name="defaultCompanyId"/)
  assert.doesNotMatch(html, /name="workplaceReason"/)

  // A company nobody ticked offers none of its branches.
  const other = render(
    dialogView('edit')(
      contextOf(
        dataOf({
          companies: [
            { id: 'company-a', name: 'An Việt Miền Bắc' },
            { id: 'company-b', name: 'An Việt Miền Nam' },
          ],
          branches: [
            { id: 'cau-giay', name: 'Cầu Giấy', companyId: 'company-a' },
            { id: 'thao-dien', name: 'Thảo Điền', companyId: 'company-b' },
          ],
        }),
      ),
    ),
  )
  assert.match(other, /name="branch_cau-giay"/)
  assert.doesNotMatch(other, /name="branch_thao-dien"/)

  // Without the authority the workplace form is not offered at all.
  const reader = render(
    dialogView('edit')(contextOf(dataOf({ permissions: { ...dataOf().permissions, workplaces: false } }))),
  )
  assert.doesNotMatch(reader, /users\.workplaceTitle/)
})

test('the commands send the selection the person made, and the revision they were shown', () => {
  const commands = userModalDefinition.commands ?? {}
  const context = contextOf(dataOf(), { dialog: { name: 'role', params: { id: 'a1' } } })

  const form = new FormData()
  form.set('scopeKind', 'branch')
  form.set('companyId', 'company-a')
  form.set('branchId', 'cau-giay')
  form.set('role_care-agent', '1')
  form.set('reason', 'Chuyển sang tổ chăm sóc')

  const preview = commands.previewAssign!.input(form, context, {})
  assert.equal(commands.previewAssign!.fn, 'user.previewRoleAssignment')
  assert.equal(commands.previewAssign!.preview, true)
  assert.deepEqual(preview.roleIds, ['care-agent'])
  // A preview asks for no reason and no revision: it changes nothing.
  assert.equal('reason' in preview, false)
  assert.equal('expectedAuthorizationRevision' in preview, false)

  const assign = commands.assign!.input(form, context, {})
  assert.equal(commands.assign!.fn, 'user.assignRoles')
  assert.deepEqual(assign.roleIds, ['care-agent'])
  assert.equal('reason' in assign, false)
  assert.equal(assign.expectedAuthorizationRevision, 7)
  assert.equal(assign.addMembership, true)

  const unassign = commands.unassign!.input(form, context, {})
  assert.equal(commands.unassign!.fn, 'user.unassignScopedRole')
  assert.equal(unassign.assignmentId, 'a1')
  assert.equal(unassign.roleId, 'care-agent')
  // The scope the row was stored with, not one re-derived from its display names.
  assert.equal(unassign.scopeKey, 'branch:company-a:cau-giay')
  assert.equal('reason' in unassign, false)
  assert.equal(unassign.expectedAuthorizationRevision, 7)
})

test('the sign-in tab never links provider identities, even for a viewer who may list them', () => {
  // Linked identities are system configuration Két Việt runs; the tenant administrator never sees them.
  for (const identities of [true, false]) {
    const html = render(
      tabView('login')(contextOf(dataOf({ permissions: { ...dataOf().permissions, identities } }))),
    )
    assert.doesNotMatch(html, /\/admin\/oauth\/identities|login\.identities/u)
  }
})

test('user identity is rendered once in modal chrome; body header contains only actions', () => {
  const context = contextOf(dataOf())
  assert.equal(userModalDefinition.title(context), 'Minh Trang')
  assert.equal(userModalDefinition.description?.(context), 'minhtrang')
  assert.match(render(userModalDefinition.status?.(context)), /data-ui="badge"/u)
  const header = render(userModalDefinition.header?.(context))
  assert.doesNotMatch(header, /Minh Trang|minhtrang|data-ui="record-summary"/u)
  assert.match(header, /data-record-dialog="edit"/u)
})

test('user tabs and nested dialogs never ask for a change reason', () => {
  const context = contextOf(dataOf())
  for (const tab of userModalDefinition.tabs ?? []) {
    assert.doesNotMatch(
      render(tab.view(context)),
      /name="(?:reason|workplaceReason|breakGlassReason)"|field.reason/u,
      tab.id,
    )
  }
  for (const name of ['assign', 'role', 'edit']) {
    const html = render(dialogView(name)(contextOf(dataOf(), { dialog: { name, params: { id: 'a1' } } })))
    assert.doesNotMatch(html, /name="(?:reason|workplaceReason|breakGlassReason)"|field.reason/u, name)
  }
})

test('an account Két Việt is still preparing tells the administrator to wait, with no identity operation to run', () => {
  const html = render(
    tabView('login')(
      contextOf(
        dataOf({
          externalCredential: {
            state: 'unprovisioned',
            activated: false,
            operationId: null,
            claimable: false,
            emailState: null,
          },
          permissions: {
            ...dataOf().permissions,
            provisionCredential: true,
            resetPassword: false,
            sendLink: false,
          },
        }),
      ),
    ),
  )
  assert.match(html, /login\.externalState\.handling/u)
  assert.doesNotMatch(html, /provisionCredential|retryCredential|refreshAccount|oauth\/identities/u)
  assert.doesNotMatch(html, /data-record-command="resetPassword"/u)
})

// ── The person as a page ──────────────────────────────────────────────────────

const pageData = (over: Partial<UserModalData> = {}): UserModalData =>
  dataOf({
    areas: [
      { key: 'crm', label: 'CRM', level: 'edit', partial: true, via: ['Chăm sóc khách hàng'] },
      { key: 'sale', label: 'Bán hàng', level: 'view', partial: false, via: ['Chăm sóc khách hàng'] },
    ],
    areasWithout: ['Kho', 'Kế toán'],
    surfaces: [
      {
        key: 'crm.cases',
        label: 'Hồ sơ CRM',
        area: 'CRM',
        areaKey: 'crm',
        status: 'partial',
        missing: [{ key: 'partner.read', label: 'Khách hàng', tier: 'read' }],
        via: ['Chăm sóc khách hàng'],
        fixes: [],
      },
      {
        key: 'sale.orders',
        label: 'Đơn bán',
        area: 'Bán hàng',
        areaKey: 'sale',
        status: 'full',
        missing: [],
        via: ['Chăm sóc khách hàng'],
        fixes: [],
      },
    ],
    ...over,
  })

const pageBody = (data: UserModalData): string => {
  assert.ok(userPageDefinition.body, 'the page has one body')
  return render(userPageDefinition.body(contextOf(data)))
}

test("a person's page is one card per question, in order, without tabs", () => {
  assert.equal(userPageDefinition.tabs, undefined, 'a page has no tabs')
  assert.equal(userPageDefinition.extensionTabs, undefined)
  const html = pageBody(pageData())
  assert.doesNotMatch(html, /data-ui="tabbed-view"/u)
  const order = [
    'user_backend.page.accountTitle',
    'user_backend.users.workplaceTitle',
    'user_backend.page.accessTitle',
    'user_backend.page.rolesTitle',
    'user_backend.page.auditTitle',
  ].map((key) => html.indexOf(key))
  assert.ok(
    order.every((at) => at >= 0),
    'every card is on the page',
  )
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    'who, where, what, why, then history',
  )
  // Each answer is its own titled card, side by side on the page: none wraps the others.
  assert.match(html, /^(?:<!--k\[-->)*<div data-ui="surface"[^>]*data-has-heading="true"/u)
  assert.equal(html.match(/data-ui="surface"/gu)?.length, 5, 'one card per answer, and no card around them')
  assert.equal(html.match(/data-has-heading="true"/gu)?.length, 5)
  assert.doesNotMatch(html, /data-divided="true"/u, 'cards are separated by the page, not by hairlines')
  // Every table in a card stacks its rows on a phone instead of scrolling sideways.
  const tables = html.match(/data-pattern="data-table"[^>]*/gu) ?? []
  assert.ok(tables.length >= 3)
  assert.ok(
    tables.every((tag) => /data-responsive="stack"/u.test(tag)),
    'no card scrolls sideways on a phone',
  )
  // Each fact is said once.
  assert.equal(html.match(/user_backend\.field\.login</gu)?.length, 1)
  assert.equal(html.match(/user_backend\.login\.lastSignIn</gu)?.length, 1)
  // Where they are admitted is a table of its own, edited in its own dialog.
  const workplaces = html.slice(
    html.indexOf('user_backend.users.workplaceTitle'),
    html.indexOf('user_backend.page.accessTitle'),
  )
  assert.match(workplaces, /data-record-dialog="workplaces"/u)
  assert.match(workplaces, /An Việt Miền Bắc[\s\S]*?Cầu Giấy/u)
})

test('where nobody is admitted, the page says no role can apply', () => {
  const html = pageBody(pageData({ memberships: { companies: [], branches: [] } }))
  assert.match(html, /user_backend\.page\.workplacesEmptyTitle/u)
})

test('each area reads as one of four levels, with the roles that give it', () => {
  const html = pageBody(pageData())
  const access = html.slice(
    html.indexOf('user_backend.page.accessTitle'),
    html.indexOf('user_backend.page.rolesTitle'),
  )
  // A partly held level says so in the same badge.
  assert.match(access, />CRM<[\s\S]*?user_backend\.level\.partialOf[\s\S]*?Chăm sóc khách hàng/u)
  assert.match(access, />Bán hàng<[\s\S]*?user_backend\.level\.view/u)
  // A gap leads; each screen is one step away, not on the page.
  assert.match(access, /user_backend\.area\.gapTitle/u)
  assert.match(access, /data-record-dialog="diagnostics"/u)
  assert.doesNotMatch(access, /Hồ sơ CRM/u)
  // What they cannot do is one closed line, not a list of everything.
  assert.match(access, /user_backend\.area\.without[\s\S]*?Kho, Kế toán/u)
})

test('access says why it is empty before any area is read', () => {
  const base = pageData()
  const superuser = pageBody(
    pageData({
      record: { ...base.record, superuser: true },
      standing: { state: 'superuser', staleRoles: [] },
    }),
  )
  assert.match(superuser, /user_backend\.area\.superuserHint/u)
  assert.doesNotMatch(superuser, /user_backend\.level\.|data-record-dialog="diagnostics"/u)

  const archived = pageBody(pageData({ areas: [], standing: { state: 'inactive', staleRoles: [] } }))
  assert.match(archived, /user_backend\.standing\.inactiveTitle/u)
  assert.doesNotMatch(archived, /user_backend\.area\.emptyTitle/u, 'not "no role": the account is archived')

  const outside = pageBody(pageData({ areas: [], standing: { state: 'outside', staleRoles: [] } }))
  assert.match(outside, /user_backend\.standing\.outsideTitle/u)

  const stale = pageBody(
    pageData({
      assignments: [assignment({ roleState: 'stale' })],
      standing: { state: 'measured', staleRoles: ['Chăm sóc khách hàng'] },
    }),
  )
  assert.match(stale, /user_backend\.standing\.staleTitle/u)
  assert.match(stale, /user_backend\.page\.roleState\.stale/u)
})

test('a held role is something to open, placed by scope and source, and says whether it gives anything', () => {
  const html = pageBody(
    pageData({
      assignments: [
        assignment(),
        assignment({
          id: 'a2',
          roleId: 'viewer',
          roleName: 'Xem báo cáo',
          scopeKind: 'tenant',
          scopeKey: 'tenant',
          company: null,
          branch: null,
          source: { kind: 'policy', policyId: 'p1', policyName: 'Phòng CSKH' },
        }),
        assignment({ id: 'a3', scopeKind: 'company', scopeKey: 'company:company-a', branch: null }),
      ],
    }),
  )
  const roles = html.slice(
    html.indexOf('user_backend.page.rolesTitle'),
    html.indexOf('user_backend.page.auditTitle'),
  )
  // The role reads as the row's name; its own "view" opens it, described by that name.
  assert.match(
    roles,
    /<span data-ui="text" id="user-role-a1"[^>]*>(?:<!--k\[?-->)*Chăm sóc khách hàng(?:<!--k\]?-->)*<\/span>/u,
  )
  assert.match(
    roles,
    /data-record-dialog="role" data-record-param-id="a1">(?:<!--k\[-->)*<button[^>]*aria-describedby="user-role-a1"/u,
  )
  // Widest first: the whole organisation, a whole company, then one branch.
  assert.match(
    roles,
    /user_backend\.scope\.choice\.tenant[\s\S]*?An Việt Miền Bắc · user_backend\.page\.allBranches[\s\S]*?An Việt Miền Bắc · Cầu Giấy/u,
  )
  assert.match(roles, /user_backend\.access\.source\.manual/u)
  assert.match(roles, /user_backend\.access\.source\.policy/u)
  assert.match(roles, /user_backend\.page\.roleState\.current/u)
})

test('the history names who changed it, never the key they were recorded under', () => {
  const entry = (id: string, actor: unknown) => ({
    id,
    event: 'authorization.assignment.created',
    occurredAt: '2026-09-16T09:10:00+07:00',
    actor,
    scopeKey: 'tenant',
    outcome: 'success',
    roleIds: ['r-gone'],
    roles: ['Kế toán cũ'],
  })
  const html = pageBody(
    pageData({
      audit: [
        entry('e1', { kind: 'user', name: 'Lan Anh' }),
        entry('e2', { kind: 'policy', name: 'Phòng CSKH' }),
        entry('e3', { kind: 'system', name: null }),
      ],
    }),
  )
  const history = html.slice(html.indexOf('user_backend.page.auditTitle'))
  assert.match(history, /Lan Anh/u)
  assert.match(history, /user_backend\.page\.actor\.policy/u)
  assert.match(history, /user_backend\.page\.actor\.system/u)
  assert.match(history, /Kế toán cũ/u)
  assert.doesNotMatch(history, /r-gone|\[object Object\]/u)
})

test('on the page, editing a person and moving their workplaces are two dialogs', () => {
  const edit = userPageDefinition.dialogs?.edit
  const workplaces = userPageDefinition.dialogs?.workplaces
  assert.ok(edit && workplaces)
  const profile = render(edit.view(contextOf(pageData())))
  assert.match(profile, /name="__command" value="save"|command="save"/u)
  assert.doesNotMatch(profile, /user_backend\.users\.workplaceTitle|company_company-a/u)
  assert.match(render(workplaces.view(contextOf(pageData()))), /company_company-a/u)
})

test('a moment reads the same way everywhere on the page', () => {
  const html = pageBody(
    pageData({ record: { ...pageData().record, lastLoginAt: '2026-09-28T08:42:00+07:00' } }),
  )
  assert.doesNotMatch(html, /2026-09-28T/u)
  assert.match(html, /\d{2}\/\d{2}\/2026/u)
})

test('the page header offers editing and assigning only to whoever may do them', () => {
  assert.ok(userPageDefinition.pageActions)
  const all = render(userPageDefinition.pageActions(contextOf(pageData())))
  assert.match(all, /data-record-dialog="edit"[\s\S]*?data-record-dialog="assign"/u)
  const self = render(
    userPageDefinition.pageActions(
      contextOf(
        pageData({ actor: { self: true, superuser: false }, permissions: { save: true, assign: true } }),
      ),
    ),
  )
  assert.doesNotMatch(self, /data-record-dialog="assign"/u, 'nobody assigns themselves a role')
  assert.equal(
    userPageDefinition.pageActions(contextOf(pageData({ permissions: {} }))),
    undefined,
    'a reader who may change nothing is offered nothing',
  )
})

test('creating someone lands on their page', () => {
  const create = userModalDefinition.commands?.create
  assert.ok(create?.navigate)
  assert.equal(create.navigate({ id: 'p 1' }, contextOf(pageData())), '/admin/users/p%201')
})
