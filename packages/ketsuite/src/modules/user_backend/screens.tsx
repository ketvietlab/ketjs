import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  badge,
  code,
  dataTable,
  definitionList,
  emptyState,
  framedPage as Framed,
  inline,
  linkButton,
  notice,
  person,
  recordActions,
  recordForm as RecordForm,
  section as Section,
  stack,
  surface as Surface,
} from '../../ui/index.ts'
import type { FormOption, Frame } from '../../ui/index.ts'

const localized = (path: string, locale: string): string =>
  !locale ? path : path.includes('?') ? `${path}&${locale.slice(1)}` : `${path}${locale}`

export type UserRow = {
  id: string
  login: string
  name: string
  email?: string | null
  timezone?: string | null
  partnerId?: string | null
  defaultCompanyId?: string | null
  defaultBranchId?: string | null
  accessKind: string
  securityVersion: number
  lastLoginAt?: string | null
  passwordReady: boolean
  active: boolean
  superuser: boolean
  memberships?: Array<{ companyId: string }>
  branchMemberships?: Array<{ branchId: string }>
  assignments?: Array<{ roleId: string }>
}

export type SessionRow = {
  id: string
  current: boolean
  company: string | null
  branch: string | null
  createdAt: number
  expiresAt: number
}

export type PermissionRow = {
  key: string
  module: string
  moduleLabel: string
  task: string
  label: string
  checked: boolean
}

export const usersScreen = (
  _: Translator,
  rows: UserRow[],
  frame: Frame,
  locale = '',
  includeArchived = false,
): TemplateResult => (
  <Framed
    translator={_}
    title={_('user_backend.users.title')}
    frame={frame}
    body={stack([
      inline([
        linkButton({
          label: _('user_backend.action.createUser'),
          href: localized('/admin/users/new', locale),
          variant: 'primary',
        }),
        linkButton({
          label: includeArchived
            ? _('user_backend.filter.activeOnly')
            : _('user_backend.filter.includeArchived'),
          href: localized(includeArchived ? '/admin/users' : '/admin/users?archived=1', locale),
          variant: 'tertiary',
        }),
      ]),
      rows.length === 0
        ? emptyState(_('user_backend.users.empty'), _('user_backend.users.emptyHint'))
        : dataTable(_, {
            rows,
            id: (row) => row.id,
            columns: [
              {
                key: 'name',
                label: _('user_backend.field.name'),
                priority: 'primary',
                cell: (row) =>
                  linkButton({
                    label: row.name,
                    href: localized(`/admin/users/${row.id}`, locale),
                    variant: 'tertiary',
                  }),
              },
              { key: 'login', label: _('user_backend.field.login'), cell: (row) => code(row.login) },
              {
                key: 'access',
                label: _('user_backend.field.accessKind'),
                kind: 'status',
                cell: (row) => badge(_(`user_backend.access.${row.accessKind}`), 'info'),
              },
              {
                key: 'credential',
                label: _('user_backend.field.credential'),
                kind: 'status',
                cell: (row) =>
                  badge(
                    row.passwordReady
                      ? _('user_backend.state.passwordReady')
                      : _('user_backend.state.invitationPending'),
                    row.passwordReady ? 'positive' : 'warning',
                  ),
              },
              {
                key: 'state',
                label: _('user_backend.field.state'),
                kind: 'status',
                cell: (row) =>
                  badge(
                    row.active ? _('user_backend.state.active') : _('user_backend.state.archived'),
                    row.active ? 'positive' : 'neutral',
                  ),
              },
            ],
          }),
    ])}
  />
)

const identityFields = (_: Translator, row: Partial<UserRow>, create: boolean) => [
  { name: 'name', label: _('user_backend.field.name'), value: row.name, required: true },
  { name: 'login', label: _('user_backend.field.login'), value: row.login, required: true },
  { name: 'email', label: _('user_backend.field.email'), value: row.email },
  { name: 'partnerId', label: _('user_backend.field.partnerId'), value: row.partnerId },
  {
    name: 'accessKind',
    label: _('user_backend.field.accessKind'),
    type: 'select' as const,
    value: row.accessKind ?? 'internal',
    options: ['internal', 'portal', 'public'].map((value) => ({
      value,
      label: _(`user_backend.access.${value}`),
    })),
  },
  {
    name: 'superuser',
    label: _('user_backend.field.superuser'),
    type: 'checkbox' as const,
    value: row.superuser,
  },
  ...(!create
    ? [
        {
          name: 'active',
          label: _('user_backend.state.active'),
          type: 'checkbox' as const,
          value: row.active,
        },
      ]
    : []),
]

