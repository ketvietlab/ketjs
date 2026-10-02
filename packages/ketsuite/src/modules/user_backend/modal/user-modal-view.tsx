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
  Disclosure,
  DescriptionList,
  Notice,
  LinkButton,
  Section,
  Stack,
} from '@ketvietlab/design-system'
import type { FieldOption, FieldProps } from '@ketvietlab/design-system'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { createRecordModal, RECORD_COMMAND_FIELD } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import {
  RecordDialogTrigger,
  RecordModalForm,
  recordStateSelectControl,
} from '../../../ui/client/record-modal-form.tsx'
import { SurfaceAccessView, SurfaceChangeTable } from './access-surfaces.tsx'
import type { SurfaceAccess, SurfaceChange } from './access-surfaces.tsx'

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
  lastLoginAt: string | null
  invitationSentAt?: string | null
  passwordReady: boolean
  defaultCompanyId: string | null
  defaultBranchId: string | null
  /** When a break-glass grant ends; null for a standing superuser or none at all. */
  superuserExpiresAt?: string | null
  superuserReason?: string | null
}

/** The last call this person was refused, and the roles that would have allowed it. */
export type LastDenial = {
  fn: string
  /** The area the refused function belongs to, in the reader's language. */
  label: string
  /** The screen it was refused on, when the call came from one. */
  surface: string | null
  at: string
  count: number
  templates: string[]
}

/** How this tenant hands someone a new credential: a link to their own inbox, or a code shown once here. */
export type CredentialDelivery = 'email' | 'oneTime' | 'both'

export type UserModalData = {
  record: UserRecord
  companies: AnyRow[]
  branches: AnyRow[]
  assignments: AnyRow[]
  audit: AnyRow[]
  memberships: { companies: string[]; branches: string[] }
  roleCoverage: Record<string, AnyRow[]>
  roles: AnyRow[]
  scopeKinds: string[]
  revision: number
  permissions: Record<string, boolean>
  lang: 'vi' | 'en'
  /** Who is reading: the guards are about the reader as much as the person read. */
  actor?: { self: boolean; superuser: boolean }
  /** What this person can open and work on, screen by screen. */
  surfaces?: SurfaceAccess[]
  lastDenial?: LastDenial | null
  credentialDelivery?: CredentialDelivery
  /** Verified external identity state supplied by the deployment adapter. */
  externalCredential?: {
    state: 'pending' | 'ready' | 'failed' | 'cancelled'
    activated: boolean
    operationId: string | null
    claimable: boolean
    emailState: 'pending' | 'sending' | 'accepted' | 'uncertain' | 'failed' | null
  }
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
  props: {
    name: string
    label: string
    value: string
    options: FieldOption[]
    required?: boolean
  },
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

/** Who is reading this record is the person in it. Nobody changes their own authority. */
const readingSelf = (c: Context): boolean => c.data.actor?.self === true

const actorSuperuser = (c: Context): boolean => c.data.actor?.superuser === true

/** A role that hands out authority over authority. Only a superuser may give it. */
const securityTier = (role: AnyRow): boolean => String(role.tier ?? '') === 'security'

/**
 * The roles a form offers, each on its own line.
 *
 * A security-tier role is named as one and, for anyone but a superuser, offered
 * disabled rather than hidden: the reader sees it exists and why it is not theirs
 * to give, instead of wondering where it went.
 */
const roleOptions = (c: Context, isChecked: (roleId: string) => boolean): FieldOption[] =>
  c.data.roles.map((role) => ({
    name: roleFieldName(String(role.id)),
    value: '1',
    label: securityTier(role) ? `${String(role.name)} · ${t(c, 'role.tier.security')}` : String(role.name),
    checked: isChecked(String(role.id)),
    disabled: securityTier(role) && !actorSuperuser(c),
  }))

/** Why some offered roles cannot be ticked, when that is the case. */
const roleHelp = (c: Context, fallback?: string): string | undefined =>
  c.data.roles.some(securityTier) && !actorSuperuser(c) ? t(c, 'access.securityTierHint') : fallback

/**
 * The form that hires someone.
 *
 * It asks for the whole decision at once — who they are, where they work, what
 * they do. The server records the resulting authority change in its audit.
 */
const createFields = (c: Context): FieldProps[] => {
  const scopeKind = c.state('scopeKind', 'branch')
  const companyId = c.state('companyId', String(c.data.companies[0]?.id ?? ''))
  return [
    field(c, { name: 'name', label: t(c, 'field.name'), required: true }),
    field(c, { name: 'login', label: t(c, 'field.login'), required: true }),
    field(c, {
      name: 'email',
      label: t(c, 'field.email'),
      type: 'email',
      required: true,
      span: 'full',
    }),
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
              .map((branch) => ({
                value: String(branch.id),
                label: String(branch.name),
              })),
          }),
        ]
      : []),
    // Roles are optional: someone created without one holds no function until a
    // role is assigned, and there may be none to offer yet.
    ...(c.data.roles.length
      ? [
          field(c, {
            name: 'roleIds',
            label: t(c, 'field.jobRoles'),
            type: 'checkbox-group',
            span: 'full',
            help: roleHelp(c, t(c, 'users.rolesOptionalHint')),
            // One role per line: a person can hold several, and a row of boxes hides that.
            optionsOrientation: 'vertical',
            // What was ticked before a refusal comes back ticked.
            options: roleOptions(c, (roleId) => c.draftChecked(roleFieldName(roleId))),
          }),
        ]
      : []),
  ]
}

const createView = (c: Context): JSXChild =>
  Stack({
    gap: 'default',
    items: [
      // No role to offer does not stop the hire; it says why the person will start
      // with no access.
      ...(c.data.roles.length
        ? []
        : [
            Notice({
              tone: 'info',
              title: t(c, 'access.noAssignableRoles'),
              message: t(c, 'users.createWithoutRolesHint'),
            }),
          ]),
      Section({
        title: t(c, 'users.newTitle'),
        body: RecordModalForm({
          kind: c.kind,
          fields: createFields(c),
          command: 'create',
          actions: [
            Button({
              label: t(c, 'action.createUser'),
              variant: 'primary',
              type: 'submit',
            }),
          ],
        }),
      }),
    ],
  })

