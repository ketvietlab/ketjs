import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  designSystem,
  emptyState,
  ListPage,
  linkButton,
  pageTrailFromFrame,
  recordModalCreateHref,
  recordModalHref,
  shell,
  Tabs,
} from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'

type AnyRow = Record<string, unknown>

/**
 * The configuration catalogues. They are named by `?section=`: `record` and `tab`
 * belong to the record modal, which would otherwise overwrite the section on
 * every open and close.
 */
export const CONFIGURATION_SECTIONS = ['teams', 'stages', 'tags', 'assignmentRules', 'scoreRules'] as const
export type ConfigurationSection = (typeof CONFIGURATION_SECTIONS)[number]
export const CONFIGURATION_STATUSES = ['active', 'archived', 'all'] as const
export type ConfigurationStatus = (typeof CONFIGURATION_STATUSES)[number]

/** The record-modal kind each catalogue opens its rows in. */
export const CONFIGURATION_RECORD_KINDS: Readonly<Record<ConfigurationSection, string>> = {
  teams: 'crm.team',
  stages: 'crm.stage',
  tags: 'crm.tag',
  assignmentRules: 'crm.assignmentRule',
  scoreRules: 'crm.scoreRule',
}

/** The function whose permission lets a viewer create or change a catalogue's records. */
export const CONFIGURATION_SAVE_FUNCTIONS: Readonly<Record<ConfigurationSection, string>> = {
  teams: 'crm.team.save',
  stages: 'crm.stage.save',
  tags: 'crm.tag.save',
  assignmentRules: 'crm.assignmentRule.save',
  scoreRules: 'crm.scoreRule.save',
}

const rowsOf = (value: unknown): AnyRow[] => (Array.isArray(value) ? (value as AnyRow[]) : [])
const nameOf = (row: AnyRow | undefined, fallback = ''): string =>
  String(row?.name ?? row?.code ?? row?.id ?? fallback)

/** A catalogue, in a status, keeping the page's language. */
export const configurationHref = (
  section: ConfigurationSection,
  locale: string,
  status: ConfigurationStatus = 'active',
): string =>
  localized(
    `/admin/crm/configuration?section=${section}${status === 'active' ? '' : `&status=${status}`}`,
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

const columnsFor = (
  _: Translator,
  section: ConfigurationSection,
  teamNames: Map<string, string>,
  userNames: Map<string, string>,
) => {
  const nameColumn = {
    key: 'name',
    label: _('crm_backend.field.configName'),
    priority: 'primary' as const,
    cell: (row: AnyRow) => nameOf(row),
  }
  const activeColumn = {
    key: 'active',
    label: _('crm_backend.field.active'),
    kind: 'status' as const,
    cell: (row: AnyRow) => activeBadge(_, row),
  }
  if (section === 'teams')
    return [
      nameColumn,
      {
        key: 'leader',
        label: _('crm_backend.field.teamLeader'),
        cell: (row: AnyRow) => userNames.get(String(row.leaderUserId ?? '')) ?? _('crm_backend.value.unset'),
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
  if (section === 'stages')
    return [
      nameColumn,
      {
        key: 'sequence',
        label: _('crm_backend.field.sequence'),
        kind: 'number' as const,
        cell: (row: AnyRow) => String(row.sequence ?? 0),
      },
      { key: 'kinds', label: _('crm_backend.field.allowedKinds'), cell: (row: AnyRow) => kindsLabel(_, row) },
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
  if (section === 'tags') return [nameColumn, activeColumn]
  if (section === 'assignmentRules')
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
}

/**
 * CRM configuration: five catalogues on one collection page.
 *
 * Every row and the create action open the record in a client-side modal over
 * the list (record-modal contract); there is no record page and no server modal.
 * The status filter is a visible control and survives switching catalogues.
 */
export const configurationScreen = (
  _: Translator,
  frame: Frame,
  options: {
    section: ConfigurationSection
    status: ConfigurationStatus
    rows: AnyRow[]
    locale?: string
    teams?: AnyRow[]
    users?: AnyRow[]
    /** The viewer may call the catalogue's save function; without it there is no create action. */
    canCreate?: boolean
  },
): TemplateResult => {
  const locale = options.locale ?? ''
  const { section, status } = options
  const listHref = configurationHref(section, locale, status)
  const kind = CONFIGURATION_RECORD_KINDS[section]
  const teamNames = new Map((options.teams ?? []).map((row) => [String(row.id), nameOf(row)]))
  const userNames = new Map((options.users ?? []).map((row) => [String(row.id), nameOf(row)]))
  const empty =
    status === 'active'
      ? emptyState(_('crm_backend.configuration.emptyTitle'), _('crm_backend.configuration.emptyHint'))
      : emptyState(
          _('crm_backend.configuration.emptyFilteredTitle'),
          _('crm_backend.configuration.emptyFilteredHint'),
        )
  return shell(
    _,
    _('crm_backend.configuration.title'),
    <ListPage
      variant="operational"
      frame={frame}
      context={pageTrailFromFrame(_('crm_backend.configuration.title'), frame)}
      title={_('crm_backend.configuration.title')}
      description={_('crm_backend.configuration.subtitle')}
      actions={
        options.canCreate
          ? linkButton({
              href: recordModalCreateHref(listHref, { kind }),
              label: _('crm_backend.configuration.create'),
              variant: 'primary',
            })
          : undefined
      }
      controls={
        <>
          <Tabs
            label={_('crm_backend.configuration.title')}
            items={CONFIGURATION_SECTIONS.map((id) => ({
              id,
              label: _(`crm_backend.configuration.${id}`),
              href: configurationHref(id, locale, status),
              active: section === id,
            }))}
          />
          {designSystem.SavedViews({
            label: _('crm_backend.configuration.statusFilter'),
            views: CONFIGURATION_STATUSES.map((id) => ({
              id,
              label: _(`crm_backend.configuration.status.${id}`),
              href: configurationHref(section, locale, id),
              active: status === id,
            })),
          })}
        </>
      }
      status={`${_(`crm_backend.configuration.${section}`)} · ${options.rows.length}`}
      body={
        options.rows.length
          ? dataTable(_, {
              rows: options.rows,
              id: (row) => String(row.id),
              columns: columnsFor(_, section, teamNames, userNames),
              rowHref: (row) => recordModalHref(listHref, { kind, id: String(row.id) }),
              responsive: 'stack',
            })
          : empty
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
