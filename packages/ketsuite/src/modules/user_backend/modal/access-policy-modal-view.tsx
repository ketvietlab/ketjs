// The access-rule record modal, client side (KetSuite record-modal contract).
//
// A rule gives a set of roles, at one place, to everyone who matches it — an
// identity-provider group, a department, a job title — so that people doing the
// same job hold the same authority and nobody is assembled by hand. The view is
// render-pure: it reads what `user.accessPolicyModalContext` returned.
//
// Saving a rule changes what many people can do, so it is previewed first: who
// gains which roles, who loses which, before anything is written. Roles given by a
// rule are marked as such on each person, and are taken back by the rule.
//
// Not registered yet: the functions it calls are still being built. See
// `screens/access-policies-list.tsx`.

import { Badge, Button, DataTable, DescriptionList, Notice, Section, Stack } from '@ketvietlab/design-system'
import type { FieldOption, FieldProps } from '@ketvietlab/design-system'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { createRecordModal, RECORD_COMMAND_FIELD } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { RecordModalForm, recordStateSelectControl } from '../../../ui/client/record-modal-form.tsx'
import type { AccessPolicyMatchKind } from '../screens/access-policies-list.tsx'
import { SurfaceAccessView } from './access-surfaces.tsx'
import type { SurfaceAccess } from './access-surfaces.tsx'

// biome-ignore lint/suspicious/noExplicitAny: rows are JSON shaped by user.accessPolicyModalContext
type AnyRow = Record<string, any>

export type AccessPolicyRecord = {
  id: string
  name: string
  description: string
  active: boolean
  matchKind: AccessPolicyMatchKind
  matchValue: string
  scopeKind: 'tenant' | 'company' | 'branch'
  companyId: string | null
  branchId: string | null
  roleIds: string[]
}

export type AccessPolicyModalData = {
  record: AccessPolicyRecord
  /** Assignable roles; `tier: 'security'` ones only a superuser may put in a rule. */
  roles: AnyRow[]
  companies: AnyRow[]
  branches: AnyRow[]
  scopeKinds: string[]
  matchKinds: AccessPolicyMatchKind[]
  matchOptions?: Partial<Record<AccessPolicyMatchKind, Array<{ value: string; label: string }>>>
  /** People the rule currently matches, and whether it could give them everything. */
  members: AnyRow[]
  /** What the rule's roles open together, screen by screen. */
  surfaces?: SurfaceAccess[]
  revision: number
  permissions: Record<string, boolean>
  actor?: { superuser: boolean }
  lang: 'vi' | 'en'
}

type Context = RecordModalContext<AccessPolicyModalData>

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

const canWrite = (c: Context): boolean =>
  c.creating ? c.data.permissions.create === true : c.data.permissions.save === true

const roleFieldName = (roleId: string): string => `role_${roleId}`

const securityTier = (role: AnyRow): boolean => String(role.tier ?? '') === 'security'

