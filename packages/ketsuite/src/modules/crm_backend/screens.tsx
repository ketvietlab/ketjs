import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  Framed,
  linkButton,
  RecordForm,
  Section,
  stack,
  Surface,
  Tabs,
} from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'

type AnyRow = Record<string, unknown>
const empty = (_: Translator) => emptyState(_('crm_backend.empty.title'), _('crm_backend.empty.hint'))
const when = (value: unknown): string => {
  const raw = String(value ?? '')
  if (!raw) return '—'
  return raw.length > 10 ? raw.slice(0, 16).replace('T', ' ') : raw
}
/**
 * The leaderboard.
 *
 * `gamification.refresh` and `gamification.list` shipped with the module and
 * were reachable from no menu, no route and no screen; this is the page that
 * makes them a feature rather than two orphaned functions.
 */
export const leaderboardScreen = (
  _: Translator,
  frame: Frame,
  profiles: AnyRow[],
  errors: string[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={_('crm_backend.leaderboard.title')}
    frame={frame}
    body={stack([
      <Surface
        tone="subtle"
        padding="compact"
        body={
          <RecordForm
            action="/admin/crm/leaderboard"
            layout="inline"
            hidden={{ action: 'refresh' }}
            fields={[]}
            errors={errors}
            submit={_('crm_backend.leaderboard.refresh')}
            submitVariant="secondary"
          />
        }
      />,
      profiles.length
        ? dataTable(_, {
            rows: profiles,
            id: (item) => String(item.id),
            columns: [
              {
                key: 'user',
                label: _('crm_backend.field.assignee'),
                priority: 'primary',
                cell: (item) => String(item.userName ?? item.userId),
              },
              {
                key: 'points',
                label: _('crm_backend.leaderboard.points'),
                cell: (item) => String(item.points ?? 0),
              },
              { key: 'won', label: _('crm.terminal.won'), cell: (item) => String(item.won ?? 0) },
              { key: 'lost', label: _('crm.terminal.lost'), cell: (item) => String(item.lost ?? 0) },
              {
                key: 'assigned',
                label: _('crm_backend.leaderboard.assigned'),
                cell: (item) => String(item.assigned ?? 0),
              },
              {
                key: 'activities',
                label: _('crm_backend.leaderboard.activities'),
                cell: (item) => String(item.activitiesDone ?? 0),
              },
              {
                key: 'refreshed',
                label: _('crm_backend.timeline.at'),
                cell: (item) => when(item.refreshedAt),
              },
            ],
          })
        : emptyState(_('crm_backend.leaderboard.emptyTitle'), _('crm_backend.leaderboard.emptyHint')),
    ])}
  />
)

export const CONFIGURATION_TABS = [
  'teams',
  'members',
  'stages',
  'tags',
  'assignmentRules',
  'scoreRules',
] as const
export type ConfigurationTab = (typeof CONFIGURATION_TABS)[number]

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
    errors?: string[]
    label?: (row: AnyRow) => string
    detail?: (row: AnyRow) => string
  },
): TemplateResult => {
  const endpoint = `/admin/crm/configuration?tab=${options.tab}`
  const label = options.label ?? ((row: AnyRow) => String(row.name ?? row.code ?? row.id))
  return (
    <Framed
      translator={_}
      title={_('crm_backend.configuration.title')}
      frame={frame}
      body={stack([
        <Tabs
          label={_('crm_backend.configuration.title')}
          items={CONFIGURATION_TABS.map((id) => ({
            id,
            label: _(`crm_backend.configuration.${id}`),
            href: `/admin/crm/configuration?tab=${id}`,
            active: options.tab === id,
          }))}
        />,
        <Section
          title={
            options.editing
              ? `${_('crm_backend.configuration.edit')} · ${label(options.editing)}`
              : _('crm_backend.configuration.create')
          }
          body={
            <Surface
              body={
                options.editing ? (
                  <RecordForm
                    action={endpoint}
                    hidden={{
                      id: String(options.editing.id),
                      ...(options.editing.version != null
                        ? { expectedVersion: String(options.editing.version) }
                        : {}),
                    }}
                    fields={options.fields}
                    errors={options.errors}
                    submit={_('crm_backend.action.save')}
                    submitVariant="primary"
                    cancelHref={endpoint}
                    cancelLabel={_('crm_backend.action.cancelEdit')}
                  />
                ) : (
                  <RecordForm
                    action={endpoint}
                    fields={options.fields}
                    errors={options.errors}
                    submit={_('crm_backend.configuration.create')}
                    submitVariant="primary"
                  />
                )
              }
            />
          }
        />,
        options.rows.length
          ? dataTable(_, {
              rows: options.rows,
              id: (row) => String(row.id),
              columns: [
                {
                  key: 'name',
                  label: _('crm_backend.field.name'),
                  priority: 'primary',
                  cell: (row) =>
                    linkButton({
                      href: `${endpoint}&edit=${encodeURIComponent(String(row.id))}`,
                      label: label(row),
                      variant: 'tertiary',
                      size: 'compact',
                    }),
                },
                ...(options.detail
                  ? [
                      {
                        key: 'detail',
                        label: _('crm_backend.configuration.detail'),
                        cell: (row: AnyRow) => options.detail!(row),
                      },
                    ]
                  : []),
                {
                  key: 'active',
                  label: _('crm_backend.field.active'),
                  cell: (row) =>
                    row.active === false
                      ? badge(_('crm_backend.state.archived'), 'neutral', 'archived')
                      : badge(_('crm_backend.state.active'), 'positive', 'active'),
                },
                {
                  key: 'toggle',
                  label: _('crm_backend.field.actions'),
                  cell: (row: AnyRow) => (
                    <RecordForm
                      action={endpoint}
                      layout="inline"
                      hidden={{
                        action: row.active === false ? 'restore' : 'archive',
                        id: String(row.id),
                        ...(row.version != null ? { expectedVersion: String(row.version) } : {}),
                      }}
                      fields={[]}
                      submit={
                        row.active === false
                          ? _('crm_backend.action.restore')
                          : _('crm_backend.action.archive')
                      }
                      submitVariant={row.active === false ? 'secondary' : 'tertiary'}
                      submitSize="compact"
                    />
                  ),
                },
              ],
            })
          : empty(_),
      ])}
    />
  )
}
