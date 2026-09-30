// The access-rules collection: which roles a person gets from who they are.
//
// Assigning roles one person at a time is how people end up with half of what a
// screen needs. A rule says it once — everyone in this identity-provider group, or
// this department, holds these roles here — and every matching person gets the
// same set, from their first sign-in. The collection lists the rules and how many
// people each one currently covers; a rule opens in its record modal.
//
// The production route reads persisted policies; Atlas supplies isolated fixtures.

import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  collectionActions,
  collectionControls,
  collectionTable,
  emptyState,
  inline,
  LinkButton,
  ListPage,
  prepareCollectionTable,
  shell,
} from '../../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../../ui/index.ts'

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

export type AccessPoliciesListScreenOptions = {
  rows: readonly AccessPolicyRow[]
  clearHref?: string | null
  total: number
  /** Null when the viewer may not write rules: the header then offers no create action. */
  createHref: string | null
  table?: Partial<DataTable<AccessPolicyRow>>
}

export const accessPolicyListColumns = (_: Translator): Array<Column<AccessPolicyRow>> => [
  {
    key: 'name',
    label: _('user_backend.field.name'),
    priority: 'primary',
    width: 'wide',
    cell: (row) => row.name,
  },
  {
    key: 'match',
    label: _('user_backend.policy.matchColumn'),
    // What a person must be to fall under the rule, with the value as written in
    // the source it is read from.
    cell: (row) => inline([_(`user_backend.policy.match.${row.match.kind}`), row.match.value]),
  },
  {
    key: 'grants',
    label: _('user_backend.policy.grantsColumn'),
    cell: (row) => row.grants.map((grant) => `${grant.roleName} · ${grant.scope}`).join(', ') || '—',
  },
  {
    key: 'members',
    label: _('user_backend.policy.membersColumn'),
    cell: (row) => String(row.memberCount),
  },
  {
    key: 'state',
    label: _('user_backend.field.state'),
    kind: 'status',
    cell: (row) =>
      row.active
        ? badge(_('user_backend.state.active'), 'positive', 'active')
        : badge(_('user_backend.policy.paused'), 'neutral', 'paused'),
  },
]

export const accessPoliciesScreen = (
  _: Translator,
  frame: Frame,
  options: AccessPoliciesListScreenOptions,
): TemplateResult => {
  const prepared = prepareCollectionTable(
    _,
    frame,
    {
      rows: options.rows,
      id: (row) => row.id,
      rowHref: (row) => row.detailHref,
      columns: accessPolicyListColumns(_),
      ...options.table,
    },
    { paginate: !options.table?.groups },
  )
  frame = prepared.frame
  return shell(
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
        options.rows.length || options.table?.groups?.length
          ? collectionTable(_, prepared.table)
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
}