export const userFormScreen = (
  _: Translator,
  row: Partial<UserRow>,
  options: {
    companies: FormOption[]
    branches: Array<FormOption & { companyId: string }>
    roles: FormOption[]
    sessions?: SessionRow[]
    errors?: string[]
    oneTimeLink?: string | null
    integration?: JSXChild
  },
  frame: Frame,
  locale = '',
): TemplateResult => {
  const create = !row.id
  const id = row.id ?? ''
  const companies = new Set(row.memberships?.map((item) => item.companyId) ?? [])
  const branches = new Set(row.branchMemberships?.map((item) => item.branchId) ?? [])
  const roles = new Set(row.assignments?.map((item) => item.roleId) ?? [])
  return (
    <Framed
      translator={_}
      title={create ? _('user_backend.users.create') : (row.name ?? '')}
      frame={frame}
      body={stack([
        ...(options.oneTimeLink
          ? [
              notice({
                tone: 'warning',
                title: _('user_backend.token.onceTitle'),
                message: _('user_backend.token.onceHint'),
              }),
              definitionList({
                title: _('user_backend.token.link'),
                items: [{ key: 'link', term: _('user_backend.token.copyNow'), value: options.oneTimeLink }],
              }),
            ]
          : []),
        ...(options.integration ? [options.integration] : []),
        <Section
          title={_('user_backend.identity.title')}
          description={create ? _('user_backend.identity.createHint') : undefined}
          body={
            <Surface
              body={
                <RecordForm
                  action={localized(create ? '/admin/users/new' : `/admin/users/${id}`, locale)}
                  submit={_('user_backend.action.save')}
                  submitVariant="primary"
                  cancelHref={localized('/admin/users', locale)}
                  cancelLabel={_('user_backend.action.cancel')}
                  errors={options.errors}
                  fields={identityFields(_, row, create)}
                />
              }
            />
          }
        />,
        ...(!create
          ? [
              <Section
                title={_('user_backend.access.title')}
                description={_('user_backend.access.hint')}
                body={stack([
                  <Surface
                    body={
                      <RecordForm
                        action={localized(`/admin/users/${id}/companies`, locale)}
                        submit={_('user_backend.action.saveCompanies')}
                        submitVariant="secondary"
                        fields={options.companies.map((company) => ({
                          name: `company.${company.value}`,
                          label: company.label,
                          type: 'checkbox' as const,
                          value: companies.has(company.value),
                        }))}
                      />
                    }
                  />,
                  <Surface
                    body={
                      <RecordForm
                        action={localized(`/admin/users/${id}/branches`, locale)}
                        submit={_('user_backend.action.saveBranches')}
                        submitVariant="secondary"
                        fields={options.branches.map((branch) => ({
                          name: `branch.${branch.value}`,
                          label: branch.label,
                          help: options.companies.find((company) => company.value === branch.companyId)
                            ?.label,
                          type: 'checkbox' as const,
                          value: branches.has(branch.value),
                        }))}
                      />
                    }
                  />,
                  <Surface
                    body={
                      <RecordForm
                        action={localized(`/admin/users/${id}/roles`, locale)}
                        submit={_('user_backend.action.saveRoles')}
                        submitVariant="secondary"
                        fields={options.roles.map((role) => ({
                          name: `role.${role.value}`,
                          label: role.label,
                          type: 'checkbox' as const,
                          value: roles.has(role.value),
                        }))}
                      />
                    }
                  />,
                ])}
              />,
              <Section
                title={_('user_backend.security.title')}
                description={_('user_backend.security.hint')}
                body={
                  <Surface
                    body={recordActions({
                      action: localized(`/admin/users/${id}/token`, locale),
                      actions: [
                        {
                          value: 'invitation',
                          label: _('user_backend.action.invitation'),
                          variant: 'secondary',
                        },
                        { value: 'reset', label: _('user_backend.action.reset'), variant: 'destructive' },
                      ],
                    })}
                  />
                }
              />,
              <Section
                title={_('user_backend.sessions.title')}
                body={sessionsScreen(_, options.sessions ?? [], id, locale)}
              />,
            ]
          : []),
      ])}
    />
  )
}

