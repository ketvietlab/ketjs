// The user record modal, client side (KetSuite record-modal contract).
//
// The users collection opens a person here, and its create action opens the same
// modal with an empty record. The view is render-pure: it reads what
// `user.userModalContext` returned and writes design-system markup. The runtime
// owns reading, submitting, history and focus; the commands call
// `user.provisionUser` and `user.saveUser`, so the server stays the only place
// that decides whether a login may exist, where it works and what it may do.
//
// Bundled by tools/build-backend-client.mjs into user_backend/client/.

import {
  Badge,
  Button,
  DataTable,
  DescriptionList,
  Notice,
  RecordSummary,
  Section,
  Stack,
} from '@ketvietlab/design-system'
import type { FieldOption, FieldProps } from '@ketvietlab/design-system'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { createRecordModal } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import {
  RecordDialogTrigger,
  RecordModalForm,
  recordStateSelectControl,
} from '../../../ui/client/record-modal-form.tsx'

// biome-ignore lint/suspicious/noExplicitAny: rows are JSON shaped by user.userModalContext
type AnyRow = Record<string, any>

export type UserRecord = {
  id: string
  name: string
  login: string
  email: string
  accessKind: string
  active: boolean
  superuser: boolean
}

export type UserModalData = {
  record: UserRecord
  companies: AnyRow[]
  branches: AnyRow[]
  assignments: AnyRow[]
  roles: AnyRow[]
  scopeKinds: string[]
  revision: number
  permissions: Record<string, boolean>
  lang: 'vi' | 'en'
}

type Context = RecordModalContext<UserModalData>

const ACCESS_KINDS = ['internal', 'portal', 'public'] as const

const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

const pageLang = (): 'vi' | 'en' =>
  typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi'

const t = (c: Context, key: string): string => c.t(`user_backend.${key}`)

const text = (form: FormData, name: string): string => String(form.get(name) ?? '').trim()

const checked = (form: FormData, name: string): boolean =>
  ['1', 'on', 'true'].includes(String(form.get(name) ?? ''))

/** Whether this reader may write what the open form offers: create one, or save this one. */
const canWrite = (c: Context): boolean =>
  c.creating ? c.data.permissions.create === true : c.data.permissions.save === true

const fieldId = (name: string): string => `user-user-${name}`

/** A field of the record form: typed input survives a refusal, the refusal shows on it. */
const field = (c: Context, props: Omit<FieldProps, 'id'>): FieldProps => ({
  ...props,
  id: fieldId(props.name),
  value:
    props.type === 'checkbox'
      ? c.draftChecked(props.name, '1', props.value === true || props.value === '1')
      : props.type === 'checkbox-group'
        ? props.value
        : c.draft(props.name, String(props.value ?? '')),
  options:
    props.type === 'checkbox-group'
      ? props.options?.map((option) => ({
          ...option,
          checked: c.draftChecked(option.name ?? `${props.name}[]`, option.value, option.checked === true),
        }))
      : props.options,
  error: c.fieldError(props.name),
  disabled: props.disabled === true || !canWrite(c),
})

/** A select whose choice changes what the rest of the form offers, before anything is submitted. */
const stateSelect = (
  c: Context,
  props: { name: string; label: string; value: string; options: FieldOption[]; required?: boolean },
): FieldProps => {
  const base = field(c, {
    name: props.name,
    label: props.label,
    type: 'select',
    required: props.required,
  })
  return {
    ...base,
    options: props.options,
    control: recordStateSelectControl({
      id: base.id,
      name: props.name,
      state: props.name,
      value: props.value,
      options: props.options,
      required: props.required,
      disabled: base.disabled === true,
      invalid: !!base.error,
    }),
  }
}

const roleFieldName = (roleId: string): string => `role_${roleId}`

const selectedRoles = (form: FormData, roles: AnyRow[]): string[] =>
  roles.map((role) => String(role.id)).filter((id) => checked(form, roleFieldName(id)))

/**
 * The form that hires someone.
 *
 * It asks for the whole decision at once — who they are, where they work, what
 * they do and why — because that is the request being made, and because the
 * reason is what the audit of their new authority will carry.
 */