const profileFields = (c: Context): FieldProps[] => [
  field(c, {
    name: 'name',
    label: t(c, 'field.name'),
    value: c.data.record.name,
    required: true,
  }),
  field(c, {
    name: 'login',
    label: t(c, 'field.login'),
    value: c.data.record.login,
    required: true,
  }),
  field(c, {
    name: 'email',
    label: t(c, 'field.email'),
    type: 'email',
    value: c.data.record.email,
  }),
  field(c, {
    name: 'accessKind',
    label: t(c, 'field.accessKind'),
    type: 'select',
    value: c.data.record.accessKind,
    options: ACCESS_KINDS.map((kind) => ({
      value: kind,
      label: t(c, `access.${kind}`),
    })),
  }),
  field(c, {
    name: 'active',
    label: t(c, 'state.active'),
    type: 'checkbox',
    value: c.data.record.active,
  }),
]

const companyFieldName = (companyId: string): string => `company_${companyId}`
const branchFieldName = (branchId: string): string => `branch_${branchId}`

const selectedIds = (form: FormData, rows: AnyRow[], name: (id: string) => string): string[] =>
  rows.map((row) => String(row.id)).filter((id) => checked(form, name(id)))

/**
 * Where this person works, edited as one decision.
 *
 * Companies, branches and the workplace they land in are one answer, not five, so
 * they are one form and one command. Holding a company always carries its root
 * branch, which is why a company can be ticked without naming any branch.
 */
const workplaceFields = (c: Context): FieldProps[] => {
  const companies = c.data.memberships.companies
  const branches = c.data.memberships.branches
  const chosenCompanies = c.data.companies.filter((company) =>
    c.draftChecked(companyFieldName(String(company.id)), '1', companies.includes(String(company.id))),
  )
  const chosen = new Set(chosenCompanies.map((company) => String(company.id)))
  const offeredBranches = c.data.branches.filter((branch) => chosen.has(String(branch.companyId)))
  return [
    field(c, {
      name: 'companies',
      label: t(c, 'field.companies'),
      type: 'checkbox-group',
      required: true,
      span: 'full',
      optionsOrientation: 'vertical',
      options: c.data.companies.map((company) => ({
        name: companyFieldName(String(company.id)),
        value: '1',
        label: String(company.name),
        checked: companies.includes(String(company.id)),
      })),
    }),
    field(c, {
      name: 'branches',
      label: t(c, 'field.branches'),
      type: 'checkbox-group',
      span: 'full',
      optionsOrientation: 'vertical',
      options: offeredBranches.map((branch) => ({
        name: branchFieldName(String(branch.id)),
        value: '1',
        label: `${String(branch.name)} · ${String(
          c.data.companies.find((company) => String(company.id) === String(branch.companyId))?.name ?? '',
        )}`,
        checked: branches.includes(String(branch.id)),
      })),
    }),
    field(c, {
      name: 'defaultCompanyId',
      label: t(c, 'field.defaultCompany'),
      type: 'select',
      required: true,
      value: c.data.record.defaultCompanyId ?? String(chosenCompanies[0]?.id ?? ''),
      options: chosenCompanies.map((company) => ({
        value: String(company.id),
        label: String(company.name),
      })),
    }),
    field(c, {
      name: 'defaultBranchId',
      label: t(c, 'field.defaultBranch'),
      type: 'select',
      required: true,
      value: c.data.record.defaultBranchId ?? '',
      options: offeredBranches.map((branch) => ({
        value: String(branch.id),
        label: String(branch.name),
      })),
    }),
  ]
}

type WorkplacePreview = {
  ok: boolean
  /** Assignments held at a place being removed: they go with it. */
  removed?: AnyRow[]
}

/**
 * What leaving a workplace takes with it.
 *
 * A role held at a company or branch the person no longer works at is authority
 * nobody can see a use for; saving the new workplaces removes it too. The preview
 * names those roles first, so the removal is read before it is made.
 */
const workplacePreview = (c: Context): JSXChild => {
  const preview = c.outcome<WorkplacePreview>('previewWorkplaces')
  if (!preview) return ''
  if (!preview.ok) return Notice({ tone: 'warning', title: t(c, 'preview.unavailable'), message: '' })
  const removed = preview.removed ?? []
  return removed.length
    ? Stack({
        gap: 'compact',
        items: [
          Notice({
            tone: 'warning',
            title: t(c, 'workplace.removesTitle').replace('{count}', String(removed.length)),
            message: t(c, 'workplace.removesHint'),
          }),
          DataTable<AnyRow>({
            rows: removed,
            id: (row) => String(row.id),
            columns: [
              {
                key: 'role',
                label: t(c, 'field.assignment'),
                priority: 'primary',
                cell: (row) => String(row.roleName),
              },
              { key: 'scope', label: t(c, 'field.scope'), cell: (row) => scopeName(c, row) },
            ],
          }),
        ],
      })
    : Notice({ tone: 'info', title: t(c, 'workplace.keepsAll'), message: '' })
}

/** Where this person works. Where removals can be previewed, they are read before saving. */
const workplaceForm = (c: Context): JSXChild => {
  const previewing = c.data.permissions.previewWorkplaces === true
  return Stack({
    gap: 'default',
    items: [
      RecordModalForm({
        kind: c.kind,
        fields: workplaceFields(c),
        command: previewing ? null : 'setWorkplaces',
        actions: previewing
          ? [
              Button({
                label: t(c, 'action.previewWorkplaces'),
                variant: 'secondary',
                type: 'submit',
                name: RECORD_COMMAND_FIELD,
                value: 'previewWorkplaces',
              }),
              ...(c.outcome<WorkplacePreview>('previewWorkplaces')
                ? [
                    Button({
                      label: t(c, 'action.saveWorkplaces'),
                      variant: 'primary',
                      type: 'submit',
                      name: RECORD_COMMAND_FIELD,
                      value: 'setWorkplaces',
                    }),
                  ]
                : []),
            ]
          : [
              Button({
                label: t(c, 'action.saveWorkplaces'),
                variant: 'primary',
                type: 'submit',
              }),
            ],
      }),
      workplacePreview(c),
    ],
  })
}

