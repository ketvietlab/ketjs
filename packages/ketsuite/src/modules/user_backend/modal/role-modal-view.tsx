// The role record modal, client side (KetSuite record-modal contract).
//
// The roles collection opens a role here, and its create action opens the same
// modal with an empty record. The view is render-pure: it reads what
// `user.roleModalContext` returned and writes design-system markup.
//
// A managed role and a custom role are one record read two ways. A managed role
// is this deployment's own policy: it is shown with the templates its authority
// comes from, and changed by copying it. A custom role is a local decision, so
// its areas are a form.
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
import type { FieldProps } from '@ketvietlab/design-system'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { CHECK_ALL, createRecordModal } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import { RecordModalForm } from '../../../ui/client/record-modal-form.tsx'

// biome-ignore lint/suspicious/noExplicitAny: rows are JSON shaped by user.roleModalContext
type AnyRow = Record<string, any>

export type RoleRecord = {
  id: string
  name: string
  description: string
  mode: 'managed' | 'custom'
  templateKey: string | null
  templateVersion: number | null
  revision: number
  healthy: boolean
}

export type RoleModalData = {
  record: RoleRecord
  sources: AnyRow[]
  bundles: AnyRow[]
  groups: Array<{ id: string; label: string }>
  holders: AnyRow[]
  revision: number
  permissions: Record<string, boolean>
  lang: 'vi' | 'en'
}

type Context = RecordModalContext<RoleModalData>

const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

const pageLang = (): 'vi' | 'en' =>
  typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi'

const t = (c: Context, key: string): string => c.t(`user_backend.${key}`)

const text = (form: FormData, name: string): string => String(form.get(name) ?? '').trim()

const managed = (c: Context): boolean => c.data.record.mode === 'managed'

/** Whether this reader may write the form in front of them. */
const canWrite = (c: Context): boolean =>
  c.creating ? c.data.permissions.create === true : c.data.permissions.save === true && !managed(c)

const field = (c: Context, props: Omit<FieldProps, 'id'>, writable = canWrite(c)): FieldProps => ({
  ...props,
  id: `user-role-${props.name}`,
  value: props.type === 'checkbox' ? props.value : c.draft(props.name, String(props.value ?? '')),
  options:
    props.type === 'checkbox-group'
      ? props.options?.map((option) => ({
          ...option,
          // An "all" box is worked out from the boxes it stands for. What it last
          // showed is stale the moment another "all" box or a single tick moves them.
          checked: option.name?.startsWith(CHECK_ALL)
            ? option.checked === true
            : c.draftChecked(option.name ?? `${props.name}[]`, option.value, option.checked === true),
        }))
      : props.options,
  error: c.fieldError(props.name),
  disabled: props.disabled === true || !writable,
})

/** What a role is called and what it is for. Both are the whole of a custom role. */
const identityFields = (c: Context): FieldProps[] => [
  field(c, {
    name: 'name',
    label: t(c, 'field.name'),
    value: c.data.record.name,
    required: true,
    span: 'full',
  }),
  field(c, {
    name: 'description',
    label: t(c, 'field.description'),
    type: 'textarea',
    value: c.data.record.description,
    span: 'full',
  }),
]

const createView = (c: Context): JSXChild =>
  Section({
    title: t(c, 'roles.newTitle'),
    body: RecordModalForm({
      kind: c.kind,
      fields: identityFields(c),
      command: 'create',
      actions: [Button({ label: t(c, 'action.createRole'), variant: 'primary', type: 'submit' })],
    }),
  })

/** The role, named once above every tab, with where it came from and how it is doing. */
const header = (c: Context): JSXChild =>
  c.creating
    ? ''
    : RecordSummary({
        title: c.data.record.name,
        subtitle: managed(c)
          ? t(c, 'roles.managedWithVersion').replace('{version}', String(c.data.record.templateVersion ?? 0))
          : t(c, 'roles.custom'),
        status: {
          label: c.data.record.healthy ? t(c, 'roles.healthy') : t(c, 'roles.stale'),
          tone: c.data.record.healthy ? 'positive' : 'warning',
        },
      })