const createFields = (c: Context): FieldProps[] => {
  const scopeKind = c.state('scopeKind', 'branch')
  const companyId = c.state('companyId', String(c.data.companies[0]?.id ?? ''))
  return [
    field(c, { name: 'name', label: t(c, 'field.name'), required: true }),
    field(c, { name: 'login', label: t(c, 'field.login'), required: true }),
    field(c, { name: 'email', label: t(c, 'field.email'), type: 'email', required: true, span: 'full' }),
    stateSelect(c, {
      name: 'scopeKind',
      label: t(c, 'field.scope'),
      value: scopeKind,
      required: true,
      options: c.data.scopeKinds.map((kind) => ({
        value: kind,
        label: t(c, `scope.choice.${kind}`),
      })),
    }),
    ...(scopeKind === 'tenant'
      ? []
      : [
          stateSelect(c, {
            name: 'companyId',
            label: t(c, 'field.company'),
            value: companyId,
            required: true,
            options: c.data.companies.map((company) => ({
              value: String(company.id),
              label: String(company.name),
            })),
          }),
        ]),
    ...(scopeKind === 'branch'
      ? [
          field(c, {
            name: 'branchId',
            label: t(c, 'field.branch'),
            type: 'select',
            required: true,
            options: c.data.branches
              .filter((branch) => String(branch.companyId) === companyId)
              .map((branch) => ({ value: String(branch.id), label: String(branch.name) })),
          }),
        ]
      : []),
    field(c, {
      name: 'roleIds',
      label: t(c, 'field.jobRoles'),
      type: 'checkbox-group',
      required: true,
      span: 'full',
      // One role per line: a person can hold several, and a row of boxes hides that.
      optionsOrientation: 'vertical',
      options: c.data.roles.map((role) => ({
        name: roleFieldName(String(role.id)),
        value: '1',
        label: String(role.name),
        // What was ticked before a refusal comes back ticked.
        checked: c.draftChecked(roleFieldName(String(role.id))),
      })),
    }),
    field(c, {
      name: 'reason',
      label: t(c, 'field.reason'),
      type: 'textarea',
      required: true,
      span: 'full',
    }),
  ]
}

const createView = (c: Context): JSXChild =>
  Section({
    title: t(c, 'users.newTitle'),
    body: RecordModalForm({
      kind: c.kind,
      fields: createFields(c),
      command: 'create',
      actions: [Button({ label: t(c, 'action.createUser'), variant: 'primary', type: 'submit' })],
    }),
  })

const profileFields = (c: Context): FieldProps[] => [
  field(c, { name: 'name', label: t(c, 'field.name'), value: c.data.record.name, required: true }),
  field(c, { name: 'login', label: t(c, 'field.login'), value: c.data.record.login, required: true }),
  field(c, { name: 'email', label: t(c, 'field.email'), type: 'email', value: c.data.record.email }),
  field(c, {
    name: 'accessKind',
    label: t(c, 'field.accessKind'),
    type: 'select',
    value: c.data.record.accessKind,
    options: ACCESS_KINDS.map((kind) => ({ value: kind, label: t(c, `access.${kind}`) })),
  }),
  field(c, { name: 'active', label: t(c, 'state.active'), type: 'checkbox', value: c.data.record.active }),
]

/** The person, named once at the top of every tab, with the state that decides access. */
const header = (c: Context): JSXChild =>
  c.creating
    ? ''
    : Stack({
        gap: 'compact',
        items: [
          RecordSummary({
            title: c.data.record.name || c.data.record.login,
            subtitle: c.data.record.login,
            status: {
              label: c.data.record.active ? t(c, 'state.active') : t(c, 'state.archived'),
              tone: c.data.record.active ? 'positive' : 'neutral',
            },
          }),
          ...(c.data.permissions.save
            ? [
                RecordDialogTrigger({
                  dialog: 'edit',
                  children: Button({ label: t(c, 'action.editProfile'), variant: 'secondary' }),
                }),
              ]
            : [
                Notice({
                  tone: 'info',
                  title: t(c, 'users.readOnlyTitle'),
                  message: t(c, 'users.readOnlyHint'),
                }),
              ]),
        ],
      })

