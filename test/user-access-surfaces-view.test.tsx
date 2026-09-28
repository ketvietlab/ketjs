// Access by screen, the guards around who may change authority, and the rules that
// give roles by group — as the user, role and access-rule record modals render
// them. Views are render-pure, so each is read through its definition with a
// context standing in for the runtime.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { accessPolicyModalDefinition } from '../packages/ketsuite/src/modules/user_backend/modal/access-policy-modal-view.tsx'
import type { AccessPolicyModalData } from '../packages/ketsuite/src/modules/user_backend/modal/access-policy-modal-view.tsx'
import type { SurfaceAccess } from '../packages/ketsuite/src/modules/user_backend/modal/access-surfaces.tsx'
import { roleModalDefinition } from '../packages/ketsuite/src/modules/user_backend/modal/role-modal-view.tsx'
import type { RoleModalData } from '../packages/ketsuite/src/modules/user_backend/modal/role-modal-view.tsx'
import { userModalDefinition } from '../packages/ketsuite/src/modules/user_backend/modal/user-modal-view.tsx'
import type { UserModalData } from '../packages/ketsuite/src/modules/user_backend/modal/user-modal-view.tsx'
import { accessPoliciesScreen } from '../packages/ketsuite/src/modules/user_backend/screens/index.ts'
import type {
  RecordModalContext,
  RecordModalDefinition,
} from '../packages/ketsuite/src/ui/client/record-modal.tsx'

import { recordModalCreateHref, readRecordModalTarget } from '../packages/ketsuite/src/ui/record-modal.tsx'

test('access policy uses a valid URL-backed record kind', () => {
  const href = recordModalCreateHref('/admin/access-policies', { kind: accessPolicyModalDefinition.kind })
  assert.deepEqual(readRecordModalTarget(href), {
    kind: accessPolicyModalDefinition.kind,
    id: 'new',
    tab: null,
  })
})

const render = (node: JSXChild): string => renderToString(<>{node}</>)

type Options = {
  creating?: boolean
  drafts?: Record<string, string>
  dialog?: { name: string; params: Record<string, string> } | null
  outcome?: { command: string; value: unknown } | null
}

const contextOf = <Data,>(
  kind: string,
  id: string,
  data: Data,
  options: Options = {},
): RecordModalContext<Data> => ({
  kind,
  id,
  creating: options.creating === true,
  tab: '',
  data,
  t: (key, params) =>
    Object.entries(params ?? {}).reduce((out, [name, value]) => out.replace(`{${name}}`, String(value)), key),
  fieldError: () => null,
  draft: (name, fallback = '') => options.drafts?.[name] ?? fallback,
  draftChecked: (name, value = '1', fallback = false) => options.drafts?.[name] === value || fallback,
  outcome: <T,>(command: string) =>
    options.outcome?.command === command ? (options.outcome.value as T) : null,
  busy: false,
  dialog: options.dialog ?? null,
  href: () => '',
  state: (_key, fallback = '') => fallback,
})

const viewOf = <Data,>(definition: RecordModalDefinition<Data>, id: string) => {
  const tab = (definition.tabs ?? []).find((item) => item.id === id)
  assert.ok(tab, `the modal has a ${id} tab`)
  return tab
}

const SURFACES: SurfaceAccess[] = [
  {
    key: 'sale.quotations',
    label: 'Báo giá',
    area: 'Bán hàng',
    status: 'partial',
    missing: [
      { key: 'account.listTaxes', label: 'Thuế', tier: 'lookup' },
      { key: 'uom.listUnits', label: 'Đơn vị tính', tier: 'lookup' },
    ],
    via: ['Nhân viên bán hàng'],
    fixes: ['Trưởng nhóm bán hàng'],
  },
  {
    key: 'crm.leads',
    label: 'Cơ hội',
    area: 'CRM',
    status: 'full',
    missing: [],
    via: ['Nhân viên bán hàng'],
    fixes: [],
  },
]