/** The person, named once at the top of every tab, with the state that decides access. */
const header = (c: Context): JSXChild =>
  c.creating
    ? ''
    : Stack({
        gap: 'compact',
        items: [
          ...(c.data.permissions.save
            ? [
                RecordDialogTrigger({
                  dialog: 'edit',
                  children: Button({
                    label: t(c, 'action.editProfile'),
                    variant: 'secondary',
                  }),
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
        {
          id: 'email',
          label: t(c, 'field.email'),
          value: c.data.record.email || '—',
        },
        {
          id: 'state',
          label: t(c, 'field.state'),
          value: Badge({
            label: c.data.record.active ? t(c, 'state.active') : t(c, 'state.archived'),
            tone: c.data.record.active ? 'positive' : 'neutral',
          }),
        },
        {
          id: 'roles',
          label: t(c, 'field.rolesHeld'),
          value: String(c.data.assignments.length),
        },
        {
          id: 'company',
          label: t(c, 'field.company'),
          value: company ? String(company) : '—',
        },
        ...(c.data.record.superuser
          ? [
              {
                id: 'superuser',
                label: t(c, 'field.superuser'),
                value: Badge({
                  label: c.data.record.superuserExpiresAt
                    ? t(c, 'breakGlass.activeUntil').replace('{until}', c.data.record.superuserExpiresAt)
                    : t(c, 'breakGlass.standing'),
                  tone: 'danger',
                }),
              },
            ]
          : []),
      ],
    }),
  })
}

/** The call this person was last refused, said the way they would have met it. */
const denialNotice = (c: Context): JSXChild[] => {
  const denial = c.data.lastDenial
  if (!denial) return []
  const where = denial.surface
    ? t(c, 'denial.onSurface').replace('{surface}', denial.surface).replace('{at}', denial.at)
    : t(c, 'denial.at').replace('{at}', denial.at)
  const times = denial.count > 1 ? ` ${t(c, 'denial.count').replace('{count}', String(denial.count))}` : ''
  const fix = denial.templates.length
    ? t(c, 'denial.fix').replace('{roles}', denial.templates.join(', '))
    : t(c, 'denial.noFix')
  return [
    Notice({
      tone: 'warning',
      title: t(c, 'denial.title').replace('{area}', denial.label),
      message: `${where}${times} ${fix}`,
    }),
  ]
}

/**
 * What this person can open and actually work on.
 *
 * The question a support call asks is never "which bundles": it is "why can't
 * they pick a tax on the quotation". The last refusal, when there is one, leads,
 * because it is usually the reason the record was opened.
 */
const screensTab = (c: Context): JSXChild =>
  Stack({
    gap: 'default',
    items: [
      DescriptionList({
        columns: 1,
        items: [
          {
            id: 'diagnostic-scope',
            label: t(c, 'surface.scopeLabel'),
            value:
              [
                c.data.companies.find((row) => row.id === c.data.record.defaultCompanyId)?.name,
                c.data.branches.find((row) => row.id === c.data.record.defaultBranchId)?.name,
              ]
                .filter(Boolean)
                .join(' · ') || t(c, 'surface.noWorkplace'),
          },
        ],
      }),
      ...denialNotice(c),
      SurfaceAccessView({
        t: (key, params) => c.t(key, params),
        surfaces: c.data.surfaces ?? [],
        showVia: true,
        empty: { title: t(c, 'surface.emptyTitle'), message: t(c, 'surface.emptyHint') },
      }),
    ],
  })

/** Where an assignment applies, written the way the person reads it. */
const scopeName = (c: Context, row: AnyRow): string =>
  row.branch
    ? `${String(row.company)} · ${String(row.branch)}`
    : row.company
      ? String(row.company)
      : t(c, 'scope.choice.tenant')

/** One group per place: authority is held somewhere, and the place is what differs. */
const assignmentGroups = (c: Context): Array<{ key: string; title: string; rows: AnyRow[] }> => {
  const groups = new Map<string, { key: string; title: string; rows: AnyRow[] }>()
  for (const row of c.data.assignments) {
    const key = String(row.scopeKey ?? 'tenant')
    const group = groups.get(key) ?? {
      key,
      title: scopeName(c, row),
      rows: [],
    }
    group.rows.push(row)
    groups.set(key, group)
  }
  return [...groups.values()]
}

/** Where an assignment came from: someone's decision, or a rule that matched this person. */
const sourceOf = (row: AnyRow): { kind: 'manual' } | { kind: 'policy'; policyName: string } =>
  row.source?.kind === 'policy'
    ? { kind: 'policy', policyName: String(row.source.policyName ?? row.source.policyId ?? '') }
    : { kind: 'manual' }

const sourceBadge = (c: Context, row: AnyRow): JSXChild => {
  const source = sourceOf(row)
  return source.kind === 'policy'
    ? Badge({ label: t(c, 'access.source.policy').replace('{policy}', source.policyName), tone: 'info' })
    : Badge({ label: t(c, 'access.source.manual'), tone: 'neutral' })
}

/** Why the reader is not offered the assign action, or the action itself. */
const accessControls = (c: Context): JSXChild[] =>
  readingSelf(c)
    ? // Nobody widens or narrows their own authority, superuser or not: the change
      // would be approved by the person it benefits.
      [
        Notice({
          tone: 'info',
          title: t(c, 'access.selfTitle'),
          message: t(c, 'access.selfHint'),
        }),
      ]
    : c.data.permissions.assign
      ? [
          RecordDialogTrigger({
            dialog: 'assign',
            children: Button({
              label: t(c, 'action.assignRole'),
              variant: 'primary',
            }),
          }),
        ]
      : [
          Notice({
            tone: 'info',
            title: t(c, 'users.readOnlyTitle'),
            message: t(c, 'access.readOnlyHint'),
          }),
        ]

/**
 * Standing in for a superuser for a while, and taking it back.
 *
 * Nobody is made a superuser by editing their profile: it is a grant with an end,
 * an owner, given only by a superuser, and it shows here for as long
 * as it lasts.
 */
const breakGlassSection = (c: Context): JSXChild[] => {
  const record = c.data.record
  const active = record.superuser === true
  if (!c.data.permissions.breakGlass || readingSelf(c))
    return active
      ? [
          Notice({
            tone: 'warning',
            title: t(c, 'breakGlass.activeTitle'),
            message: record.superuserExpiresAt
              ? t(c, 'breakGlass.activeUntil').replace('{until}', record.superuserExpiresAt)
              : t(c, 'breakGlass.standing'),
          }),
        ]
      : []
  return [
    Section({
      title: t(c, 'breakGlass.title'),
      description: t(c, 'breakGlass.hint'),
      body: active
        ? Stack({
            gap: 'default',
            items: [
              Notice({
                tone: 'warning',
                title: t(c, 'breakGlass.activeTitle'),
                message: record.superuserExpiresAt
                  ? t(c, 'breakGlass.activeUntil').replace('{until}', record.superuserExpiresAt)
                  : t(c, 'breakGlass.standing'),
              }),
              RecordModalForm({
                kind: c.kind,
                fields: [],
                command: 'revokeBreakGlass',
                actions: [
                  Button({ label: t(c, 'action.revokeBreakGlass'), variant: 'destructive', type: 'submit' }),
                ],
              }),
            ],
          })
        : RecordModalForm({
            kind: c.kind,
            fields: [
              field(c, {
                name: 'breakGlassUntil',
                label: t(c, 'field.breakGlassUntil'),
                type: 'datetime-local',
                required: true,
                disabled: false,
              }),
            ],
            command: 'grantBreakGlass',
            actions: [
              Button({ label: t(c, 'action.grantBreakGlass'), variant: 'destructive', type: 'submit' }),
            ],
          }),
    }),
  ]
}

/** What this person may do, as rows of role and place — the authority they actually hold. */
const accessTab = (c: Context): JSXChild => {
  const groups = assignmentGroups(c)
  return Stack({
    gap: 'default',
    items: [
      ...accessControls(c),
      ...(groups.length
        ? groups.map((group) =>
            Section({
              title: group.title,
              body: DataTable<AnyRow>({
                rows: group.rows,
                id: (row) => String(row.id),
                columns: [
                  {
                    key: 'role',
                    label: t(c, 'field.assignment'),
                    priority: 'primary',
                    // The row opens the role: what it covers, and the way to take it back.
                    cell: (row) =>
                      RecordDialogTrigger({
                        dialog: 'role',
                        id: String(row.id),
                        children: String(row.roleName),
                      }),
                  },
                  {
                    key: 'source',
                    label: t(c, 'access.sourceColumn'),
                    cell: (row) => sourceBadge(c, row),
                  },
                ],
              }),
            }),
          )
        : [
            Notice({
              tone: 'info',
              title: t(c, 'users.noAssignments'),
              message: t(c, 'access.emptyHint'),
            }),
          ]),
      ...(Array.isArray(c.data.surfaces)
        ? [
            RecordDialogTrigger({
              dialog: 'diagnostics',
              children: Button({ label: t(c, 'action.checkAccess'), variant: 'secondary' }),
            }),
          ]
        : []),
      ...(breakGlassSection(c).length
        ? [Disclosure({ summary: t(c, 'access.advanced'), body: Stack({ items: breakGlassSection(c) }) })]
        : []),
    ],
  })
}

/** The fields that say where a role would apply and which roles are being given. */
const assignFields = (c: Context): FieldProps[] => {
  const scopeKind = c.state('scopeKind', 'branch')
  const companyId = c.state('companyId', String(c.data.companies[0]?.id ?? ''))
  return [
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
              .map((branch) => ({
                value: String(branch.id),
                label: String(branch.name),
              })),
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
      help: roleHelp(c),
      options: roleOptions(c, (roleId) => c.draft(roleFieldName(roleId), '') === '1'),
    }),
  ]
}