/**
 * A managed role is read; a custom role is edited.
 *
 * A managed role is this deployment's own policy, so changing it here would put a
 * local edit where everyone expects the shipped decision. Copying it says what
 * actually happened: a new role, owned locally, starting from that one.
 */
const infoTab = (c: Context): JSXChild =>
  managed(c)
    ? Stack({
        gap: 'default',
        items: [
          Section({
            title: t(c, 'roles.infoTitle'),
            body: DescriptionList({
              columns: 2,
              items: [
                { id: 'name', label: t(c, 'field.name'), value: c.data.record.name },
                {
                  id: 'description',
                  label: t(c, 'field.description'),
                  value: c.data.record.description || '—',
                },
                {
                  id: 'mode',
                  label: t(c, 'field.roleMode'),
                  value: t(c, 'roles.managedWithVersion').replace(
                    '{version}',
                    String(c.data.record.templateVersion ?? 0),
                  ),
                },
                {
                  id: 'health',
                  label: t(c, 'field.state'),
                  value: Badge({
                    label: c.data.record.healthy ? t(c, 'roles.healthy') : t(c, 'roles.stale'),
                    tone: c.data.record.healthy ? 'positive' : 'warning',
                  }),
                },
              ],
            }),
          }),
          ...(c.data.permissions.clone
            ? [
                Section({
                  title: t(c, 'roles.cloneTitle'),
                  description: t(c, 'roles.cloneHint'),
                  body: RecordModalForm({
                    kind: c.kind,
                    fields: [
                      field(
                        c,
                        {
                          name: 'cloneName',
                          label: t(c, 'field.name'),
                          value: `${c.data.record.name} · ${t(c, 'roles.custom')}`,
                          required: true,
                        },
                        true,
                      ),
                      field(c, { name: 'reason', label: t(c, 'field.reason'), required: true }, true),
                    ],
                    command: 'clone',
                    actions: [
                      Button({ label: t(c, 'action.cloneRole'), variant: 'primary', type: 'submit' }),
                    ],
                  }),
                }),
              ]
            : []),
        ],
      })
    : Section({
        title: t(c, 'roles.infoTitle'),
        body: RecordModalForm({
          kind: c.kind,
          fields: identityFields(c),
          command: 'save',
          actions: canWrite(c)
            ? [Button({ label: t(c, 'action.save'), variant: 'primary', type: 'submit' })]
            : [],
        }),
      })

/** Where a managed role's authority came from, one row per grant. */
const sourcesTab = (c: Context): JSXChild =>
  c.data.sources.length
    ? DataTable<AnyRow>({
        rows: c.data.sources,
        id: (row) => String(row.fnKey),
        columns: [
          {
            key: 'work',
            label: t(c, 'preview.bundle'),
            priority: 'primary',
            cell: (row) => String(row.work),
          },
          {
            key: 'source',
            label: t(c, 'roles.sourceColumn'),
            cell: (row) =>
              row.sourceKind === 'legacy-direct'
                ? t(c, 'roles.sourceDirect')
                : `${t(c, 'roles.sourceTemplate')} · v${String(row.sourceVersion ?? 0)}`,
          },
        ],
      })
    : Notice({ tone: 'info', title: t(c, 'roles.noSources'), message: '' })

const TONE_MARK: Record<string, string> = { admin: ' ⚙', sensitive: ' ⚠' }

/**
 * Everything a custom role may hold, on one form saved once. Business groups are
 * open sections, each area is one row, and what the area hands out lies across
 * that row under a short name — the row already says which area. Opening areas
 * one at a time was one more step for every area a person wanted to touch.
 */