const userData = (over: Partial<UserModalData> = {}): UserModalData => ({
  record: {
    id: 'trang',
    name: 'Minh Trang',
    login: 'minhtrang',
    email: 'trang@ketviet.test',
    accessKind: 'internal',
    active: true,
    superuser: false,
    lastLoginAt: null,
    passwordReady: true,
    defaultCompanyId: 'company-a',
    defaultBranchId: null,
  },
  companies: [{ id: 'company-a', name: 'An Việt Miền Bắc' }],
  branches: [],
  assignments: [
    {
      id: 'a1',
      roleId: 'sales',
      roleName: 'Nhân viên bán hàng',
      scopeKind: 'company',
      scopeKey: 'company:company-a',
      companyId: 'company-a',
      branchId: null,
      company: 'An Việt Miền Bắc',
      branch: null,
    },
  ],
  audit: [],
  memberships: { companies: ['company-a'], branches: [] },
  roleCoverage: {},
  roles: [
    { id: 'sales', name: 'Nhân viên bán hàng', tier: 'standard' },
    { id: 'identity-admin', name: 'Quản trị danh tính', tier: 'security' },
  ],
  scopeKinds: ['company', 'branch', 'tenant'],
  revision: 3,
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
  actor: { self: false, superuser: false },
  surfaces: SURFACES,
  ...over,
})

const user = (data: UserModalData, options: Options = {}) =>
  contextOf('user.user', data.record.id, data, options)

test('the screens tab leads with what fails, what is missing and which role adds it', () => {
  const html = render(
    viewOf(userModalDefinition, 'screens').view(
      user(
        userData({
          lastDenial: {
            fn: 'account.listTaxes',
            label: 'Thuế',
            surface: 'Bán hàng · Báo giá',
            at: '28/09 09:12',
            count: 3,
            templates: ['Trưởng nhóm bán hàng'],
          },
        }),
      ),
    ),
  )
  assert.match(html, /surface\.scopeLabel/)
  assert.match(html, /An Việt Miền Bắc/)
  // The refusal the person met comes first, with the role that would have allowed it.
  assert.ok(html.indexOf('user_backend.denial.title') < html.indexOf('user_backend.surface.partialTitle'))
  assert.match(html, /Bán hàng · Báo giá/)
  assert.match(html, /Thuế \(user_backend\.surface\.tier\.lookup\) · Đơn vị tính/)
  assert.match(html, /Trưởng nhóm bán hàng/)
  // A usable screen says which held role opens it.
  assert.match(html, /CRM · Cơ hội/)
  assert.ok(html.indexOf('surface.partialTitle') < html.indexOf('surface.fullTitle'))
})

test('screen diagnostics open on demand instead of taking a user tab', () => {
  const tab = viewOf(userModalDefinition, 'screens')
  assert.equal(tab.visible?.(user(userData())), false)
  assert.match(
    render(viewOf(userModalDefinition, 'access').view(user(userData()))),
    /data-record-dialog="diagnostics"/u,
  )
  assert.equal(tab.visible?.(user(userData({ surfaces: undefined }))), false)
})

test('nobody is offered a change to their own access', () => {
  const html = render(
    viewOf(userModalDefinition, 'access').view(user(userData({ actor: { self: true, superuser: true } }))),
  )
  assert.doesNotMatch(html, /data-record-dialog="assign"/)
  assert.match(html, /access\.selfTitle/)
  const role = render(
    userModalDefinition.dialogs!.role.view(
      user(userData({ actor: { self: true, superuser: true } }), {
        dialog: { name: 'role', params: { id: 'a1' } },
      }),
    ),
  )
  assert.doesNotMatch(role, /previewUnassign/)
})

test('a security-tier role is offered disabled, and said why, to anyone but a superuser', () => {
  const html = render(userModalDefinition.dialogs!.assign.view(user(userData())))
  assert.match(html, /Quản trị danh tính · user_backend\.role\.tier\.security/)
  assert.match(html, /name="role_identity-admin"[^>]*disabled/)
  assert.doesNotMatch(html, /name="role_sales"[^>]*disabled/)
  assert.match(html, /access\.securityTierHint/)

  const superuser = render(
    userModalDefinition.dialogs!.assign.view(user(userData({ actor: { self: false, superuser: true } }))),
  )
  assert.doesNotMatch(superuser, /name="role_identity-admin"[^>]*disabled/)
})