const field = (c: Context, props: Omit<FieldProps, 'id'>): FieldProps => ({
  ...props,
  id: `user-policy-${props.name}`,
  value: props.type === 'checkbox-group' ? props.value : c.draft(props.name, String(props.value ?? '')),
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

const stateSelect = (
  c: Context,
  props: { name: string; label: string; value: string; options: FieldOption[] },
): FieldProps => {
  const base = field(c, { name: props.name, label: props.label, type: 'select', required: true })
  return {
    ...base,
    options: props.options,
    control: recordStateSelectControl({
      id: base.id,
      name: props.name,
      state: props.name,
      value: props.value,
      options: props.options,
      required: true,
      disabled: base.disabled === true,
      invalid: !!base.error,
    }),
  }
}

/**
 * The whole rule as one form: who it matches, where it applies, what it gives.
 *
 * It is one decision, so it is one form and one preview; splitting the match from
 * the roles would let a half-made rule apply to people.
 */
const ruleFields = (c: Context): FieldProps[] => {
  const record = c.data.record
  const scopeKind = c.state('scopeKind', record.scopeKind)
  const companyId = c.state('companyId', record.companyId ?? String(c.data.companies[0]?.id ?? ''))
  const superuser = c.data.actor?.superuser === true
  const matchKind = c.state('matchKind', record.matchKind) as AccessPolicyMatchKind
  const options = [...(c.data.matchOptions?.[matchKind] ?? [])]
  if (
    record.matchKind === matchKind &&
    record.matchValue &&
    !options.some((option) => option.value === record.matchValue)
  )
    options.push({ value: record.matchValue, label: record.matchValue })
  const selected = c.draft('matchValue', record.matchKind === matchKind ? record.matchValue : '')

  return [
    field(c, { name: 'name', label: t(c, 'field.name'), value: record.name, required: true, span: 'full' }),
    stateSelect(c, {
      name: 'matchKind',
      label: t(c, 'policy.matchKind'),
      value: matchKind,
      options: c.data.matchKinds.map((kind) => ({ value: kind, label: t(c, `policy.match.${kind}`) })),
    }),
    {
      ...field(c, {
        name: 'matchValue',
        label: t(c, `policy.match.${matchKind}`),
        type: 'select',
        required: true,
        options: [{ value: '', label: t(c, 'policy.chooseValue') }, ...options],
        disabled: !options.length,
        help: options.length ? null : t(c, 'policy.noOptions'),
      }),
      value: options.some((option) => option.value === selected) ? selected : '',
    },
    stateSelect(c, {
      name: 'scopeKind',
      label: t(c, 'field.scope'),
      value: scopeKind,
      options: c.data.scopeKinds.map((kind) => ({ value: kind, label: t(c, `scope.choice.${kind}`) })),
    }),
    ...(scopeKind === 'tenant'
      ? []
      : [
          stateSelect(c, {
            name: 'companyId',
            label: t(c, 'field.company'),
            value: companyId,
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
            value: record.branchId ?? '',
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
      optionsOrientation: 'vertical',
      help: c.data.roles.some(securityTier) && !superuser ? t(c, 'access.securityTierHint') : null,
      options: c.data.roles.map((role) => ({
        name: roleFieldName(String(role.id)),
        value: '1',
        label: securityTier(role)
          ? `${String(role.name)} · ${t(c, 'role.tier.security')}`
          : String(role.name),
        checked: record.roleIds.includes(String(role.id)),
        disabled: securityTier(role) && !superuser,
      })),
    }),
    field(c, {
      name: 'description',
      label: t(c, 'field.description'),
      type: 'textarea',
      value: record.description,
      span: 'full',
    }),
  ]
}

type PolicyPreview = {
  ok: boolean
  /** One row per person whose roles would change. */
  changes?: Array<{ userId: string; name: string; added: string[]; removed: string[] }>
  unchanged?: number
}

/** Who the rule would move, and how, before it moves anyone. */
const previewPanel = (c: Context): JSXChild => {
  const preview = c.outcome<PolicyPreview>('previewSave')
  if (!preview) return ''
  if (!preview.ok) return Notice({ tone: 'warning', title: t(c, 'preview.unavailable'), message: '' })
  const changes = preview.changes ?? []
  const unchanged = t(c, 'policy.previewUnchanged').replace('{count}', String(preview.unchanged ?? 0))
  if (!changes.length) return Notice({ tone: 'info', title: t(c, 'preview.noChange'), message: unchanged })
  return Stack({
    gap: 'compact',
    items: [
      Notice({
        tone: changes.some((row) => row.removed.length) ? 'warning' : 'info',
        title: t(c, 'policy.previewTitle').replace('{count}', String(changes.length)),
        message: unchanged,
      }),
      DataTable<NonNullable<PolicyPreview['changes']>[number]>({
        rows: changes,
        id: (row) => row.userId,
        columns: [
          { key: 'person', label: t(c, 'users.title'), priority: 'primary', cell: (row) => row.name },
          { key: 'added', label: t(c, 'policy.gains'), cell: (row) => row.added.join(', ') || '—' },
          { key: 'removed', label: t(c, 'policy.loses'), cell: (row) => row.removed.join(', ') || '—' },
        ],
      }),
    ],
  })
}

/** The rule form, previewed before it is saved. */
const ruleForm = (c: Context, commit: 'create' | 'save'): JSXChild =>
  Stack({
    gap: 'default',
    items: [
      RecordModalForm({
        kind: c.kind,
        fields: ruleFields(c),
        actions: canWrite(c)
          ? [
              Button({
                label: t(c, 'action.previewPolicy'),
                variant: 'secondary',
                type: 'submit',
                name: RECORD_COMMAND_FIELD,
                value: 'previewSave',
              }),
              // Offered beside the answer, never before it.
              ...(c.outcome<PolicyPreview>('previewSave')
                ? [
                    Button({
                      label: t(c, commit === 'create' ? 'action.createPolicy' : 'action.savePolicy'),
                      variant: 'primary',
                      type: 'submit',
                      name: RECORD_COMMAND_FIELD,
                      value: commit,
                    }),
                  ]
                : []),
            ]
          : [],
      }),
      previewPanel(c),
    ],
  })

const membersTab = (c: Context): JSXChild =>
  c.data.members.length
    ? DataTable<AnyRow>({
        rows: c.data.members,
        id: (row) => String(row.id),
        columns: [
          {
            key: 'name',
            label: t(c, 'users.title'),
            priority: 'primary',
            cell: (row) => `${String(row.name)} · ${String(row.login)}`,
          },
          { key: 'since', label: t(c, 'policy.since'), cell: (row) => String(row.since ?? '—') },
          {
            key: 'state',
            label: t(c, 'field.state'),
            cell: (row) =>
              String(row.status) === 'blocked'
                ? Badge({ label: t(c, 'policy.memberBlocked'), tone: 'warning' })
                : Badge({ label: t(c, 'policy.memberApplied'), tone: 'positive' }),
          },
        ],
      })
    : Notice({ tone: 'info', title: t(c, 'policy.noMembers'), message: t(c, 'policy.noMembersHint') })

/** Pause a rule without deleting it: its people keep nothing it gave while it is paused. */
const stateSection = (c: Context): JSXChild =>
  c.data.permissions.pause
    ? Section({
        title: c.data.record.active ? t(c, 'policy.pauseTitle') : t(c, 'policy.resumeTitle'),
        description: c.data.record.active ? t(c, 'policy.pauseHint') : t(c, 'policy.resumeHint'),
        body: RecordModalForm({
          kind: c.kind,
          fields: [],
          command: 'setActive',
          actions: [
            Button({
              label: c.data.record.active ? t(c, 'action.pausePolicy') : t(c, 'action.resumePolicy'),
              variant: c.data.record.active ? 'destructive' : 'primary',
              type: 'submit',
            }),
          ],
        }),
      })
    : ''

const selectedRoles = (form: FormData, c: Context): string[] =>
  c.data.roles.map((role) => String(role.id)).filter((id) => checked(form, roleFieldName(id)))

const ruleInput = (form: FormData, c: Context, id: string | null): Record<string, unknown> => ({
  id,
  name: text(form, 'name'),
  description: text(form, 'description') || null,
  matchKind: text(form, 'matchKind'),
  matchValue: text(form, 'matchValue'),
  scopeKind: text(form, 'scopeKind') || 'company',
  companyId: text(form, 'companyId') || null,
  branchId: text(form, 'branchId') || null,
  roleIds: selectedRoles(form, c),
})

export const accessPolicyModalDefinition: RecordModalDefinition<AccessPolicyModalData> = {
  kind: 'user.accessPolicy',
  size: 'default',
  labels: () => USER_RECORD_MODAL_LABELS[pageLang()],
  context: {
    fn: 'user.accessPolicyModalContext',
    input: (id, creating) => (creating ? { locale: pageLang() } : { id, locale: pageLang() }),
  },
  title: (c) => (c.creating ? t(c, 'action.createPolicy') : c.data.record.name),
  status: (c) =>
    c.creating
      ? undefined
      : Badge({
          label: t(c, c.data.record.active ? 'state.active' : 'policy.paused'),
          tone: c.data.record.active ? 'positive' : 'neutral',
        }),
  body: (c) => (c.creating ? Section({ title: t(c, 'policy.ruleTitle'), body: ruleForm(c, 'create') }) : ''),
  tabs: [
    {
      id: 'rule',
      label: (c) => t(c, 'tab.policyRule'),
      visible: (c) => !c.creating,
      view: (c) =>
        Stack({
          gap: 'default',
          items: [
            DescriptionList({
              columns: 2,
              items: [
                {
                  id: 'members',
                  label: t(c, 'policy.membersColumn'),
                  value: String(c.data.members.length),
                },
                {
                  id: 'roles',
                  label: t(c, 'field.jobRoles'),
                  value: String(c.data.record.roleIds.length),
                },
              ],
            }),
            ruleForm(c, 'save'),
            stateSection(c),
          ],
        }),
    },
    {
      id: 'screens',
      label: (c) => t(c, 'tab.screens'),
      visible: () => false,
      view: (c) =>
        SurfaceAccessView({
          t: (key, params) => c.t(key, params),
          surfaces: c.data.surfaces ?? [],
          showVia: true,
          empty: { title: t(c, 'surface.emptyTitle'), message: t(c, 'policy.screensEmptyHint') },
        }),
    },
    {
      id: 'members',
      label: (c) => `${t(c, 'tab.policyMembers')} ${String(c.data.members.length)}`,
      visible: (c) => !c.creating,
      view: membersTab,
    },
  ],
  commands: {
    previewSave: {
      fn: 'user.previewAccessPolicy',
      // A rule not yet saved has no id; the preview matches people all the same.
      input: (form, c) => ruleInput(form, c, c.creating ? null : c.id),
      preview: true,
    },
    create: {
      fn: 'user.saveAccessPolicy',
      input: (form, c) => ({
        ...ruleInput(form, c, uuid()),

        previewDigest: c.outcome<{ previewDigest?: string }>('previewSave')?.previewDigest,
        expectedAuthorizationRevision: c.data.revision,
        idempotencyKey: uuid(),
      }),
      after: 'open',
      openTab: 'members',
      created: (value) => {
        const row = (value ?? {}) as { id?: unknown }
        return typeof row.id === 'string' ? row.id : null
      },
    },
    save: {
      fn: 'user.saveAccessPolicy',
      input: (form, c) => ({
        ...ruleInput(form, c, c.id),

        previewDigest: c.outcome<{ previewDigest?: string }>('previewSave')?.previewDigest,
        expectedAuthorizationRevision: c.data.revision,
        idempotencyKey: uuid(),
      }),
      after: 'reload',
    },
    setActive: {
      fn: 'user.setAccessPolicyActive',
      input: (form, c) => ({
        id: c.id,
        active: !c.data.record.active,

        expectedAuthorizationRevision: c.data.revision,
        idempotencyKey: uuid(),
      }),

      confirm: (c) => (c.data.record.active ? t(c, 'policy.pauseConfirm') : null),
      after: 'reload',
    },
  },
}

export const accessPolicyModal = createRecordModal(accessPolicyModalDefinition)
