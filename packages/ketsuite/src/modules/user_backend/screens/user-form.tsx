import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  button,
  DefinitionList,
  Disclosure,
  FormCluster,
  FormPage,
  linkButton,
  Notice,
  RecordActions,
  RecordForm,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, FormOption, Frame } from '../../../ui/index.ts'
import { sessionsScreen } from './sessions.tsx'
import type { SessionRow, UserRow } from './types.ts'

export type UserFormValues = Partial<UserRow> & { id?: string }

export type ScopedRoleFormValues = {
  roleId?: string
  scopeKind?: string
  companyId?: string
  branchId?: string
  reason?: string
}

export type UserFormScreenOptions = {
  mode: 'create' | 'detail'
  action: string
  cancelHref: string
  companies: readonly FormOption[]
  branches: ReadonlyArray<FormOption & { companyId: string }>
  roles: readonly FormOption[]
  companiesAction?: string
  branchesAction?: string
  rolesAction?: string
  scopedRolesAction?: string
  scopedRoleOperationId?: string
  scopedRoleValues?: ScopedRoleFormValues
  effectiveAccess?: {
    revision: number
    functions: Array<{
      key: string
      risk?: string | null
      paths?: Array<{ scopeKey: string; roleId: string; sourceKind: string; bundlePath?: string[] }>
    }>
    issues: Array<{ code: string }>
  }
  tokenAction?: string
  sessionAction?: (row: SessionRow) => string
  sessions?: readonly SessionRow[]
  errors?: readonly string[]
  oneTimeLink?: string | null
  integration?: JSXChild
}