type PreviewBundle = {
  key: string
  labels: { vi: string; en: string }
  before: number
  after: number
  total: number
}
type PreviewContext = {
  companyId: string
  branchId: string | null
  superuser: boolean
  bundles: PreviewBundle[]
  /** The screens whose reach the change moves, when the server measures them. */
  surfaces?: SurfaceChange[]
  sensitiveChange: boolean
}
type Preview = { ok: boolean; contexts?: PreviewContext[] }

/** How much of a bundle a person covers, said in words rather than a fraction. */
const coverage = (c: Context, covered: number, total: number): string =>
  covered === 0 ? t(c, 'coverage.none') : covered >= total ? t(c, 'coverage.full') : t(c, 'coverage.partial')

/**
 * What the selection would change, before it changes anything.
 *
 * The answer is the server's, computed from the same selection that is still on
 * screen: every bundle the added or removed roles touch, with the reach the
 * person has now beside the reach they would have.
 */
const previewPanel = (c: Context, command: string): JSXChild => {
  const preview = c.outcome<Preview>(command)
  if (!preview) return ''
  if (!preview.ok)
    return Notice({
      tone: 'warning',
      title: t(c, 'preview.unavailable'),
      message: '',
    })
  const contexts = preview.contexts ?? []
  if (!contexts.length)
    return Notice({
      tone: 'info',
      title: t(c, 'preview.noChange'),
      message: t(c, 'preview.noChangeHint'),
    })
  return Stack({
    gap: 'compact',
    items: contexts.flatMap((entry): JSXChild[] => [
      ...(entry.sensitiveChange
        ? [
            Notice({
              tone: 'warning',
              title: t(c, 'preview.sensitiveTitle'),
              message: t(c, 'preview.sensitiveHint'),
            }),
          ]
        : []),
      ...(entry.superuser
        ? [
            Notice({
              tone: 'info',
              title: t(c, 'preview.superuser'),
              message: '',
            }),
          ]
        : entry.bundles.length || entry.surfaces?.length
          ? [
              Section({
                title: t(c, 'preview.gains'),
                body: Stack({
                  items: entry.bundles
                    .filter((row) => row.after > row.before)
                    .map((row) => row.labels[c.data.lang] ?? row.key)
                    .concat(
                      entry.bundles.some((row) => row.after > row.before) ? [] : [t(c, 'value.unchanged')],
                    ),
                }),
              }),
              Section({
                title: t(c, 'preview.loses'),
                body: Stack({
                  items: entry.bundles
                    .filter((row) => row.after < row.before)
                    .map((row) => row.labels[c.data.lang] ?? row.key)
                    .concat(
                      entry.bundles.some((row) => row.after < row.before) ? [] : [t(c, 'value.unchanged')],
                    ),
                }),
              }),
              Disclosure({
                summary: t(c, 'preview.details'),
                body: Stack({
                  items: [
                    // Screens first: "can open the quotation form but not pick a tax" is
                    // the consequence a reader acts on; the bundles below say why.
                    ...(entry.surfaces?.length
                      ? [
                          Section({
                            title: t(c, 'surface.previewTitle'),
                            body: SurfaceChangeTable(
                              (key, params) => c.t(key, params),
                              entry.surfaces,
                              `${entry.companyId}:${entry.branchId ?? ''}`,
                            ),
                          }),
                        ]
                      : []),
                    DataTable<PreviewBundle>({
                      rows: entry.bundles,
                      id: (row) => `${entry.companyId}:${entry.branchId ?? ''}:${row.key}`,
                      columns: [
                        {
                          key: 'bundle',
                          label: t(c, 'preview.bundle'),
                          priority: 'primary',
                          cell: (row) => row.labels[c.data.lang] ?? row.key,
                        },
                        {
                          key: 'before',
                          label: t(c, 'preview.before'),
                          cell: (row) => coverage(c, row.before, row.total),
                        },
                        {
                          key: 'after',
                          label: t(c, 'preview.after'),
                          cell: (row) => coverage(c, row.after, row.total),
                        },
                      ],
                    }),
                  ],
                }),
              }),
            ]
          : [
              Notice({
                tone: 'info',
                title: t(c, 'preview.noChange'),
                message: '',
              }),
            ]),
    ]),
  })
}

