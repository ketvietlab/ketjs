// The user record modal, client side (KetSuite record-modal contract).
//
// The users collection opens a person, and its create action opens the same modal
// with an empty record. The view is render-pure: it reads what `user.userModalContext`
// returned and writes design-system markup. The runtime owns reading, submitting,
// history and focus; the command calls `user.createUser`, so the server stays the
// only place that decides whether a login may exist.
//
// Bundled by tools/build-backend-client.mjs into user_backend/client/.

import { Button, LinkButton, Notice, Stack } from '@ketvietlab/design-system'
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

const canCreate = (c: Context): boolean => c.data.permissions.create === true

const fieldId = (c: Context, name: string): string => `user-user-${name}`

/** A field of the record form: typed input survives a refusal, the refusal shows on it. */
const field = (c: Context, props: Omit<FieldProps, 'id'>): FieldProps => ({
  ...props,
  id: fieldId(c, props.name),
  value: c.draft(props.name, String(props.value ?? '')),
  error: c.fieldError(props.name),
  disabled: props.disabled === true || !canCreate(c),
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

/**
 * The created person, before their access exists.
 *
 * Creating an account and granting it authority are separate decisions and
 * separate permissions, so the modal says what was made and sends the reader to
 * the record where roles are assigned rather than implying the person can already
 * work.
 */
const createdView = (c: Context): JSXChild =>
  Stack({
    gap: 'default',
    items: [
      Notice({
        tone: 'info',
        title: t(c, 'users.createdTitle'),
        message: t(c, 'users.createdHint'),
      }),
      LinkButton({
        label: t(c, 'action.openUser'),
        variant: 'primary',
        href: `/admin/users/${encodeURIComponent(c.data.record.id)}`,
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
    : createdView(c)

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
      // The modal switches to the person it created, so the reader stays in one place.
      after: 'open',
      created: (value) => {
        const row = (value ?? {}) as { id?: unknown }
        return typeof row.id === 'string' ? row.id : null
      },
    },
  },
}

export const userModal = createRecordModal(userModalDefinition)
