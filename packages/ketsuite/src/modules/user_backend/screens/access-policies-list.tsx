// The access-rules collection: which roles a person gets from who they are.
//
// Assigning roles one person at a time is how people end up with half of what a
// screen needs. A rule says it once — everyone in this department, or with this
// job title, holds these roles here — and every matching person gets the
// same set, from their first sign-in. The collection lists the rules and how many
// people each one currently covers; a rule opens in its record modal.
//
// The production route reads persisted policies; Atlas supplies isolated fixtures.

import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { KetTableColumn, KetTableConfig, KetTableRow } from '@ketvietlab/design-system'
import {
  collectionActions,
  collectionControls,
  collectionGridLabels,
  emptyState,
  LinkButton,
  ListPage,
  prepareCollectionGrid,
  shell,
} from '../../../ui/index.ts'
import type { Frame, TableGroup } from '../../../ui/index.ts'

export type AccessPolicyMatchKind = 'idpGroup' | 'department' | 'jobTitle'

export type AccessPolicyRow = {
  id: string
  name: string
  match: { kind: AccessPolicyMatchKind; value: string }
  /** Each role the rule gives, with where it applies, as the reader reads it. */
  grants: Array<{ roleName: string; scope: string }>
  memberCount: number
  active: boolean
  detailHref: string
}

export type AccessPoliciesGridOptions = {
  rows: readonly AccessPolicyRow[]
  groups?: readonly TableGroup<AccessPolicyRow>[]
  /** A `{id}` href that opens a rule in the record modal. */
  rowHrefTemplate: string
}

export type AccessPoliciesListScreenOptions = {
  /** The KetTable island the caller rendered from `accessPoliciesGrid`. */
  grid: JSXChild
  /** True when nothing matched, so the screen says why instead of drawing an empty grid. */
  empty: boolean
  clearHref?: string | null
  total: number
  /** Null when the viewer may not write rules: the header then offers no create action. */
  createHref: string | null
}

export const accessPolicyGridColumns = (_: Translator): KetTableColumn[] => [
  {
    key: 'name',
    label: _('user_backend.field.name'),
    priority: 'primary',
    width: 'wide',
    format: { kind: 'text', field: 'name' },
  },
  // What a person must be to fall under the rule, with the value as written in
  // the source it is read from.
  { key: 'match', label: _('user_backend.policy.matchColumn'), format: { kind: 'text', field: 'match' } },
  { key: 'grants', label: _('user_backend.policy.grantsColumn'), format: { kind: 'text', field: 'roles' } },
  // A rule gives every role at one place, so the place is said once.
  { key: 'scope', label: _('user_backend.field.scope'), format: { kind: 'text', field: 'scope' } },
  {
    key: 'members',
    label: _('user_backend.policy.membersColumn'),
    align: 'end',
    format: { kind: 'number', field: 'memberCount' },
  },
  {
    key: 'state',
    label: _('user_backend.field.state'),
    format: {
      kind: 'status',
      field: 'state',
      tones: {
        active: { label: _('user_backend.state.active'), tone: 'positive' },
        paused: { label: _('user_backend.policy.paused'), tone: 'neutral' },
      },
    },
  },
]

/** The JSON row the island draws: every value already in the reader's words. */
export const accessPolicyGridRow =
  (_: Translator) =>
  (row: AccessPolicyRow): KetTableRow => ({
    id: row.id,
    name: row.name,
    match: `${_(`user_backend.policy.match.${row.match.kind}`)}: ${row.match.value}`,
    roles: row.grants.map((grant) => grant.roleName).join(', ') || '—',
    scope: [...new Set(row.grants.map((grant) => grant.scope))].join(', ') || '—',
    memberCount: row.memberCount,
    state: row.active ? 'active' : 'paused',
  })

/** The toolbar state and island config for the access-rules collection. */
export const accessPoliciesGrid = (
  _: Translator,
  frame: Frame,
  options: AccessPoliciesGridOptions,
): { frame: Frame; config: KetTableConfig } =>
  prepareCollectionGrid(
    _,
    frame,
    {
      columns: accessPolicyGridColumns(_),
      rows: options.rows,
      ...(options.groups ? { groups: options.groups } : {}),
      id: (row) => row.id,
      view: accessPolicyGridRow(_),
      rowHrefTemplate: options.rowHrefTemplate,
      labels: collectionGridLabels(_, _('user_backend.policy.empty'), _('user_backend.policy.emptyHint')),
    },
    { paginate: !options.groups?.length },
  )

export const accessPoliciesScreen = (
  _: Translator,
  frame: Frame,
  options: AccessPoliciesListScreenOptions,
): TemplateResult =>
  shell(
    _,
    _('user_backend.policy.title'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('user_backend.policy.title')}
      headerActions={
        options.createHref ? (
          <LinkButton
            label={_('user_backend.action.createPolicy')}
            href={options.createHref}
            variant="primary"
          />
        ) : undefined
      }
      actions={collectionActions(_, frame)}
      controls={collectionControls(_, _('user_backend.policy.title'), frame)}
      status={`${_('user_backend.policy.title')}: ${String(options.total)}`}
      body={
        !options.empty
          ? options.grid
          : options.clearHref
            ? emptyState(_('user_backend.policy.noMatch'), _('user_backend.users.noMatchHint'), {
                actions: (
                  <LinkButton
                    label={_('user_backend.action.clearFilters')}
                    href={options.clearHref}
                    variant="secondary"
                  />
                ),
              })
            : emptyState(_('user_backend.policy.empty'), _('user_backend.policy.emptyHint'))
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