/** Ask what a role would do here, then give it. Both steps are one form and one selection. */
const assignDialog = (c: Context): JSXChild =>
  !c.data.roles.length
    ? // Nothing to choose from is a state of the deployment, not an empty field: a
      // role can only be given here once it has been built from a role template.
      Notice({
        tone: 'warning',
        title: t(c, 'access.noAssignableRoles'),
        message: t(c, 'access.noAssignableRolesHint'),
      })
    : Stack({
        gap: 'default',
        items: [
          RecordModalForm({
            kind: c.kind,
            fields: assignFields(c),
            actions: [
              Button({
                label: t(c, 'action.previewAssignment'),
                variant: 'secondary',
                type: 'submit',
                name: RECORD_COMMAND_FIELD,
                value: 'previewAssign',
              }),
              // Only offered once the consequence has been read: the confirm button
              // appears beside the answer, not before it.
              ...(c.outcome<Preview>('previewAssign')
                ? [
                    Button({
                      label: t(c, 'action.confirmAssign'),
                      variant: 'primary',
                      type: 'submit',
                      name: RECORD_COMMAND_FIELD,
                      value: 'assign',
                    }),
                  ]
                : []),
            ],
          }),
          previewPanel(c, 'previewAssign'),
        ],
      })

/** The areas one role covers, as the context measured them. */
const coverageOf = (c: Context, roleId: string): AnyRow[] => c.data.roleCoverage[roleId] ?? []

/** The role as held: what it covers, where it applies, and the form that takes it back. */
const roleDialog = (c: Context): JSXChild => {
  const assignment = c.data.assignments.find((row) => String(row.id) === String(c.dialog?.params.id ?? ''))
  if (!assignment)
    return Notice({
      tone: 'info',
      title: t(c, 'users.noAssignments'),
      message: '',
    })
  return Stack({
    gap: 'default',
    items: [
      DescriptionList({
        columns: 2,
        items: [
          {
            id: 'role',
            label: t(c, 'field.assignment'),
            value: String(assignment.roleName),
          },
          {
            id: 'scope',
            label: t(c, 'field.scope'),
            value: scopeName(c, assignment),
          },
          {
            id: 'source',
            label: t(c, 'access.sourceColumn'),
            value: sourceBadge(c, assignment),
          },
        ],
      }),
      // What the role is for, not only where it applies.
      ...(coverageOf(c, String(assignment.roleId)).length
        ? [
            Section({
              title: t(c, 'preview.bundle'),
              body: DataTable<AnyRow>({
                rows: coverageOf(c, String(assignment.roleId)),
                id: (row) => String(row.key),
                columns: [
                  {
                    key: 'bundle',
                    label: t(c, 'preview.bundle'),
                    priority: 'primary',
                    cell: (row) => String(row.labels?.[c.data.lang] ?? row.key),
                  },
                  {
                    key: 'level',
                    label: t(c, 'coverage.level'),
                    cell: (row) => coverage(c, Number(row.covered), Number(row.total)),
                  },
                ],
              }),
            }),
          ]
        : []),
      // A rule gave it, so a rule takes it back: removing it here would last until
      // the next sign-in re-applied the policy.
      ...(sourceOf(assignment).kind === 'policy'
        ? [
            Notice({
              tone: 'info',
              title: t(c, 'access.policyOwnedTitle'),
              message: t(c, 'access.policyOwnedHint'),
            }),
          ]
        : []),
      ...(c.data.permissions.remove && !readingSelf(c) && sourceOf(assignment).kind !== 'policy'
        ? [
            Stack({
              gap: 'default',
              items: [
                RecordModalForm({
                  kind: c.kind,
                  fields: [],
                  actions: [
                    Button({
                      label: t(c, 'action.previewRemoval'),
                      variant: 'secondary',
                      type: 'submit',
                      name: RECORD_COMMAND_FIELD,
                      value: 'previewUnassign',
                    }),
                    ...(c.outcome<Preview>('previewUnassign')
                      ? [
                          Button({
                            label: t(c, 'action.unassignScopedRole'),
                            variant: 'destructive',
                            type: 'submit',
                            name: RECORD_COMMAND_FIELD,
                            value: 'unassign',
                          }),
                        ]
                      : []),
                  ],
                }),
                previewPanel(c, 'previewUnassign'),
              ],
            }),
          ]
        : []),
    ],
  })
}

