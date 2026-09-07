import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  button,
  dataTable,
  emptyState,
  FormCluster,
  ListPage,
  linkButton,
  modalForm,
  modalWorkspace,
  RecordForm,
  RecordPage,
  Section,
  shell,
  Surface,
  Tabs,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'

type AnyRow = Record<string, unknown>
const empty = (_: Translator) => emptyState(_('crm_backend.empty.title'), _('crm_backend.empty.hint'))

export const CONFIGURATION_TABS = ['teams', 'stages', 'tags', 'assignmentRules', 'scoreRules'] as const
export type ConfigurationTab = (typeof CONFIGURATION_TABS)[number]
export type ConfigurationStatus = 'active' | 'archived' | 'all'

const rowsOf = (value: unknown): AnyRow[] => (Array.isArray(value) ? (value as AnyRow[]) : [])
const nameOf = (row: AnyRow | undefined, fallback = ''): string =>
  String(row?.name ?? row?.code ?? row?.id ?? fallback)

const configurationHref = (tab: ConfigurationTab, locale: string, status?: ConfigurationStatus): string =>
  localized(
    `/admin/crm/configuration?tab=${tab}${status && status !== 'active' ? `&status=${status}` : ''}`,
    locale,
  )

const kindsLabel = (_: Translator, row: AnyRow): string =>
  rowsOf(row.allowedKinds)
    .map(String)
    .map((kind) => _(`crm.kind.${kind}`))
    .join(', ')

const activeBadge = (_: Translator, row: AnyRow): TemplateResult =>
  row.active === false
    ? badge(_('crm_backend.state.archived'), 'neutral', 'archived')
    : badge(_('crm_backend.state.active'), 'positive', 'active')

const terminalBadge = (_: Translator, value: unknown): TemplateResult => {
  const state = String(value ?? 'open')
  return badge(
    _(`crm.terminal.${state}`),
    state === 'won' ? 'positive' : state === 'lost' ? 'danger' : 'neutral',
  )
}

/**
 * Configuration, editable.
 *
 * Every tab used to render a create-only form and a read-only table: the form
 * minted a fresh id on each submit and the table offered no way back into a
 * row, so a team could be created and then never renamed, retired or even
 * looked at again. Each row now links to itself for editing and carries the
 * toggle that archives it.
 */