const permissionsTab = (c: Context): JSXChild => {
  if (!c.data.permissions.grant)
    return Notice({ tone: 'info', title: t(c, 'users.readOnlyTitle'), message: t(c, 'roles.grantReadOnly') })
  const bundles = c.data.bundles
  const ticked = (bundle: AnyRow): boolean =>
    c.draftChecked(bundleFieldName(bundle), '1', bundle.held === true)
  const held = bundles.filter(ticked)
  /** One box that stands for every bundle under a name prefix, ticked when all of them are. */
  const allOf = (prefix: string, members: AnyRow[], label: string) => ({
    name: `${CHECK_ALL}${prefix}`,
    value: '1',
    label,
    checked: members.length > 0 && members.every(ticked),
  })
  const sensitive = held.filter((bundle) => bundle.tone === 'sensitive').length
  const groups = c.data.groups
    .map((group) => ({
      ...group,
      modules: [
        ...new Set(
          bundles.filter((bundle) => bundle.group === group.id).map((bundle) => String(bundle.module)),
        ),
      ],
    }))
    .filter((group) => group.modules.length)
  return Stack({
    gap: 'default',
    items: [
      Section({
        title: t(c, 'roles.permissionsSummary'),
        body: DescriptionList({
          columns: 3,
          items: [
            {
              id: 'areas',
              label: t(c, 'roles.areasHeld'),
              value: String(new Set(held.map((bundle) => String(bundle.module))).size),
            },
            { id: 'bundles', label: t(c, 'roles.bundlesHeld'), value: String(held.length) },
            {
              id: 'sensitive',
              label: t(c, 'roles.sensitiveHeld'),
              value: Badge({
                label: sensitive ? String(sensitive) : t(c, 'roles.sensitiveNone'),
                tone: sensitive ? 'danger' : 'positive',
              }),
            },
          ],
        }),
      }),
      Section({
        title: t(c, 'roles.permissionsTitle'),
        description: t(c, 'roles.permissionsHint'),
        body: RecordModalForm({
          kind: c.kind,
          fields: [
            ...groups.map(
              (group): FieldProps => ({
                id: `user-role-group-${String(group.id)}`,
                name: `group_${String(group.id)}`,
                label: String(group.label),
                // Open from the start: folding a group is the reader's choice, never a step.
                open: true,
                fields: [
                  // The whole section at once, before its rows.
                  field(c, {
                    name: `group_all_${String(group.id)}`,
                    label: t(c, 'roles.selectGroup'),
                    type: 'checkbox-group',
                    span: 'full',
                    options: [
                      allOf(
                        `bundle:${String(group.id)}:`,
                        bundles.filter((bundle) => bundle.group === group.id),
                        t(c, 'roles.selectAll'),
                      ),
                    ],
                  }),
                  ...group.modules.map((module) => {
                    const own = bundles.filter((bundle) => String(bundle.module) === module)
                    return field(c, {
                      name: `module_${module}`,
                      label: String(own[0]?.area ?? module),
                      type: 'checkbox-group',
                      span: 'full',
                      options: [
                        // The whole row at once, leading the row it stands for.
                        allOf(`bundle:${String(group.id)}:${module}:`, own, t(c, 'roles.selectAll')),
                        ...own.map((bundle) => ({
                          name: bundleFieldName(bundle),
                          value: '1',
                          label: `${String(bundle.short)}${TONE_MARK[String(bundle.tone)] ?? ''}`,
                          checked: bundle.held === true,
                        })),
                      ],
                    })
                  }),
                ],
              }),
            ),
            field(c, { name: 'reason', label: t(c, 'field.reason'), type: 'textarea', span: 'full' }),
          ],
          command: 'setBundles',
          actions: [Button({ label: t(c, 'action.savePermissions'), variant: 'primary', type: 'submit' })],
        }),
      }),
    ],
  })
}

// Group and module lead the name so an "all" box selects a section or a row by
// prefix; the colon ends each part, so `stock:` never reaches `stock_staff_channel:`.
const bundleFieldName = (bundle: AnyRow): string =>
  `bundle:${String(bundle.group)}:${String(bundle.module)}:${String(bundle.key)}`