export const sessionsScreen = (
  _: Translator,
  rows: SessionRow[],
  userId: string,
  locale = '',
): TemplateResult =>
  rows.length === 0
    ? emptyState(_('user_backend.sessions.empty'), _('user_backend.sessions.emptyHint'))
    : dataTable(_, {
        rows,
        id: (row) => row.id,
        columns: [
          {
            key: 'created',
            label: _('user_backend.sessions.created'),
            cell: (row) => new Date(row.createdAt).toLocaleString(),
          },
          {
            key: 'context',
            label: _('user_backend.sessions.context'),
            cell: (row) => `${row.company ?? '—'} · ${row.branch ?? '—'}`,
          },
          {
            key: 'state',
            label: _('user_backend.field.state'),
            cell: (row) =>
              row.current
                ? badge(_('user_backend.sessions.current'), 'positive')
                : recordActions({
                    action: localized(
                      `/admin/users/${userId}/sessions/${encodeURIComponent(row.id)}`,
                      locale,
                    ),
                    actions: [
                      { value: 'revoke', label: _('user_backend.sessions.revoke'), variant: 'destructive' },
                    ],
                  }),
          },
        ],
      })

export type RoleRow = {
  id: string
  name: string
  description?: string | null
  grants?: Array<{ fnKey: string }>
}

export const rolesScreen = (_: Translator, rows: RoleRow[], frame: Frame, locale = ''): TemplateResult => (
  <Framed
    translator={_}
    title={_('user_backend.roles.title')}
    frame={frame}
    body={stack([
      inline([
        linkButton({
          label: _('user_backend.action.createRole'),
          href: localized('/admin/roles/new', locale),
          variant: 'primary',
        }),
        linkButton({
          label: _('user_backend.action.presets'),
          href: localized('/admin/permission-presets', locale),
          variant: 'secondary',
        }),
      ]),
      rows.length === 0
        ? emptyState(_('user_backend.roles.empty'), _('user_backend.roles.emptyHint'))
        : dataTable(_, {
            rows,
            id: (row) => row.id,
            columns: [
              {
                key: 'name',
                label: _('user_backend.field.name'),
                cell: (row) =>
                  linkButton({
                    label: row.name,
                    href: localized(`/admin/roles/${row.id}`, locale),
                    variant: 'tertiary',
                  }),
              },
              {
                key: 'description',
                label: _('user_backend.field.description'),
                cell: (row) => row.description || '—',
              },
            ],
          }),
    ])}
  />
)

export const roleScreen = (
  _: Translator,
  row: Partial<RoleRow>,
  permissions: PermissionRow[],
  frame: Frame,
  locale = '',
  errors?: string[],
): TemplateResult => {
  const create = !row.id
  const groups = new Map<string, PermissionRow[]>()
  for (const permission of permissions)
    groups.set(permission.module, [...(groups.get(permission.module) ?? []), permission])
  return (
    <Framed
      translator={_}
      title={create ? _('user_backend.roles.create') : (row.name ?? '')}
      frame={frame}
      body={stack([
        <Section
          title={_('user_backend.roles.identity')}
          body={
            <Surface
              body={
                <RecordForm
                  action={localized(create ? '/admin/roles/new' : `/admin/roles/${row.id}`, locale)}
                  submit={_('user_backend.action.save')}
                  submitVariant="primary"
                  cancelHref={localized('/admin/roles', locale)}
                  cancelLabel={_('user_backend.action.cancel')}
                  errors={errors}
                  fields={[
                    { name: 'name', label: _('user_backend.field.name'), value: row.name, required: true },
                    {
                      name: 'description',
                      label: _('user_backend.field.description'),
                      value: row.description,
                      type: 'textarea',
                      span: 'full',
                    },
                  ]}
                />
              }
            />
          }
        />,
        ...(!create
          ? [...groups.entries()].map(([moduleName, items]) => (
              <Section
                title={items[0]?.moduleLabel ?? moduleName}
                description={_('user_backend.roles.permissionHint')}
                body={
                  <Surface
                    body={
                      <RecordForm
                        action={localized(`/admin/roles/${row.id}/permissions`, locale)}
                        submit={_('user_backend.action.savePermissions')}
                        submitVariant="secondary"
                        hidden={{ module: moduleName }}
                        fields={items.map((permission) => ({
                          name: `permission.${permission.key}`,
                          label: permission.label,
                          type: 'checkbox' as const,
                          value: permission.checked,
                        }))}
                      />
                    }
                  />
                }
              />
            ))
          : []),
      ])}
    />
  )
}