/**
 * How a new credential reaches this person here.
 *
 * The tenant chooses: a link sent to the person's own inbox, so nobody else ever
 * holds it, or — where staff share devices or have no mailbox — a code shown once
 * to the administrator. A deployment that cannot send the link yet falls back to
 * the code rather than offering a button that fails.
 */
const deliveryOf = (c: Context): CredentialDelivery =>
  c.data.credentialDelivery === 'email' && !c.data.externalCredential && !c.data.permissions.sendLink
    ? 'oneTime'
    : (c.data.credentialDelivery ?? 'oneTime')
const activated = (c: Context): boolean => c.data.externalCredential?.activated ?? c.data.record.passwordReady

/** Send the person a link to set their own password. The administrator never sees it. */
const emailReset = (c: Context): JSXChild[] => {
  const sent = c.outcome<{ ok?: boolean; sentTo?: string; expiresAt?: string }>('sendResetLink')
  return [
    ...(sent?.ok
      ? [
          Notice({
            tone: 'positive',
            title: t(c, 'login.linkSentTitle'),
            message: t(c, 'login.linkSentHint')
              .replace('{email}', String(sent.sentTo ?? c.data.record.email))
              .replace('{until}', String(sent.expiresAt ?? '')),
          }),
        ]
      : []),
    Section({
      title: t(c, activated(c) ? 'login.linkTitle' : 'login.inviteTitle'),
      description: c.data.record.email
        ? t(c, activated(c) ? 'login.linkHint' : 'login.inviteHint').replace('{email}', c.data.record.email)
        : null,
      // No address, no link: say what is missing instead of offering a send that
      // has nowhere to go.
      body: c.data.record.email
        ? RecordModalForm({
            kind: c.kind,
            fields: [],
            command: 'sendResetLink',
            actions: [
              Button({
                label: t(
                  c,
                  activated(c)
                    ? 'action.sendResetLink'
                    : sent?.ok || c.data.record.invitationSentAt
                      ? 'action.resendInvite'
                      : 'action.sendInvite',
                ),
                variant: 'primary',
                type: 'submit',
              }),
            ],
          })
        : Notice({
            tone: 'warning',
            title: t(c, 'login.linkNoEmail'),
            message: t(c, 'login.linkNoEmailHint'),
          }),
    }),
  ]
}

/** Issue a one-time code and show it, once, to the administrator who asked. */
const oneTimeReset = (c: Context): JSXChild[] => {
  const issued =
    c.outcome<{ ok?: boolean; token?: string; temporaryPassword?: string }>('resetPassword') ??
    c.outcome<{ token?: string; temporaryPassword?: string }>('claimCredential')
  return [
    // Shown once, by the only party that ever holds it in the clear.
    ...(issued?.token || issued?.temporaryPassword
      ? [
          Section({
            title: t(c, issued?.temporaryPassword ? 'login.temporaryShownOnce' : 'login.oneTimeTitle'),
            body: Stack({
              gap: 'compact',
              items: [
                Notice({
                  tone: 'warning',
                  title: t(c, issued?.temporaryPassword ? 'login.temporaryShownOnce' : 'login.oneTimeTitle'),
                  message: t(c, 'login.oneTimeHint'),
                }),
                DescriptionList({
                  columns: 1,
                  items: [
                    {
                      id: 'token',
                      label: t(c, c.data.externalCredential ? 'login.temporaryLabel' : 'login.oneTimeLabel'),
                      value: issued.token ?? issued.temporaryPassword,
                    },
                  ],
                }),
              ],
            }),
          }),
        ]
      : []),
    issued?.temporaryPassword
      ? null
      : Section({
          title: t(
            c,
            c.data.externalCredential
              ? 'login.temporaryTitle'
              : activated(c)
                ? 'login.resetTitle'
                : 'login.activateTitle',
          ),
          description: t(
            c,
            c.data.externalCredential
              ? 'login.temporaryHint'
              : activated(c)
                ? 'login.resetHint'
                : 'login.activateHint',
          ),
          body: issued?.temporaryPassword
            ? null
            : RecordModalForm({
                kind: c.kind,
                fields: [],
                command: c.data.externalCredential?.claimable ? 'claimCredential' : 'resetPassword',
                actions: [
                  Button({
                    label: t(
                      c,
                      c.data.externalCredential
                        ? c.data.externalCredential.claimable
                          ? 'action.claimPassword'
                          : 'action.temporaryPassword'
                        : activated(c)
                          ? 'action.resetPassword'
                          : 'action.activationCode',
                    ),
                    variant: 'primary',
                    type: 'submit',
                  }),
                ],
              }),
        }),
  ]
}

/**
 * What it takes to sign in as this person, and the one thing an administrator may
 * do about it.
 *
 * There is no session list and no way to set somebody else's password. A session
 * belongs to the serve layer rather than to this module, so there is nothing here
 * to read or revoke; and a reset does the administrator's work — a new credential,
 * every session ended — while leaving the password itself with its owner.
 */