/** Who holds this role, wherever they hold it. */
const holdersTab = (c: Context): JSXChild =>
  c.data.holders.length
    ? DataTable<AnyRow>({
        rows: c.data.holders,
        id: (row) => String(row.id),
        columns: [
          {
            key: 'name',
            label: t(c, 'users.title'),
            priority: 'primary',
            cell: (row) => `${String(row.name)} · ${String(row.login)}`,
          },
          {
            key: 'state',
            label: t(c, 'field.state'),
            cell: (row) =>
              Badge({
                label: row.active ? t(c, 'state.active') : t(c, 'state.archived'),
                tone: row.active ? 'positive' : 'neutral',
              }),
          },
        ],
      })
    : Notice({ tone: 'info', title: t(c, 'roles.noHolders'), message: '' })

export const roleModalDefinition: RecordModalDefinition<RoleModalData> = {
  kind: 'user.role',
  size: 'large',
  context: {
    fn: 'user.roleModalContext',
    input: (id, creating) => (creating ? { locale: pageLang() } : { id, locale: pageLang() }),
  },
  title: (c) => (c.creating ? t(c, 'action.createRole') : c.data.record.name),
  description: (c) => (c.creating ? t(c, 'roles.createSubtitle') : c.data.record.description || null),
  header,
  body: (c) => (c.creating ? createView(c) : ''),
  tabs: [
    { id: 'info', label: (c) => t(c, 'tab.roleInfo'), visible: (c) => !c.creating, view: infoTab },
    {
      id: 'sources',
      label: (c) => t(c, 'tab.roleSources'),
      visible: (c) => !c.creating && managed(c),
      view: sourcesTab,
    },
    {
      id: 'permissions',
      label: (c) => t(c, 'tab.rolePermissions'),
      visible: (c) => !c.creating && !managed(c),
      view: permissionsTab,
    },
    {
      id: 'users',
      label: (c) => `${t(c, 'tab.roleUsers')} ${String(c.data.holders.length)}`,
      visible: (c) => !c.creating,
      view: holdersTab,
    },
  ],
  commands: {
    create: {
      fn: 'user.saveRole',
      input: (form) => ({
        id: uuid(),
        name: text(form, 'name'),
        description: text(form, 'description') || null,
      }),
      after: 'open',
      openTab: 'info',
      created: (value) => {
        const row = (value ?? {}) as { id?: unknown }
        return typeof row.id === 'string' ? row.id : null
      },
    },
    save: {
      fn: 'user.saveRole',
      input: (form, c) => ({
        id: c.id,
        name: text(form, 'name'),
        description: text(form, 'description') || null,
      }),
      after: 'reload',
    },
    clone: {
      fn: 'user.cloneManagedRole',
      input: (form, c) => ({
        id: uuid(),
        sourceRoleId: c.id,
        name: text(form, 'cloneName'),
        reason: text(form, 'reason'),
        expectedAuthorizationRevision: c.data.revision,
        idempotencyKey: uuid(),
      }),
      // A copy is a new role; the modal moves to it, as a create does.
      after: 'open',
      openTab: 'info',
      created: (value) => {
        const row = (value ?? {}) as { id?: unknown }
        return typeof row.id === 'string' ? row.id : null
      },
    },
    setBundles: {
      fn: 'user.setRoleBundles',
      input: (form, c) => ({
        roleId: c.id,
        bundleKeys: c.data.bundles
          .filter((bundle) => ['1', 'on', 'true'].includes(String(form.get(bundleFieldName(bundle)) ?? '')))
          .map((bundle) => String(bundle.key)),
        reason: text(form, 'reason') || t(c, 'roles.permissionsTitle'),
        expectedAuthorizationRevision: c.data.revision,
        idempotencyKey: uuid(),
      }),
      after: 'reload',
    },
  },
}

export const roleModal = createRecordModal(roleModalDefinition)