const overviewTab = (c: Context): JSXChild => {
  const company = c.data.assignments.find((assignment) => assignment.company)?.company
  return Section({
    title: t(c, 'users.infoTitle'),
    body: DescriptionList({
      columns: 2,
      items: [
        { id: 'email', label: t(c, 'field.email'), value: c.data.record.email || '—' },
        {
          id: 'state',
          label: t(c, 'field.state'),
          value: Badge({
            label: c.data.record.active ? t(c, 'state.active') : t(c, 'state.archived'),
            tone: c.data.record.active ? 'positive' : 'neutral',
          }),
        },
        { id: 'roles', label: t(c, 'field.rolesHeld'), value: String(c.data.assignments.length) },
        { id: 'company', label: t(c, 'field.company'), value: company ? String(company) : '—' },
      ],
    }),
  })
}

/** What this person may do, as rows of role and place — the authority they actually hold. */
const accessTab = (c: Context): JSXChild =>
  c.data.assignments.length
    ? DataTable<AnyRow>({
        rows: c.data.assignments,
        id: (row) => String(row.id),
        columns: [
          {
            key: 'role',
            label: t(c, 'field.assignment'),
            priority: 'primary',
            cell: (row) => String(row.roleName),
          },
          {
            key: 'scope',
            label: t(c, 'field.scope'),
            cell: (row) =>
              row.branch
                ? `${String(row.company)} · ${String(row.branch)}`
                : row.company
                  ? String(row.company)
                  : t(c, 'scope.choice.tenant'),
          },
        ],
      })
    : Notice({ tone: 'info', title: t(c, 'users.noAssignments'), message: t(c, 'users.readOnlyHint') })

export const userModalDefinition: RecordModalDefinition<UserModalData> = {
  kind: 'user.user',
  context: {
    fn: 'user.userModalContext',
    input: (id, creating) => (creating ? { locale: pageLang() } : { id, locale: pageLang() }),
  },
  title: (c) => (c.creating ? t(c, 'users.create') : c.data.record.name || c.data.record.login),
  description: (c) => (c.creating ? t(c, 'users.createSubtitle') : c.data.record.login),
  header,
  body: (c) => (c.creating ? createView(c) : ''),
  tabs: [
    {
      id: 'overview',
      label: (c) => t(c, 'tab.overview'),
      visible: (c) => !c.creating,
      view: overviewTab,
    },
    {
      id: 'access',
      label: (c) => `${t(c, 'tab.access')} ${String(c.data.assignments.length)}`,
      visible: (c) => !c.creating,
      view: accessTab,
    },
  ],
  dialogs: {
    edit: {
      title: (c) => t(c, 'action.editProfile'),
      view: (c) =>
        RecordModalForm({
          kind: c.kind,
          fields: profileFields(c),
          command: 'save',
          actions: [Button({ label: t(c, 'action.save'), variant: 'primary', type: 'submit' })],
        }),
    },
  },
  commands: {
    create: {
      fn: 'user.provisionUser',
      input: (form, c) => ({
        id: uuid(),
        name: text(form, 'name'),
        login: text(form, 'login'),
        email: text(form, 'email') || null,
        accessKind: 'internal',
        roleIds: selectedRoles(form, c.data.roles),
        scopeKind: text(form, 'scopeKind') || 'branch',
        companyId: text(form, 'companyId') || null,
        branchId: text(form, 'branchId') || null,
        reason: text(form, 'reason'),
        expectedAuthorizationRevision: c.data.revision,
        idempotencyKey: uuid(),
      }),
      // The modal switches to the person it created, on their overview.
      after: 'open',
      openTab: 'overview',
      created: (value) => {
        const row = (value ?? {}) as { id?: unknown }
        return typeof row.id === 'string' ? row.id : null
      },
    },
    save: {
      fn: 'user.saveUser',
      input: (form, c) => ({
        id: c.id,
        name: text(form, 'name'),
        login: text(form, 'login'),
        email: text(form, 'email') || null,
        accessKind: text(form, 'accessKind') || 'internal',
        active: checked(form, 'active'),
        // Never offered by this form: saving a profile must not change who is a superuser.
        superuser: c.data.record.superuser,
      }),
      // Read the person again so every tab shows what the server kept, and close the dialog.
      after: 'reload',
    },
  },
}

export const userModal = createRecordModal(userModalDefinition)