const loginTab = (c: Context): JSXChild => {
  const delivery = deliveryOf(c)
  const mayReset = c.data.permissions.sendLink || c.data.permissions.resetPassword
  return Stack({
    gap: 'default',
    items: [
      ...(c.data.permissions.identities
        ? [
            LinkButton({
              label: t(c, 'login.identities'),
              href: `/admin/oauth/identities?${new URLSearchParams({ user: c.id, lang: c.data.lang })}`,
            }),
          ]
        : []),
      Section({
        title: t(c, 'login.accountTitle'),
        body: DescriptionList({
          columns: 2,
          items: [
            {
              id: 'credential',
              label: t(c, 'field.credential'),
              value: Badge({
                label: t(
                  c,
                  activated(c)
                    ? 'login.ready'
                    : c.data.record.invitationSentAt || c.outcome<{ ok?: boolean }>('sendResetLink')?.ok
                      ? 'login.invited'
                      : 'login.preparing',
                ),
                tone: activated(c) ? 'positive' : 'warning',
              }),
            },
            {
              id: 'login',
              label: t(c, 'field.login'),
              value: c.data.record.login,
            },
            {
              id: 'lastLogin',
              label: t(c, 'login.lastSignIn'),
              value: c.data.record.lastLoginAt || t(c, 'login.never'),
            },
            {
              id: 'delivery',
              label: t(c, 'login.delivery'),
              value: t(c, `login.delivery.${delivery}`),
            },
          ],
        }),
      }),
      ...(c.data.externalCredential
        ? [
            Section({
              title: t(c, `login.externalState.${c.data.externalCredential.state}`),
              body: RecordModalForm({
                kind: c.kind,
                fields: [],
                command: c.data.permissions.retryCredential ? 'retryCredential' : 'refreshAccount',
                actions: [
                  Button({
                    type: 'submit',
                    label: t(
                      c,
                      c.data.permissions.retryCredential ? 'action.retryAccount' : 'action.refreshAccount',
                    ),
                  }),
                ],
              }),
            }),
          ]
        : []),
      ...(c.data.externalCredential?.emailState
        ? [
            Notice({
              tone: ['failed', 'uncertain'].includes(c.data.externalCredential.emailState)
                ? 'warning'
                : 'info',
              title: t(c, `login.emailState.${c.data.externalCredential.emailState}`),
              message: t(c, 'login.emailStateHint'),
            }),
          ]
        : []),
      // Resetting your own password is the profile's job, with the current one.
      ...(readingSelf(c)
        ? [
            Notice({
              tone: 'info',
              title: t(c, 'login.selfTitle'),
              message: t(c, 'login.selfHint'),
            }),
          ]
        : mayReset
          ? [
              ...(delivery !== 'oneTime' && c.data.permissions.sendLink ? emailReset(c) : []),
              ...(delivery !== 'email' && c.data.permissions.resetPassword ? oneTimeReset(c) : []),
            ]
          : // An account still being prepared waits on its state, which the section above
            // already names; calling that "read only" blames a permission the reader has.
            c.data.externalCredential && c.data.externalCredential.state !== 'ready'
            ? []
            : [
                Notice({
                  tone: 'info',
                  title: t(c, 'users.readOnlyTitle'),
                  message: t(c, 'login.readOnlyHint'),
                }),
              ]),
    ],
  })
}

/** What was done to this person's authority, and who did it. */
const auditTab = (c: Context): JSXChild =>
  c.data.audit.length
    ? DataTable<AnyRow>({
        rows: c.data.audit,
        id: (row) => String(row.id),
        columns: [
          {
            key: 'when',
            label: t(c, 'audit.when'),
            cell: (row) => String(row.occurredAt ?? '—'),
          },
          {
            key: 'event',
            label: t(c, 'audit.action'),
            priority: 'primary',
            cell: (row) => `${t(c, `audit.event.${String(row.event)}`)} · ${String(row.actor ?? '—')}`,
          },
          {
            key: 'roles',
            label: t(c, 'field.assignment'),
            cell: (row) => (row.roleIds as string[]).map((id) => roleNameOf(c, id)).join(' · ') || '—',
          },
          {
            key: 'outcome',
            label: t(c, 'audit.outcome'),
            cell: (row) =>
              Badge({
                label: t(c, `audit.outcome.${String(row.outcome)}`),
                tone: String(row.outcome) === 'success' ? 'positive' : 'danger',
              }),
          },
        ],
      })
    : Notice({
        tone: 'info',
        title: t(c, 'audit.empty'),
        message: t(c, 'audit.emptyHint'),
      })

/** A role named by what it is called, falling back to the id it was recorded under. */
const roleNameOf = (c: Context, roleId: string): string =>
  String(
    c.data.assignments.find((row) => String(row.roleId) === roleId)?.roleName ??
      c.data.roles.find((row) => String(row.id) === roleId)?.name ??
      roleId,
  )

/** The assignment a role dialog is open on, for the commands it submits. */
const openAssignment = (c: Context): AnyRow =>
  c.data.assignments.find((row) => String(row.id) === String(c.dialog?.params.id ?? '')) ?? {}

/** The workplace and roles a submitted assign form is asking for. */
const assignSelection = (form: FormData, c: Context): Record<string, unknown> => ({
  userId: c.id,
  roleIds: selectedRoles(form, c.data.roles),
  scopeKind: text(form, 'scopeKind') || 'branch',
  companyId: text(form, 'companyId') || null,
  branchId: text(form, 'branchId') || null,
  // A role given somewhere the person does not yet work brings the workplace with
  // it; the server refuses that unless the actor may also grant the membership.
  addMembership: true,
})