export const presetsScreen = (
  _: Translator,
  modules: FormOption[],
  frame: Frame,
  locale = '',
  result?: string,
): TemplateResult => (
  <Framed
    translator={_}
    title={_('user_backend.presets.title')}
    frame={frame}
    body={stack([
      ...(result
        ? [notice({ tone: 'positive', title: _('user_backend.presets.done'), message: result })]
        : []),
      <Section
        title={_('user_backend.presets.apply')}
        description={_('user_backend.presets.hint')}
        body={
          <Surface
            body={
              <RecordForm
                action={localized('/admin/permission-presets', locale)}
                submit={_('user_backend.action.applyPreset')}
                submitVariant="primary"
                fields={[
                  {
                    name: 'module',
                    label: _('user_backend.presets.module'),
                    type: 'select',
                    options: modules,
                    required: true,
                  },
                  {
                    name: 'level',
                    label: _('user_backend.presets.level'),
                    type: 'select',
                    options: [
                      { value: 'user', label: _('user_backend.presets.user') },
                      { value: 'manager', label: _('user_backend.presets.manager') },
                    ],
                    required: true,
                  },
                ]}
              />
            }
          />
        }
      />,
    ])}
  />
)

export const profileScreen = (
  _: Translator,
  row: UserRow,
  sessions: SessionRow[],
  frame: Frame,
  locale = '',
  errors?: string[],
  integration?: JSXChild,
): TemplateResult => (
  <Framed
    translator={_}
    title={_('user_backend.profile.title')}
    frame={frame}
    body={stack([
      ...(integration ? [integration] : []),
      <Section
        title={_('user_backend.profile.account')}
        body={
          <Surface
            body={inline([
              person(row.name),
              code(row.login),
              badge(_(`user_backend.access.${row.accessKind}`), 'info'),
            ])}
          />
        }
      />,
      <Section
        title={_('user_backend.profile.timezone')}
        body={
          <Surface
            body={
              <RecordForm
                action={localized('/admin/profile/timezone', locale)}
                submit={_('user_backend.profile.saveTimezone')}
                submitVariant="primary"
                fields={[
                  {
                    name: 'timezone',
                    label: _('user_backend.profile.timezone'),
                    type: 'select',
                    value: row.timezone ?? '',
                    options: [
                      { value: 'UTC', label: 'UTC' },
                      { value: 'Asia/Ho_Chi_Minh', label: 'Asia/Ho_Chi_Minh' },
                      { value: 'Asia/Singapore', label: 'Asia/Singapore' },
                      { value: 'Europe/London', label: 'Europe/London' },
                      { value: 'America/New_York', label: 'America/New_York' },
                    ],
                    required: true,
                  },
                ]}
              />
            }
          />
        }
      />,
      <Section
        title={_('user_backend.profile.password')}
        body={
          <Surface
            body={
              <RecordForm
                action={localized('/admin/profile/password', locale)}
                submit={_('user_backend.profile.changePassword')}
                submitVariant="primary"
                errors={errors}
                fields={[
                  {
                    name: 'currentPassword',
                    label: _('user_backend.profile.currentPassword'),
                    type: 'password',
                    required: true,
                  },
                  {
                    name: 'newPassword',
                    label: _('user_backend.profile.newPassword'),
                    type: 'password',
                    required: true,
                  },
                ]}
              />
            }
          />
        }
      />,
      <Section title={_('user_backend.sessions.title')} body={sessionsScreen(_, sessions, row.id, locale)} />,
    ])}
  />
)
