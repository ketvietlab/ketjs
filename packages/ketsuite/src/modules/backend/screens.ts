// The backend screens.
//
// Data assembly only. Not one tag, not one `data-ui` attribute — those live in
// `ketsuite/ui`, and `tools/ui-audit.ts` keeps them there. What a screen decides is
// which rows, which columns, which labels; what it must not decide is what a card
// or a table looks like, because that decision made forty times is forty answers.
//
// Every screen takes a translator, bound to `_` after gettext. It is a parameter
// rather than a module-level import because the locale is a fact about the request:
// a screen that reached for a global would answer the wrong language the moment two
// requests overlapped.

import type { TemplateResult } from 'ketjs-view'
import type { Translator } from 'ketjs'
import {
  badge,
  card,
  cardGroups,
  code,
  dataTable,
  definitionList,
  emptyState,
  framed,
  shell,
} from '../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../ui/index.ts'

export type AppRow = {
  name: string
  title: string
  summary: string
  category: string
  state: 'available' | 'installed'
  depends: string[]
  dependents: string[]
}

export type PageRow = { id: string; path: string; title: string; published: boolean }

export type Screen = 'apps' | 'pages' | 'settings'

/**
 * An app's name, summary and category are declared as plain strings so a module
 * stays readable without a catalogue. A module that wants them translated adds
 * `app.title`, `app.summary` or `app.category` to its own messages, and this picks
 * the translation up when it exists.
 *
 * The convention beats a second declaration syntax: no module has to change, and
 * the pseudo-locale shows immediately which ones have not been translated yet.
 */
const label = (
  _: Translator,
  module: string,
  field: 'title' | 'summary' | 'category',
  literal: string,
): string => {
  const key = `${module}.app.${field}`
  const out = _(key)
  return out === key ? literal : out
}

export const appsScreen = (_: Translator, apps: AppRow[], frame: Frame = {}): TemplateResult => {
  const extras = frame.extras ?? {}
  const categories = [...new Set(apps.map((a) => a.category))].sort()
  const categoryLabel = (c: string): string => {
    const owner = apps.find((a) => a.category === c)
    return owner ? label(_, owner.name, 'category', c) : c
  }
  return shell(
    _,
    _('backend.apps.title'),
    apps.length === 0
      ? emptyState(_('backend.apps.empty.message'), _('backend.apps.empty.hint'))
      : cardGroups({
          groups: categories.map((c) => ({
            key: c,
            title: categoryLabel(c),
            items: apps.filter((a) => a.category === c),
          })),
          id: (a) => a.name,
          footer: extras['apps.footer'],
          card: (app) =>
            card({
              key: app.name,
              state: app.state,
              title: label(_, app.name, 'title', app.title),
              summary: label(_, app.name, 'summary', app.summary),
              meta: [
                {
                  kind: 'depends' as const,
                  term: _('backend.apps.depends'),
                  value: app.depends.join(', ') || _('backend.apps.none'),
                },
                ...(app.dependents.length > 0
                  ? [
                      {
                        kind: 'dependents' as const,
                        term: _('backend.apps.dependents'),
                        value: app.dependents.join(', '),
                      },
                    ]
                  : []),
              ],
              // Uninstalling something another app needs would take that app with it, so
              // the control says no rather than the failure arriving after the click.
              action: {
                action: app.state === 'installed' ? 'uninstall' : 'install',
                label: app.state === 'installed' ? _('backend.apps.uninstall') : _('backend.apps.install'),
                disabled: app.state === 'installed' && app.dependents.length > 0,
              },
              extra: extras['app-card.actions']?.[app.name],
            }),
        }),
    frame,
  )
}

/**
 * The columns of the pages list, as data.
 *
 * Exported because a module that extends this list needs something to name. The
 * id is optional: useful when you are debugging a route, noise the rest of the time.
 */
export const pageColumns = (_: Translator): Array<Column<PageRow>> => [
  {
    key: 'path',
    label: _('backend.pages.col.path'),
    cell: (p) => code(p.path),
    kind: 'identifier',
    priority: 'primary',
  },
  { key: 'title', label: _('backend.pages.col.title'), cell: (p) => p.title, priority: 'primary' },
  {
    key: 'state',
    label: _('backend.pages.col.state'),
    kind: 'status',
    priority: 'secondary',
    cell: (p) =>
      p.published
        ? badge(_('backend.pages.published'), 'positive', 'published')
        : badge(_('backend.pages.draft'), 'neutral', 'draft'),
  },
  {
    key: 'id',
    label: _('backend.table.id'),
    cell: (p) => code(p.id),
    kind: 'identifier',
    priority: 'tertiary',
    optional: true,
  },
]

export const pagesScreen = (
  _: Translator,
  pages: PageRow[],
  frame: Frame = {},
  table: Partial<DataTable<PageRow>> = {},
): TemplateResult =>
  framed(
    _,
    _('backend.pages.title'),
    frame,
    pages.length === 0
      ? emptyState(_('backend.pages.empty.message'), _('backend.pages.empty.hint'))
      : dataTable(_, { columns: pageColumns(_), rows: pages, id: (p) => p.id, ...table }),
  )

export const settingsScreen = (
  _: Translator,
  tokens: Record<string, string>,
  frame: Frame = {},
): TemplateResult =>
  framed(
    _,
    _('backend.settings.title'),
    frame,
    definitionList({
      title: _('backend.settings.tokens'),
      items: Object.entries(tokens).map(([k, v]) => ({ key: k, term: `--ket-${k}`, value: v })),
    }),
  )

export const screens = { appsScreen, pagesScreen, settingsScreen, emptyState }