export const userModalDefinition: RecordModalDefinition<UserModalData> = {
  kind: 'user.user',
  labels: () => USER_RECORD_MODAL_LABELS[pageLang()],
  context: {
    fn: 'user.userModalContext',
    input: (id, creating) => (creating ? { locale: pageLang() } : { id, locale: pageLang() }),
  },
  title: (c) => (c.creating ? t(c, 'users.create') : c.data.record.name || c.data.record.login),
  description: (c) => (c.creating ? t(c, 'users.createSubtitle') : c.data.record.login),
  status: (c) =>
    c.creating
      ? undefined
      : Badge({
          label: c.data.record.active ? t(c, 'state.active') : t(c, 'state.archived'),
          tone: c.data.record.active ? 'positive' : 'neutral',
        }),
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
    {
      id: 'screens',
      label: (c) => t(c, 'tab.screens'),
      // Only where the context measured it: a deployment that does not report
      // screens has nothing true to put in the tab.
      visible: () => false,
      view: screensTab,
    },
    {
      id: 'login',
      label: (c) => t(c, 'tab.login'),
      visible: (c) => !c.creating,
      view: loginTab,
    },
    {
      id: 'audit',
      label: (c) => t(c, 'tab.audit'),
      // The log is its own permission: a viewer may open a person without being
      // allowed to read the history of who gave them what.
      visible: (c) => !c.creating && c.data.permissions.audit === true,
      view: auditTab,
    },
  ],
  dialogs: {
    diagnostics: { title: (c) => t(c, 'action.checkAccess'), view: screensTab, size: 'large' },
    assign: { title: (c) => t(c, 'action.assignRole'), view: assignDialog },
    role: {
      title: (c) => String(openAssignment(c).roleName ?? ''),
      view: roleDialog,
    },
    edit: {
      title: (c) => t(c, 'action.editProfile'),
      view: (c) =>
        Stack({
          gap: 'default',
          items: [
            Section({
              title: t(c, 'users.profileTitle'),
              body: RecordModalForm({
                kind: c.kind,
                fields: profileFields(c),
                command: 'save',
                actions: [
                  Button({
                    label: t(c, 'action.save'),
                    variant: 'primary',
                    type: 'submit',
                  }),
                ],
              }),
            }),
            // Its own form and its own command: who a person is and where they work
            // are separate decisions, and only the second one is audited authority.
            ...(c.data.permissions.workplaces
              ? [
                  Section({
                    title: t(c, 'users.workplaceTitle'),
                    body: workplaceForm(c),
                  }),
                ]
              : []),
          ],
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
    previewWorkplaces: {
      fn: 'user.previewWorkplaces',
      input: (form, c) => ({
        userId: c.id,
        companyIds: selectedIds(form, c.data.companies, companyFieldName),
        branchIds: selectedIds(form, c.data.branches, branchFieldName),
      }),
      preview: true,
    },
    setWorkplaces: {
      fn: 'user.setWorkplaces',
      input: (form, c) => ({
        userId: c.id,
        companyIds: selectedIds(form, c.data.companies, companyFieldName),
        branchIds: selectedIds(form, c.data.branches, branchFieldName),
        defaultCompanyId: text(form, 'defaultCompanyId'),
        defaultBranchId: text(form, 'defaultBranchId'),

        expectedAuthorizationRevision: c.data.revision,
        idempotencyKey: uuid(),
      }),
      // The server names its inputs; the form names its fields.
      issueField: (field) => ({ companyIds: 'companies', branchIds: 'branches' })[field] ?? field,
      // Read the person again: every tab shows where they now work.
      after: 'reload',
    },
    sendResetLink: {
      fn: 'user.sendCredentialLink',
      input: (form, c) => ({
        userId: c.id,
        kind: c.data.record.passwordReady ? 'reset' : 'invitation',

        idempotencyKey: uuid(),
      }),
      // Reload invitation status while keeping the delivery outcome visible.
      after: 'reload',
    },
    grantBreakGlass: {
      fn: 'user.setBreakGlass',
      input: (form, c) => {
        const until = text(form, 'breakGlassUntil')
        const at = until ? new Date(until) : null
        return {
          userId: c.id,
          enabled: true,
          expiresAt: at && Number.isFinite(at.getTime()) ? at.toISOString() : null,

          expectedAuthorizationRevision: c.data.revision,
          idempotencyKey: uuid(),
        }
      },
      issueField: (field) => (field === 'expiresAt' ? 'breakGlassUntil' : field),
      confirm: (c) => t(c, 'breakGlass.confirm'),
      after: 'reload',
    },
    revokeBreakGlass: {
      fn: 'user.setBreakGlass',
      input: (form, c) => ({
        userId: c.id,
        enabled: false,
        expiresAt: null,

        expectedAuthorizationRevision: c.data.revision,
        idempotencyKey: uuid(),
      }),

      after: 'reload',
    },
    resetPassword: {
      fn: 'user.issueAuthToken',
      input: (_form, c) => ({
        userId: c.id,
        kind: c.data.record.passwordReady ? 'reset' : 'invitation',
        realm: 'backend',
      }),
      // Stay: the server hands back a credential it will never say again, and the
      // tab is where the person reading it is.
      after: 'stay',
    },
    previewAssign: {
      fn: 'user.previewRoleAssignment',
      input: (form, c) => assignSelection(form, c),
      preview: true,
    },
    assign: {
      fn: 'user.assignRoles',
      input: (form, c) => ({
        ...assignSelection(form, c),

        expectedAuthorizationRevision: c.data.revision,
        idempotencyKey: uuid(),
      }),
      // Read the person again: the access tab is a list of what they now hold.
      after: 'reload',
    },
    previewUnassign: {
      fn: 'user.previewRoleAssignment',
      input: (_form, c) => {
        const assignment = openAssignment(c)
        return {
          userId: c.id,
          assignmentId: String(assignment.id ?? ''),
          roleIds: [String(assignment.roleId ?? '')],
          scopeKind: String(assignment.scopeKind ?? 'tenant'),
          companyId: assignment.companyId ?? null,
          branchId: assignment.branchId ?? null,
        }
      },
      preview: true,
    },
    unassign: {
      fn: 'user.unassignScopedRole',
      input: (form, c) => {
        const assignment = openAssignment(c)
        return {
          userId: c.id,
          assignmentId: String(assignment.id ?? ''),
          roleId: String(assignment.roleId ?? ''),
          scopeKey: String(assignment.scopeKey ?? 'tenant'),

          expectedAuthorizationRevision: c.data.revision,
          idempotencyKey: uuid(),
        }
      },
      after: 'reload',
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
