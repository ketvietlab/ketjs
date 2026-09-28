// What a set of authority opens, screen by screen (user and role record modals).
//
// A grant is a function key and a role is a list of bundles; neither says whether
// someone can actually do their work on a screen. A screen needs a function to open
// and usually several more to be usable — the lookups that fill its dropdowns, the
// reads beside it, the writes that are the work itself. Reading authority by screen
// shows the gap an administrator would otherwise learn about from a support call:
// the screen that opens and then refuses the first dropdown.
//
// Render-pure: the rows are computed by the context read.

import { Badge, DataTable, DescriptionList, Notice, Section, Stack } from '@ketvietlab/design-system'
import type { JSXChild } from '@ketvietlab/ketjs-view'

export type SurfaceTier = 'lookup' | 'read' | 'write'

/** One function a screen needs and the reader lacks, named by the area it belongs to. */
export type SurfaceGap = { key: string; label: string; tier: SurfaceTier }

export type SurfaceAccess = {
  /** The menu entry the screen is reached from. */
  key: string
  label: string
  /** The menu heading it sits under, so two screens called "Settings" read apart. */
  area: string
  status: 'full' | 'partial' | 'none'
  missing: SurfaceGap[]
  /** The held roles that open it. Empty on a role's own view. */
  via: string[]
  /** Role templates that would cover everything missing, if any. */
  fixes: string[]
}

type Translate = (key: string, params?: Record<string, unknown>) => string

const tone = (status: SurfaceAccess['status']): 'positive' | 'warning' | 'neutral' =>
  status === 'full' ? 'positive' : status === 'partial' ? 'warning' : 'neutral'

const screenName = (row: SurfaceAccess): string => (row.area ? `${row.area} · ${row.label}` : row.label)

const gaps = (t: Translate, row: SurfaceAccess): string =>
  row.missing.map((gap) => `${gap.label} (${t(`user_backend.surface.tier.${gap.tier}`)})`).join(' · ')

/**
 * The screens, split by whether they can be worked on.
 *
 * A partial screen is listed first and with what it lacks: that is the row an
 * administrator came to read. Screens that do not open at all are not listed —
 * a list of everything someone cannot do says nothing about what they can.
 */
export const SurfaceAccessView = (props: {
  t: Translate
  surfaces: SurfaceAccess[]
  /** Whether rows say which held role opens them (a person) or not (a role). */
  showVia: boolean
  empty: { title: string; message: string }
}): JSXChild => {
  const { t } = props
  const partial = props.surfaces.filter((row) => row.status === 'partial')
  const full = props.surfaces.filter((row) => row.status === 'full')
  if (!partial.length && !full.length)
    return Notice({ tone: 'info', title: props.empty.title, message: props.empty.message })
  return Stack({
    gap: 'default',
    items: [
      DescriptionList({
        columns: 2,
        items: [
          {
            id: 'full',
            label: t('user_backend.surface.fullCount'),
            value: Badge({ label: String(full.length), tone: 'positive' }),
          },
          {
            id: 'partial',
            label: t('user_backend.surface.partialCount'),
            value: Badge({ label: String(partial.length), tone: partial.length ? 'warning' : 'neutral' }),
          },
        ],
      }),
      ...(partial.length
        ? [
            Section({
              title: t('user_backend.surface.partialTitle'),
              description: t('user_backend.surface.partialHint'),
              body: DataTable<SurfaceAccess>({
                rows: partial,
                id: (row) => row.key,
                columns: [
                  {
                    key: 'screen',
                    label: t('user_backend.surface.screen'),
                    priority: 'primary',
                    cell: (row) => screenName(row),
                  },
                  {
                    key: 'missing',
                    label: t('user_backend.surface.missing'),
                    cell: (row) => gaps(t, row),
                  },
                  {
                    key: 'fix',
                    label: t('user_backend.surface.fix'),
                    cell: (row) => row.fixes.join(' · ') || t('user_backend.surface.noFix'),
                  },
                ],
              }),
            }),
          ]
        : []),
      ...(full.length
        ? [
            Section({
              title: t('user_backend.surface.fullTitle'),
              body: DataTable<SurfaceAccess>({
                rows: full,
                id: (row) => row.key,
                columns: [
                  {
                    key: 'screen',
                    label: t('user_backend.surface.screen'),
                    priority: 'primary',
                    cell: (row) => screenName(row),
                  },
                  {
                    key: 'status',
                    label: t('user_backend.field.state'),
                    cell: (row) =>
                      Badge({
                        label: t(`user_backend.surface.status.${row.status}`),
                        tone: tone(row.status),
                      }),
                  },
                  ...(props.showVia
                    ? [
                        {
                          key: 'via',
                          label: t('user_backend.surface.via'),
                          cell: (row: SurfaceAccess) => row.via.join(' · ') || '—',
                        },
                      ]
                    : []),
                ],
              }),
            }),
          ]
        : []),
    ],
  })
}

/** How a preview row reads one screen's reach before and after. */
export type SurfaceChange = {
  key: string
  label: string
  area: string
  before: SurfaceAccess['status']
  after: SurfaceAccess['status']
}

/** What a change of roles does to the screens a person can work on. */
export const SurfaceChangeTable = (t: Translate, rows: SurfaceChange[], idPrefix: string): JSXChild =>
  DataTable<SurfaceChange>({
    rows,
    id: (row) => `${idPrefix}:${row.key}`,
    columns: [
      {
        key: 'screen',
        label: t('user_backend.surface.screen'),
        priority: 'primary',
        cell: (row) => (row.area ? `${row.area} · ${row.label}` : row.label),
      },
      {
        key: 'before',
        label: t('user_backend.preview.before'),
        cell: (row) =>
          Badge({ label: t(`user_backend.surface.status.${row.before}`), tone: tone(row.before) }),
      },
      {
        key: 'after',
        label: t('user_backend.preview.after'),
        cell: (row) => Badge({ label: t(`user_backend.surface.status.${row.after}`), tone: tone(row.after) }),
      },
    ],
  })