test('a role a rule gave is marked, and is taken back by the rule rather than here', () => {
  const data = userData({
    assignments: [
      {
        ...userData().assignments[0],
        source: { kind: 'policy', policyId: 'p1', policyName: 'Nhóm bán hàng HN' },
      },
    ],
  })
  const tab = render(viewOf(userModalDefinition, 'access').view(user(data)))
  assert.match(tab, /access\.source\.policy/)
  const role = render(
    userModalDefinition.dialogs!.role.view(user(data, { dialog: { name: 'role', params: { id: 'a1' } } })),
  )
  assert.match(role, /access\.policyOwnedTitle/)
  assert.doesNotMatch(role, /previewUnassign/)
})

test('emergency access is a grant with an end, offered only to a superuser reading someone else', () => {
  const offered = render(
    viewOf(userModalDefinition, 'access').view(
      user(
        userData({
          actor: { self: false, superuser: true },
          permissions: { ...userData().permissions, breakGlass: true },
        }),
      ),
    ),
  )
  assert.match(offered, /name="__command" value="grantBreakGlass"/)
  assert.match(
    offered,
    /type="datetime-local"[^>]*name="breakGlassUntil"|name="breakGlassUntil"[^>]*type="datetime-local"/,
  )

  const active = render(
    viewOf(userModalDefinition, 'access').view(
      user(
        userData({
          record: { ...userData().record, superuser: true, superuserExpiresAt: '28/09 18:00' },
          actor: { self: false, superuser: true },
          permissions: { ...userData().permissions, breakGlass: true },
        }),
      ),
    ),
  )
  assert.match(active, /name="__command" value="revokeBreakGlass"/)
  assert.doesNotMatch(active, /value="grantBreakGlass"/)

  const notSuperuser = render(viewOf(userModalDefinition, 'access').view(user(userData())))
  assert.doesNotMatch(notSuperuser, /BreakGlass"/)
})

test('a tenant that sends links resets by email; otherwise the one-time code stays', () => {
  const email = render(
    viewOf(userModalDefinition, 'login').view(
      user(
        userData({
          credentialDelivery: 'email',
          permissions: { ...userData().permissions, sendLink: true },
        }),
      ),
    ),
  )
  assert.match(email, /name="__command" value="sendResetLink"/)
  assert.doesNotMatch(email, /value="resetPassword"/)
  assert.match(email, /login\.delivery\.email/)

  // The tenant asks for email but this deployment cannot send one: the code it can issue stays.
  const fallback = render(
    viewOf(userModalDefinition, 'login').view(user(userData({ credentialDelivery: 'email' }))),
  )
  assert.match(fallback, /name="__command" value="resetPassword"/)
  assert.match(fallback, /login\.delivery\.oneTime/)

  const noAddress = render(
    viewOf(userModalDefinition, 'login').view(
      user(
        userData({
          record: { ...userData().record, email: '' },
          credentialDelivery: 'email',
          permissions: { ...userData().permissions, sendLink: true },
        }),
      ),
    ),
  )
  assert.doesNotMatch(noAddress, /value="sendResetLink"/)
  assert.match(noAddress, /login\.linkNoEmail/)
})

test('leaving a workplace names the roles that go with it before it is saved', () => {
  const data = userData({ permissions: { ...userData().permissions, previewWorkplaces: true } })
  const asked = render(userModalDefinition.dialogs!.edit.view(user(data)))
  assert.match(asked, /name="__command" value="previewWorkplaces"/)
  assert.doesNotMatch(asked, /name="__command" value="setWorkplaces"/)

  const answered = render(
    userModalDefinition.dialogs!.edit.view(
      user(data, {
        outcome: {
          command: 'previewWorkplaces',
          value: { ok: true, removed: [userData().assignments[0]] },
        },
      }),
    ),
  )
  assert.match(answered, /workplace\.removesTitle/)
  assert.match(answered, /Nhân viên bán hàng/)
  assert.match(answered, /name="__command" value="setWorkplaces"/)
})

const roleData = (over: Partial<RoleModalData> = {}): RoleModalData => ({
  record: {
    id: 'sales',
    name: 'Nhân viên bán hàng',
    description: '',
    mode: 'managed',
    templateKey: 'sale.rep',
    templateVersion: 2,
    revision: 1,
    healthy: true,
  },
  tier: 'standard',
  templateBundles: [
    { key: 'sale.quote', label: 'Báo giá', risk: 'operate', via: 'direct', includedBy: null },
    {
      key: 'account.tax.lookup',
      label: 'Tra cứu thuế',
      risk: 'read',
      via: 'included',
      includedBy: 'Báo giá',
    },
  ],
  surfaces: SURFACES,
  sources: [],
  bundles: [],
  groups: [],
  holders: [],
  revision: 1,
  permissions: {},
  lang: 'vi',
  ...over,
})

test('a managed role lists its bundles, including the lookups another bundle brought', () => {
  const role = (data: RoleModalData) => contextOf('user.role', 'sales', data)
  const html = render(viewOf(roleModalDefinition, 'bundles').view(role(roleData())))
  assert.match(html, /Tra cứu thuế/)
  assert.doesNotMatch(html, /roles\.viaIncluded|roles\.viaDirect/)
  assert.match(html, /risk\.operate/)
  assert.equal(viewOf(roleModalDefinition, 'sources').visible?.(role(roleData())), false)
  assert.equal(viewOf(roleModalDefinition, 'screens').visible?.(role(roleData())), false)
  assert.equal(viewOf(roleModalDefinition, 'info').visible?.(role(roleData())), false)

  const security = render(viewOf(roleModalDefinition, 'bundles').view(role(roleData({ tier: 'security' }))))
  assert.match(security, /roles\.securityTierTitle/)
})

const policyData = (over: Partial<AccessPolicyModalData> = {}): AccessPolicyModalData => ({
  record: {
    id: 'p1',
    name: 'Nhóm bán hàng HN',
    description: '',
    active: true,
    matchKind: 'idpGroup',
    matchValue: 'ketviet-sales-hn',
    scopeKind: 'company',
    companyId: 'company-a',
    branchId: null,
    roleIds: ['sales'],
  },
  roles: userData().roles,
  companies: userData().companies,
  branches: [],
  scopeKinds: ['company', 'branch', 'tenant'],
  matchKinds: ['idpGroup', 'department', 'jobTitle'],
  members: [{ id: 'trang', name: 'Minh Trang', login: 'minhtrang', since: '01/09', status: 'applied' }],
  surfaces: SURFACES,
  revision: 3,
  permissions: { create: true, save: true, pause: true },
  actor: { superuser: false },
  lang: 'vi',
  ...over,
})

test('a rule is saved only after the people it moves have been read', () => {
  const policy = (options: Options = {}) => contextOf('user.accessPolicy', 'p1', policyData(), options)
  const asked = render(viewOf(accessPolicyModalDefinition, 'rule').view(policy()))
  assert.match(asked, /name="__command" value="previewSave"/)
  assert.doesNotMatch(asked, /name="__command" value="save"/)
  assert.match(asked, /name="role_identity-admin"[^>]*disabled/)

  const answered = render(
    viewOf(accessPolicyModalDefinition, 'rule').view(
      policy({
        outcome: {
          command: 'previewSave',
          value: {
            ok: true,
            changes: [{ userId: 'minh', name: 'Quang Minh', added: ['Nhân viên bán hàng'], removed: [] }],
            unchanged: 4,
          },
        },
      }),
    ),
  )
  assert.match(answered, /policy\.previewTitle/)
  assert.match(answered, /Quang Minh/)
  assert.match(answered, /name="__command" value="save"/)

  const creating = render(
    accessPolicyModalDefinition.body!(
      contextOf('user.accessPolicy', 'new', policyData(), { creating: true }),
    ),
  )
  assert.match(creating, /name="__command" value="previewSave"/)
  assert.doesNotMatch(creating, /value="create"/)
})

const translate = ((key: string) => key) as Translator
translate.locale = 'vi'
translate.has = () => true
translate.resolves = () => true

const SEARCH_FRAME = { chrome: { search: { name: 'q', value: '', placeholder: 'Tìm quy tắc' } } }

const policyRow = {
  id: 'p1',
  name: 'Nhóm bán hàng HN',
  match: { kind: 'idpGroup' as const, value: 'ketviet-sales-hn' },
  grants: [{ roleName: 'Nhân viên bán hàng', scope: 'An Việt Miền Bắc' }],
  memberCount: 5,
  active: true,
  detailHref: '/admin/access-policies?record=user.accessPolicy%3Ap1',
}

test('the rules collection keeps title and create, then filters, then the table', () => {
  const html = renderToString(
    accessPoliciesScreen(translate, SEARCH_FRAME, {
      rows: [policyRow],
      total: 1,
      createHref: '/admin/access-policies?record=user.accessPolicy%3Anew',
    }),
  )
  assert.match(
    html,
    /data-ui="list-page-title-row"[\s\S]*?record=user\.accessPolicy%3Anew[\s\S]*?<\/header>[\s\S]*?data-ui="list-page-controls"[\s\S]*?data-ui="ket-table"/,
  )
  assert.match(html, /ketviet-sales-hn/)
  assert.match(html, /Nhân viên bán hàng · An Việt Miền Bắc/)

  const readOnly = renderToString(
    accessPoliciesScreen(translate, SEARCH_FRAME, { rows: [policyRow], total: 1, createHref: null }),
  )
  assert.doesNotMatch(readOnly, /record=user\.accessPolicy%3Anew|action\.createPolicy/)
  assert.match(readOnly, /data-ui="ket-table"/)
})

test('role and policy screens have no change-reason fields', () => {
  const role = contextOf('user.role', 'sales', roleData())
  for (const tab of roleModalDefinition.tabs ?? [])
    assert.doesNotMatch(render(tab.view(role)), /name="reason"|field.reason/u, tab.id)
  const policy = contextOf('user.accessPolicy', 'p1', policyData())
  for (const tab of accessPolicyModalDefinition.tabs ?? [])
    assert.doesNotMatch(render(tab.view(policy)), /name="(?:reason|stateReason)"|field.reason/u, tab.id)
})

test('new accounts receive invitations while active accounts receive password resets', () => {
  for (const ready of [false, true]) {
    const context = user(
      userData({
        record: { ...userData().record, passwordReady: ready },
        credentialDelivery: 'email',
        permissions: { ...userData().permissions, sendLink: true },
      }),
    )
    const html = render(viewOf(userModalDefinition, 'login').view(context))
    assert.match(html, ready ? /action.sendResetLink/ : /action.sendInvite/)
    const input = userModalDefinition.commands!.sendResetLink!.input(new FormData(), context, {})
    assert.equal(input.kind, ready ? 'reset' : 'invitation')
  }
})

test('policy matching uses directory choices and clears a value from a different kind', () => {
  const data = policyData({
    matchOptions: {
      idpGroup: [{ value: 'ketviet-sales-hn', label: 'Sales Hanoi' }],
      department: [{ value: 'Sales', label: 'Sales department' }],
    },
  })
  const context = contextOf('user.accessPolicy', 'p1', data)
  let html = render(viewOf(accessPolicyModalDefinition, 'rule').view(context))
  assert.match(html, /<select[^>]*name="matchValue"/u)
  assert.doesNotMatch(html, /<input[^>]*name="matchValue"/u)
  assert.match(html, /Sales Hanoi/u)
  context.state = (key, fallback = '') => (key === 'matchKind' ? 'department' : fallback)
  context.draft = (key, fallback = '') => (key === 'matchValue' ? 'ketviet-sales-hn' : fallback)
  html = render(viewOf(accessPolicyModalDefinition, 'rule').view(context))
  assert.match(html, /Sales department/u)
  assert.doesNotMatch(html, /Sales Hanoi/u)
})

test('external sign-in offers both delivery choices without treating acknowledgement as activation', () => {
  const data = userData({
    credentialDelivery: 'both',
    permissions: { ...userData().permissions, sendLink: true, resetPassword: true },
    externalCredential: {
      state: 'ready',
      activated: false,
      operationId: 'op',
      claimable: true,
      emailState: 'accepted',
    },
  })
  const html = render(viewOf(userModalDefinition, 'login').view(user(data)))
  assert.match(html, /action\.sendInvite/)
  assert.match(html, /action\.claimPassword/)
  assert.match(html, /login\.emailState\.accepted/)
  assert.match(html, /login\.preparing/)
  assert.doesNotMatch(html, /login\.ready/)
  const revealed = render(
    viewOf(userModalDefinition, 'login').view(
      user(data, {
        outcome: {
          command: 'claimCredential',
          value: { temporaryPassword: 'fixture-only-temporary-password' },
        },
      }),
    ),
  )
  assert.match(revealed, /fixture-only-temporary-password/)
  assert.match(revealed, /login\.temporaryShownOnce/)
  assert.doesNotMatch(revealed, /login\.oneTimeTitle/)
  assert.doesNotMatch(revealed, /action\.claimPassword/)
})