export const configurationScreen = (
  _: Translator,
  frame: Frame,
  options: {
    tab: ConfigurationTab
    rows: AnyRow[]
    fields: FormField[]
    editing: AnyRow | null
    creating?: boolean
    errors?: string[]
    locale?: string
    status?: ConfigurationStatus
    teams?: AnyRow[]
    users?: AnyRow[]
  },
): TemplateResult => {
  const locale = options.locale ?? ''
  const status = options.status ?? 'active'
  const endpoint = configurationHref(options.tab, locale, status)
  const label = (row: AnyRow) => nameOf(row)
  const createHref =
    options.tab === 'teams' ? localized('/admin/crm/configuration/teams/new', locale) : `${endpoint}&create=1`
  const editHref = options.editing
    ? `${endpoint}&edit=${encodeURIComponent(String(options.editing.id))}`
    : createHref
  const teamNames = new Map((options.teams ?? []).map((row) => [String(row.id), nameOf(row)]))
  const userNames = new Map((options.users ?? []).map((row) => [String(row.id), nameOf(row)]))
  const rowHref = (row: AnyRow): string =>
    options.tab === 'teams'
      ? localized(`/admin/crm/configuration/teams/${encodeURIComponent(String(row.id))}`, locale)
      : `${endpoint}&edit=${encodeURIComponent(String(row.id))}`
  const nameColumn = {
    key: 'name',
    label: _('crm_backend.field.name'),
    priority: 'primary' as const,
    cell: (row: AnyRow) => label(row),
  }
  const activeColumn = {
    key: 'active',
    label: _('crm_backend.field.active'),
    kind: 'status' as const,
    cell: (row: AnyRow) => activeBadge(_, row),
  }
  const columns = (() => {
    if (options.tab === 'teams')
      return [
        nameColumn,
        {
          key: 'leader',
          label: _('crm_backend.field.teamLeader'),
          cell: (row: AnyRow) =>
            userNames.get(String(row.leaderUserId ?? '')) ?? _('crm_backend.value.unset'),
        },
        {
          key: 'members',
          label: _('crm_backend.configuration.membersInTeam'),
          cell: (row: AnyRow) => {
            const members = rowsOf(row.members)
            return _('crm_backend.configuration.membersCount', {
              active: String(members.filter((member) => member.active !== false).length),
              total: String(members.length),
            })
          },
        },
        {
          key: 'assignmentMode',
          label: _('crm_backend.field.assignmentMode'),
          cell: (row: AnyRow) => _(`crm_backend.assignmentMode.${String(row.assignmentMode ?? 'manual')}`),
        },
        activeColumn,
      ]
    if (options.tab === 'stages')
      return [
        nameColumn,
        {
          key: 'sequence',
          label: _('crm_backend.field.sequence'),
          kind: 'number' as const,
          cell: (row: AnyRow) => String(row.sequence ?? 0),
        },
        {
          key: 'kinds',
          label: _('crm_backend.field.allowedKinds'),
          cell: (row: AnyRow) => kindsLabel(_, row),
        },
        {
          key: 'team',
          label: _('crm_backend.field.team'),
          cell: (row: AnyRow) => teamNames.get(String(row.teamId ?? '')) ?? _('crm_backend.value.allTeams'),
        },
        {
          key: 'terminal',
          label: _('crm_backend.field.terminalState'),
          kind: 'status' as const,
          cell: (row: AnyRow) => terminalBadge(_, row.terminalState),
        },
        {
          key: 'fold',
          label: _('crm_backend.field.fold'),
          cell: (row: AnyRow) => (row.fold ? _('crm_backend.value.yes') : _('crm_backend.value.no')),
        },
        activeColumn,
      ]
    if (options.tab === 'tags') return [nameColumn, activeColumn]
    if (options.tab === 'assignmentRules')
      return [
        nameColumn,
        {
          key: 'priority',
          label: _('crm_backend.field.priority'),
          kind: 'number' as const,
          cell: (row: AnyRow) => String(row.priority ?? 0),
        },
        {
          key: 'condition',
          label: _('crm_backend.configuration.condition'),
          cell: (row: AnyRow) =>
            [
              kindsLabel(_, row),
              row.utmSource
                ? `${_('crm_backend.field.utmSource')}: ${String(row.utmSource)}`
                : _('crm_backend.value.allSources'),
              row.minimumScore == null
                ? null
                : `${_('crm_backend.field.minimumScore')} ≥ ${String(row.minimumScore)}`,
            ]
              .filter(Boolean)
              .join(' · '),
        },
        {
          key: 'team',
          label: _('crm_backend.field.team'),
          cell: (row: AnyRow) => teamNames.get(String(row.teamId ?? '')) ?? _('crm_backend.value.unset'),
        },
        {
          key: 'assignee',
          label: _('crm_backend.field.assignee'),
          cell: (row: AnyRow) =>
            userNames.get(String(row.assigneeUserId ?? '')) ?? _('crm_backend.value.teamMode'),
        },
        activeColumn,
      ]
    return [
      nameColumn,
      {
        key: 'condition',
        label: _('crm_backend.configuration.condition'),
        cell: (row: AnyRow) =>
          `${_(`crm_backend.scoreField.${String(row.field ?? '')}`)} · ${_(`crm_backend.operator.${String(row.operator ?? 'eq')}`)}${row.operator === 'present' ? '' : ` ${String(row.value ?? '')}`}`,
      },
      {
        key: 'points',
        label: _('crm_backend.field.points'),
        kind: 'number' as const,
        cell: (row: AnyRow) => `${Number(row.points ?? 0) >= 0 ? '+' : ''}${String(row.points ?? 0)}`,
      },
      {
        key: 'sequence',
        label: _('crm_backend.field.sequence'),
        kind: 'number' as const,
        cell: (row: AnyRow) => String(row.sequence ?? 0),
      },
      activeColumn,
    ]
  })()
  const workspace = shell(
    _,
    _('crm_backend.configuration.title'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('crm_backend.configuration.title')}
      description={_('crm_backend.configuration.subtitle')}
      actions={linkButton({
        href: createHref,
        label: _('crm_backend.configuration.create'),
        variant: 'primary',
      })}
      controls={
        <>
          <Tabs
            label={_('crm_backend.configuration.title')}
            items={CONFIGURATION_TABS.map((id) => ({
              id,
              label: _(`crm_backend.configuration.${id}`),
              href: configurationHref(id, locale),
              active: options.tab === id,
            }))}
          />
          <nav data-ui="configuration-status" aria-label={_('crm_backend.configuration.statusFilter')}>
            {(['active', 'archived', 'all'] as const).map((value) =>
              linkButton({
                href: configurationHref(options.tab, locale, value),
                label: _(`crm_backend.configuration.status.${value}`),
                variant: status === value ? 'secondary' : 'tertiary',
                size: 'compact',
              }),
            )}
          </nav>
        </>
      }
      status={`${_(`crm_backend.configuration.${options.tab}`)} · ${options.rows.length}`}
      body={
        options.rows.length
          ? dataTable(_, {
              rows: options.rows,
              id: (row) => String(row.id),
              columns,
              rowHref,
              rowLink: false,
              responsive: 'stack',
            })
          : empty(_)
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
  if (options.tab === 'teams' || (!options.editing && !options.creating)) return workspace
  return modalWorkspace(
    workspace,
    modalForm({
      id: `crm-configuration-${options.tab}`,
      title: options.editing
        ? `${_('crm_backend.configuration.edit')} · ${label(options.editing)}`
        : _('crm_backend.configuration.create'),
      description: _(`crm_backend.configuration.${options.tab}`),
      closeHref: endpoint,
      closeLabel: _('crm_backend.action.cancelEdit'),
      presentation: 'dialog',
      size: options.fields.length > 4 ? 'large' : 'default',
      unsavedPrompt: _('crm_backend.configuration.unsaved'),
      form: {
        scope: `crm-configuration-${options.tab}`,
        action: editHref,
        hidden: options.editing
          ? {
              id: String(options.editing.id),
              ...(options.editing.version != null
                ? { expectedVersion: String(options.editing.version) }
                : {}),
            }
          : undefined,
        fields: options.fields,
        errors: options.errors,
        submit: options.editing ? _('crm_backend.action.save') : _('crm_backend.configuration.create'),
        submitVariant: 'primary',
        cancelHref: endpoint,
        cancelLabel: _('crm_backend.action.cancelEdit'),
      },
    }),
  )
}

/** A team is a durable subject, so its information and member management live on a full page. */
export const teamConfigurationScreen = (
  _: Translator,
  frame: Frame,
  options: {
    team: AnyRow
    fields: FormField[]
    members: AnyRow[]
    action: string
    cancelHref: string
    errors?: string[]
    creating?: boolean
    memberCreateHref?: string
    memberEditHref?: (row: AnyRow) => string
    memberEditing?: AnyRow | null
    memberCreating?: boolean
    memberFields?: FormField[]
    memberAction?: string
  },
): TemplateResult => {
  const formId = 'crm-team-form'
  const title = options.creating ? _('crm_backend.configuration.team.create') : nameOf(options.team)
  const workspace = shell(
    _,
    title,
    <RecordPage
      variant="operational"
      frame={frame}
      scope="crm-team-configuration"
      title={title}
      description={_('crm_backend.configuration.team.subtitle')}
      status={options.creating ? undefined : activeBadge(_, options.team)}
      actions={
        <FormCluster
          label={_('crm_backend.configuration.team.actions')}
          forms={[
            button({ label: _('crm_backend.action.save'), type: 'submit', form: formId, variant: 'primary' }),
            linkButton({
              label: _('crm_backend.action.cancel'),
              href: options.cancelHref,
              variant: 'secondary',
            }),
          ]}
        />
      }
      body={
        <>
          <Section
            title={_('crm_backend.configuration.team.identity')}
            body={
              <Surface
                body={
                  <RecordForm
                    id={formId}
                    scope="crm-team"
                    action={options.action}
                    hidden={
                      options.team.id
                        ? {
                            id: String(options.team.id),
                            ...(options.team.version != null
                              ? { expectedVersion: String(options.team.version) }
                              : {}),
                          }
                        : undefined
                    }
                    fields={options.fields}
                    errors={options.errors}
                    submit={_('crm_backend.action.save')}
                    submitVariant="primary"
                    submitPlacement="external"
                  />
                }
              />
            }
          />
          <Section
            title={_('crm_backend.configuration.team.members')}
            description={_('crm_backend.configuration.team.membersHint')}
            actions={
              options.memberCreateHref
                ? linkButton({
                    label: _('crm_backend.configuration.team.addMember'),
                    href: options.memberCreateHref,
                    variant: 'secondary',
                  })
                : undefined
            }
            body={
              options.members.length
                ? dataTable(_, {
                    rows: options.members,
                    id: (row) => String(row.id),
                    rowHref: options.memberEditHref,
                    rowLink: false,
                    responsive: 'stack',
                    columns: [
                      {
                        key: 'name',
                        label: _('crm_backend.configuration.team.member'),
                        priority: 'primary',
                        cell: (row) => String(row.userName ?? row.userId ?? ''),
                      },
                      {
                        key: 'capacity',
                        label: _('crm_backend.field.capacity'),
                        kind: 'number',
                        cell: (row) => String(row.capacity ?? 1),
                      },
                      {
                        key: 'sequence',
                        label: _('crm_backend.field.sequence'),
                        kind: 'number',
                        cell: (row) => String(row.sequence ?? 10),
                      },
                      {
                        key: 'assigned',
                        label: _('crm_backend.configuration.team.assigned'),
                        kind: 'number',
                        cell: (row) => String(row.assignedCount ?? 0),
                      },
                      {
                        key: 'active',
                        label: _('crm_backend.field.active'),
                        kind: 'status',
                        cell: (row) => activeBadge(_, row),
                      },
                    ],
                  })
                : emptyState(
                    _('crm_backend.configuration.team.membersEmpty'),
                    options.creating
                      ? _('crm_backend.configuration.team.saveBeforeMembers')
                      : _('crm_backend.configuration.team.membersEmptyHint'),
                  )
            }
          />
        </>
      }
    />,
    { ...frame, chrome: null, topbar: false, titled: false },
  )
  if ((!options.memberEditing && !options.memberCreating) || !options.memberFields || !options.memberAction)
    return workspace
  return modalWorkspace(
    workspace,
    modalForm({
      id: 'crm-team-member',
      title: options.memberEditing
        ? `${_('crm_backend.configuration.edit')} · ${String(options.memberEditing.userName ?? options.memberEditing.userId ?? '')}`
        : _('crm_backend.configuration.team.addMember'),
      description: _('crm_backend.configuration.team.membersHint'),
      closeHref: options.action,
      closeLabel: _('crm_backend.action.cancelEdit'),
      presentation: 'dialog',
      unsavedPrompt: _('crm_backend.configuration.unsaved'),
      form: {
        scope: 'crm-team-member',
        action: options.memberAction,
        hidden: options.memberEditing ? { id: String(options.memberEditing.id) } : undefined,
        fields: options.memberFields,
        errors: options.errors,
        submit: options.memberEditing
          ? _('crm_backend.action.save')
          : _('crm_backend.configuration.team.addMember'),
        submitVariant: 'primary',
        cancelHref: options.action,
        cancelLabel: _('crm_backend.action.cancelEdit'),
      },
    }),
  )
}