export const userIdentityFields = (_: Translator, row: UserFormValues, create: boolean): FormField[] => [
  { name: 'name', label: _('user_backend.field.name'), value: row.name, required: true },
  { name: 'login', label: _('user_backend.field.login'), value: row.login, required: true },
  { name: 'email', label: _('user_backend.field.email'), type: 'email', value: row.email },
  { name: 'partnerId', label: _('user_backend.field.partnerId'), value: row.partnerId },
  {
    name: 'accessKind',
    label: _('user_backend.field.accessKind'),
    type: 'select',
    value: row.accessKind ?? 'internal',
    options: ['internal', 'portal', 'public'].map((value) => ({
      value,
      label: _(`user_backend.access.${value}`),
    })),
  },
  {
    name: 'superuser',
    label: _('user_backend.field.superuser'),
    type: 'checkbox',
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
  values: UserFormValues,
  options: UserFormScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const create = options.mode === 'create'
  const title = create ? _('user_backend.users.create') : String(values.name ?? values.login ?? values.id)
  const formId = 'user-record-form'
  const companies = new Set(values.memberships?.map((item) => item.companyId) ?? [])
  const branches = new Set(values.branchMemberships?.map((item) => item.branchId) ?? [])
  const roles = new Set(values.assignments?.map((item) => item.roleId) ?? [])
  const roleLabels = new Map(options.roles.map((role) => [role.value, role.label]))
  const secret = options.oneTimeLink ? (
    <>
      <Notice
        tone="warning"
        title={_('user_backend.token.onceTitle')}
        message={_('user_backend.token.onceHint')}
      />
      <DefinitionList
        title={_('user_backend.token.link')}
        items={[{ key: 'link', term: _('user_backend.token.copyNow'), value: options.oneTimeLink }]}
      />
    </>
  ) : null
  const access =
    !create && options.companiesAction && options.branchesAction && options.rolesAction ? (
      <Section
        title={_('user_backend.access.title')}
        description={_('user_backend.access.hint')}
        body={stack([
          <Surface
            body={
              <RecordForm
                action={options.companiesAction}
                hidden={{ action: 'save' }}
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
                action={options.branchesAction}
                hidden={{ action: 'save' }}
                submit={_('user_backend.action.saveBranches')}
                submitVariant="secondary"
                fields={options.branches.map((branch) => ({
                  name: `branch.${branch.value}`,
                  label: branch.label,
                  help: options.companies.find((company) => company.value === branch.companyId)?.label,
                  type: 'checkbox' as const,
                  value: branches.has(branch.value),
                }))}
              />
            }
          />,
          <Surface
            body={
              options.scopedRolesAction ? (
                stack([
                  <DefinitionList
                    title={_('user_backend.access.assignments')}
                    items={[
                      ...(values.assignments ?? []).map((assignment) => ({
                        key: assignment.id ?? `${assignment.roleId}:${assignment.scopeKey ?? 'tenant'}`,
                        term: roleLabels.get(assignment.roleId) ?? assignment.roleId,
                        value: assignment.scopeKey ?? 'tenant',
                      })),
                      {
                        key: 'effective',
                        term: _('user_backend.access.effective'),
                        value: `${String(options.effectiveAccess?.functions.length ?? 0)} · r${String(options.effectiveAccess?.revision ?? 0)}`,
                      },
                    ]}
                  />,
                  <RecordForm
                    action={options.scopedRolesAction}
                    hidden={{
                      action: 'assign',
                      id: options.scopedRoleOperationId ?? '',
                      idempotencyKey: options.scopedRoleOperationId ?? '',
                      expectedAuthorizationRevision: String(options.effectiveAccess?.revision ?? 0),
                    }}
                    submit={_('user_backend.action.assignScopedRole')}
                    submitVariant="secondary"
                    fields={[
                      {
                        name: 'roleId',
                        label: _('user_backend.field.role'),
                        type: 'select' as const,
                        required: true,
                        value: options.scopedRoleValues?.roleId,
                        options: options.roles,
                      },
                      {
                        name: 'scopeKind',
                        label: _('user_backend.field.scope'),
                        type: 'select' as const,
                        required: true,
                        value: options.scopedRoleValues?.scopeKind ?? 'tenant',
                        options: ['tenant', 'company', 'branch'].map((value) => ({
                          value,
                          label: _(`user_backend.scope.${value}`),
                        })),
                      },
                      {
                        name: 'companyId',
                        label: _('user_backend.field.company'),
                        type: 'select' as const,
                        value: options.scopedRoleValues?.companyId,
                        options: [{ value: '', label: '—' }, ...options.companies],
                      },
                      {
                        name: 'branchId',
                        label: _('user_backend.field.branch'),
                        type: 'select' as const,
                        value: options.scopedRoleValues?.branchId,
                        options: [{ value: '', label: '—' }, ...options.branches],
                      },
                      {
                        name: 'reason',
                        label: _('user_backend.field.reason'),
                        type: 'textarea' as const,
                        required: true,
                        span: 'full' as const,
                        value: options.scopedRoleValues?.reason,
                      },
                    ]}
                  />,
                  <Disclosure
                    summary={_('user_backend.access.effectiveDetails')}
                    body={
                      <DefinitionList
                        title={_('user_backend.access.effectiveDetails')}
                        items={[
                          ...(options.effectiveAccess?.functions ?? []).map((permission) => ({
                            key: permission.key,
                            term: permission.key,
                            value: [
                              permission.risk ?? '—',
                              ...(permission.paths ?? []).map(
                                (path) =>
                                  `${path.scopeKey} · ${path.roleId} · ${path.sourceKind}${
                                    path.bundlePath?.length ? ` · ${path.bundlePath.join(' → ')}` : ''
                                  }`,
                              ),
                            ].join(' | '),
                          })),
                          ...(options.effectiveAccess?.issues ?? []).map((accessIssue, index) => ({
                            key: `issue:${String(index)}`,
                            term: _('user_backend.access.issue'),
                            value: accessIssue.code,
                          })),
                        ]}
                      />
                    }
                  />,
                ])
              ) : (
                <RecordForm
                  action={options.rolesAction}
                  hidden={{ action: 'save' }}
                  submit={_('user_backend.action.saveRoles')}
                  submitVariant="secondary"
                  fields={options.roles.map((role) => ({
                    name: `role.${role.value}`,
                    label: role.label,
                    type: 'checkbox' as const,
                    value: roles.has(role.value),
                  }))}
                />
              )
            }
          />,
        ])}
      />
    ) : null
  const aside = create ? undefined : (
    <>
      {options.integration}
      {options.tokenAction ? (
        <Section
          title={_('user_backend.security.title')}
          description={_('user_backend.security.hint')}
          body={
            <Surface
              body={
                <RecordActions
                  action={options.tokenAction}
                  actions={[
                    {
                      value: 'invitation',
                      label: _('user_backend.action.invitation'),
                      variant: 'secondary',
                    },
                    { value: 'reset', label: _('user_backend.action.reset'), variant: 'destructive' },
                  ]}
                />
              }
            />
          }
        />
      ) : null}
      <Section
        title={_('user_backend.sessions.title')}
        body={sessionsScreen(_, options.sessions ?? [], options.sessionAction ?? (() => '#'))}
      />
    </>
  )

  return shell(
    _,
    title,
    <FormPage
      variant="operational"
      frame={frame}
      scope="user-form-page"
      title={title}
      description={
        create
          ? _('user_backend.identity.createHint')
          : [values.login, values.email].filter(Boolean).join(' · ')
      }
      status={
        create
          ? undefined
          : values.active
            ? badge(_('user_backend.state.active'), 'positive', 'active')
            : badge(_('user_backend.state.archived'), 'neutral', 'archived')
      }
      actions={
        <FormCluster
          label={_('user_backend.action.userActions')}
          forms={[
            button({
              label: _('user_backend.action.save'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('user_backend.action.cancel'),
              href: options.cancelHref,
              variant: 'secondary',
            }),
          ]}
        />
      }
      body={stack([
        secret,
        <Section
          title={_('user_backend.identity.title')}
          body={
            <Surface
              body={
                <RecordForm
                  id={formId}
                  scope="user-record"
                  action={options.action}
                  hidden={{ action: 'save', ...(values.id ? { id: values.id } : {}) }}
                  fields={userIdentityFields(_, values, create)}
                  errors={options.errors}
                  submit={_('user_backend.action.save')}
                  submitVariant="primary"
                  submitPlacement="external"
                />
              }
            />
          }
        />,
        access,
      ])}
      aside={aside}
      asideLabel={_('user_backend.security.aside')}
    />,
    { ...frame, topbar: false, titled: false },
  )
}
