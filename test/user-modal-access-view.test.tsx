// The access tab of the user record modal: what a person holds, and the two
// steps it takes to change it. The views are render-pure, so they are read here
// the way the runtime renders them — through the definition, with a context
// standing in for what the runtime would have supplied.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { userModalDefinition } from '../packages/ketsuite/src/modules/user_backend/modal/user-modal-view.tsx'
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

  assert.match(html, /Chăm sóc khách hàng/)
  assert.match(html, /An Việt Miền Bắc · Cầu Giấy/)
  // What the role is for: the areas it touches and how much of each it holds.
  assert.match(html, /Chăm sóc/)
  assert.match(html, /coverage\.full/)
  assert.match(html, /Khiếu nại/)
  assert.match(html, /coverage\.partial/)
  assert.match(html, /name="reason"/)
  assert.match(html, /name="__command" value="previewUnassign"/)
  // Removal is committed only after its own preview, like an assignment.
  assert.doesNotMatch(html, /name="__command" value="unassign"/)

  const answered = render(
    dialogView('role')(
      contextOf(dataOf(), { dialog: open, outcome: { command: 'previewUnassign', value: PREVIEW } }),
    ),
  )
  assert.match(answered, /name="__command" value="unassign"/)
})

test('a viewer who may not remove sees the role without a way to take it back', () => {
  const html = render(
    dialogView('role')(
      contextOf(dataOf({ permissions: { ...dataOf().permissions, remove: false } }), {
        dialog: { name: 'role', params: { id: 'a1' } },
      }),
    ),
  )

  assert.match(html, /Chăm sóc khách hàng/)
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

test('the log says what changed, who did it and why — and is its own permission', () => {
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
  assert.match(html, /Chuyển sang tổ chăm sóc/)
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
  assert.match(html, /name="workplaceReason"/)

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
  assert.equal(assign.reason, 'Chuyển sang tổ chăm sóc')
  assert.equal(assign.expectedAuthorizationRevision, 7)
  assert.equal(assign.addMembership, true)

  const unassign = commands.unassign!.input(form, context, {})
  assert.equal(commands.unassign!.fn, 'user.unassignScopedRole')
  assert.equal(unassign.assignmentId, 'a1')
  assert.equal(unassign.roleId, 'care-agent')
  // The scope the row was stored with, not one re-derived from its display names.
  assert.equal(unassign.scopeKey, 'branch:company-a:cau-giay')
  assert.equal(unassign.reason, 'Chuyển sang tổ chăm sóc')
  assert.equal(unassign.expectedAuthorizationRevision, 7)
})

test('the sign-in tab links provider identities only when the viewer may list them', () => {
  const allowed = render(
    tabView('login')(contextOf(dataOf({ permissions: { ...dataOf().permissions, identities: true } }))),
  )
  assert.match(allowed, /href="\/admin\/oauth\/identities\?user=trang&amp;lang=vi"/)
  const denied = render(
    tabView('login')(contextOf(dataOf({ permissions: { ...dataOf().permissions, identities: false } }))),
  )
  assert.doesNotMatch(denied, /\/admin\/oauth\/identities/)
})
