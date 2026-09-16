// The user record modal, client side (KetSuite record-modal contract).
//
// The users collection opens a person, and its create action opens the same modal
// with an empty record. The view is render-pure: it reads what `user.userModalContext`
// returned and writes design-system markup. The runtime owns reading, submitting,
// history and focus; the commands call `user.createUser` and `user.saveUser`, so the
// server stays the only place that decides whether a login may exist or change.
//
// Bundled by tools/build-backend-client.mjs into user_backend/client/.

import { Button, Notice, Stack } from '@ketvietlab/design-system'
import type { FieldOption, FieldProps } from '@ketvietlab/design-system'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { createRecordModal } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import { RecordModalForm, recordStateSelectControl } from '../../../ui/client/record-modal-form.tsx'

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

const fieldId = (c: Context, name: string): string => `user-user-${name}`

/** A field of the record form: typed input survives a refusal, the refusal shows on it. */
const field = (c: Context, props: Omit<FieldProps, 'id'>): FieldProps => ({
  ...props,
  id: fieldId(c, props.name),
  value: c.draft(props.name, String(props.value ?? '')),
  error: c.fieldError(props.name),
  disabled: props.disabled === true || !canWrite(c),
})

/** The company choice decides which branches the form offers, before anything is submitted. */
const companyField = (c: Context, companyId: string): FieldProps => {
  const options: FieldOption[] = [
    { value: '', label: t(c, 'value.none') },
    ...c.data.companies.map((company) => ({ value: String(company.id), label: String(company.name) })),
  ]
  const base = field(c, { name: 'companyId', label: t(c, 'field.company'), type: 'select' })
  return {
    ...base,
    options,
    control: recordStateSelectControl({
      id: base.id,
      name: 'companyId',
      state: 'companyId',
      value: companyId,
      options,
      disabled: base.disabled === true,
      invalid: !!base.error,
    }),
  }
}

const branchField = (c: Context, companyId: string): FieldProps =>
  field(c, {
    name: 'branchId',
    label: t(c, 'field.branch'),
    type: 'select',
    disabled: !companyId,
    options: [
      { value: '', label: t(c, 'value.none') },
      ...c.data.branches
        .filter((branch) => String(branch.companyId) === companyId)
        .map((branch) => ({ value: String(branch.id), label: String(branch.name) })),
    ],
  })

const createFields = (c: Context): FieldProps[] => {
  const companyId = c.state('companyId', '')
  return [
    field(c, { name: 'name', label: t(c, 'field.name'), required: true }),
    field(c, { name: 'login', label: t(c, 'field.login'), required: true }),
    field(c, { name: 'email', label: t(c, 'field.email'), type: 'email' }),
    field(c, {
      name: 'accessKind',
      label: t(c, 'field.accessKind'),
      type: 'select',
      value: 'internal',
      options: ACCESS_KINDS.map((kind) => ({ value: kind, label: t(c, `access.${kind}`) })),
    }),
    companyField(c, companyId),
    branchField(c, companyId),
  ]
}

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
  field(c, {
    name: 'active',
    label: t(c, 'state.active'),
    type: 'checkbox',
    value: c.data.record.active,
  }),
]

/**
 * A person the collection opened.
 *
 * Their profile is edited here rather than on a page of its own, so reading the
 * list and changing one person stay the same place. A viewer who may open a person
 * without being allowed to change them gets the same form, read-only, and is told
 * why rather than meeting a refusal after typing.
 */
const profileView = (c: Context): JSXChild =>
  Stack({
    gap: 'default',
    items: [
      ...(c.data.permissions.save
        ? []
        : [
            Notice({ tone: 'info', title: t(c, 'users.readOnlyTitle'), message: t(c, 'users.readOnlyHint') }),
          ]),
      RecordModalForm({
        kind: c.kind,
        fields: profileFields(c),
        command: 'save',
        actions: c.data.permissions.save
          ? [Button({ label: t(c, 'action.save'), variant: 'primary', type: 'submit' })]
          : [],
      }),
    ],
  })

const view = (c: Context): JSXChild =>
  c.creating
    ? RecordModalForm({
        kind: c.kind,
        fields: createFields(c),
        command: 'create',
        actions: [Button({ label: t(c, 'action.createUser'), variant: 'primary', type: 'submit' })],
      })
    : profileView(c)

export const userModalDefinition: RecordModalDefinition<UserModalData> = {
  kind: 'user.user',
  context: {
    fn: 'user.userModalContext',
    input: (id, creating) => (creating ? { locale: pageLang() } : { id, locale: pageLang() }),
  },
  title: (c) => (c.creating ? t(c, 'users.create') : c.data.record.name || c.data.record.login),
  body: view,
  commands: {
    create: {
      fn: 'user.createUser',
      input: (form) => ({
        id: uuid(),
        name: text(form, 'name'),
        login: text(form, 'login'),
        email: text(form, 'email') || null,
        accessKind: text(form, 'accessKind') || 'internal',
        defaultCompanyId: text(form, 'companyId') || null,
        defaultBranchId: text(form, 'branchId') || null,
      }),
      // The modal switches to the person it created, so the reader stays in one place
      // and edits the profile they just made without leaving the collection.
      after: 'open',
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
      // Read the person again so the form shows what the server kept.
      after: 'refresh',
    },
  },
}

export const userModal = createRecordModal(userModalDefinition)
