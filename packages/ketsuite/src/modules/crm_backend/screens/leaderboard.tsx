import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  dataTable,
  emptyState,
  inline,
  linkButton,
  ListPage,
  listChrome,
  RecordForm,
  shell,
} from '../../../ui/index.ts'
import type { Column, Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'

export type LeaderboardProfile = Record<string, unknown>

export type LeaderboardScreenOptions = {
  profiles: LeaderboardProfile[]
  errors?: string[]
  locale?: string
}

const when = (value: unknown): string => {
  const raw = String(value ?? '')
  if (!raw) return '—'
  return raw.length > 10 ? raw.slice(0, 16).replace('T', ' ') : raw
}

export const leaderboardColumns = (_: Translator, locale = ''): Column<LeaderboardProfile>[] => [
  {
    key: 'rank',
    label: '#',
    align: 'end',
    cell: (profile) => String(profile.rank ?? '—'),
  },
  {
    key: 'user',
    label: _('crm_backend.field.assignee'),
    priority: 'primary',
    cell: (profile) =>
      linkButton({
        href: localized(`/admin/users/${encodeURIComponent(String(profile.userId))}`, locale),
        label: String(profile.userName ?? profile.userId),
        variant: 'tertiary',
        size: 'compact',
      }),
  },
  {
    key: 'points',
    label: _('crm_backend.leaderboard.points'),
    align: 'end',
    cell: (profile) => String(profile.points ?? 0),
  },
  {
    key: 'won',
    label: _('crm.terminal.won'),
    align: 'end',
    cell: (profile) => String(profile.won ?? 0),
  },
  {
    key: 'lost',
    label: _('crm.terminal.lost'),
    align: 'end',
    cell: (profile) => String(profile.lost ?? 0),
  },
  {
    key: 'assigned',
    label: _('crm_backend.leaderboard.assigned'),
    align: 'end',
    cell: (profile) => String(profile.assigned ?? 0),
  },
  {
    key: 'activities',
    label: _('crm_backend.leaderboard.activities'),
    align: 'end',
    cell: (profile) => String(profile.activitiesDone ?? 0),
  },
  {
    key: 'refreshed',
    label: _('crm_backend.timeline.at'),
    cell: (profile) => when(profile.refreshedAt),
  },
]

export const leaderboardScreen = (
  _: Translator,
  frame: Frame,
  options: LeaderboardScreenOptions,
): TemplateResult => {
  const rows: LeaderboardProfile[] = options.profiles.map((profile, index) => ({
    ...profile,
    rank: index + 1,
  }))
  const title = _('crm_backend.leaderboard.title')
  const refresh = (
    <RecordForm
      action={localized('/admin/crm/leaderboard', options.locale ?? '')}
      layout="inline"
      hidden={{ action: 'refresh' }}
      fields={[]}
      errors={options.errors}
      submit={_('crm_backend.leaderboard.refresh')}
      submitVariant="secondary"
    />
  )

  return shell(
    _,
    title,
    <ListPage
      variant="operational"
      frame={frame}
      title={title}
      actions={inline([refresh, frame.extras?.['topbar.end'] ?? ''])}
      controls={
        frame.chrome
          ? listChrome(
              _,
              title,
              {
                ...frame.chrome,
                layout: 'command',
                section: undefined,
                create: null,
                selection: null,
              },
              false,
            )
          : undefined
      }
      status={`${title}: ${String(rows.length)}`}
      body={
        rows.length
          ? dataTable(_, {
              rows,
              id: (profile) => String(profile.id),
              columns: leaderboardColumns(_, options.locale),
              rowHref: (profile) =>
                localized(`/admin/users/${encodeURIComponent(String(profile.userId))}`, options.locale ?? ''),
            })
          : emptyState(_('crm_backend.leaderboard.emptyTitle'), _('crm_backend.leaderboard.emptyHint'))
      }
    />,
  )
}
