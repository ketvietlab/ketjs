// The backend screens.
//
// Data assembly only. Not one tag, not one `data-ui` attribute — those live in
// `@ketvietlab/ketsuite/ui`, and `tools/ui-audit.ts` keeps them there. What a screen decides is
// which rows, which columns, which labels; what it must not decide is what a card
// or a table looks like, because that decision made forty times is forty answers.
//
// Every screen takes a translator, bound to `_` after gettext. It is a parameter
// rather than a module-level import because the locale is a fact about the request:
// a screen that reached for a global would answer the wrong language the moment two
// requests overlapped.

import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import { AppCard, badge, CardGroups, code, dataTable, emptyState, Framed, shell } from '../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../ui/index.ts'

export type AppRow = {
  name: string
  title: string
  summary: string
  category: string
  group?: {
    id: string
    by: string
    title: string
    summary: string
    sequence: number
    fixed: boolean
  } | null
  state: 'available' | 'installed'
  depends: string[]
  dependents: string[]
  install?: 'manual' | 'auto' | 'never'
  removable?: boolean
}

type AppGroupRow = {
  name: string
  title: string
  summary: string
  sequence: number
  state: 'available' | 'partial' | 'installed'
  installed: number
  total: number
  dependents: number
  removable: boolean
  fixed: boolean
}

export type PageRow = { id: string; path: string; title: string; published: boolean }

export type Screen = 'apps' | 'pages'

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
  const groupLabel = (group: NonNullable<AppRow['group']>, field: 'title' | 'summary'): string => {
    const key = `${group.by}.group.${group.id}.${field}`
    const out = _(key)
    return out === key ? group[field] : out
  }
  const grouped = new Map<string, AppRow[]>()
  for (const app of apps) {
    if (!app.group) continue
    const members = grouped.get(app.group.id) ?? []
    members.push(app)
    grouped.set(app.group.id, members)
  }
  const groups: AppGroupRow[] = [...grouped.values()]
    .map((members): AppGroupRow => {
      const group = members[0].group!
      const installed = members.filter((member) => member.state === 'installed').length
      const names = new Set(members.map((member) => member.name))
      const externalDependents = new Set(
        members.flatMap((member) => member.dependents).filter((dependent) => !names.has(dependent)),
      )
      return {
        name: `group:${group.id}`,
        title: groupLabel(group, 'title'),
        summary: groupLabel(group, 'summary'),
        sequence: group.sequence,
        state: installed === 0 ? 'available' : installed === members.length ? 'installed' : 'partial',
        installed,
        total: members.length,
        dependents: externalDependents.size,
        removable: members.every((member) => member.removable !== false),
        fixed: group.fixed,
      }
    })
    .sort((a, b) => a.sequence - b.sequence || a.title.localeCompare(b.title))
  const standalone = apps.filter((app) => !app.group)

  // Uninstalling something another app needs would take that app with it, so the
  // control says no rather than the failure arriving after the click.
  const standaloneCard = (app: AppRow): TemplateResult => (
    <AppCard
      app={app.name}
      state={app.state}
      title={label(_, app.name, 'title', app.title)}
      summary={label(_, app.name, 'summary', app.summary)}
      meta={[
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
      ]}
      action={{
        action: app.state === 'installed' ? 'uninstall' : 'install',
        label: app.state === 'installed' ? _('backend.apps.uninstall') : _('backend.apps.install'),
        disabled: app.state === 'installed' && app.dependents.length > 0,
      }}
      extra={extras['app-card.actions']?.[app.name]}
    />
  )
  const groupCard = (group: AppGroupRow): TemplateResult => (
    <AppCard
      app={group.name}
      state={group.state}
      title={group.title}
      summary={group.summary}
      meta={[
        {
          kind: 'neutral',
          term: _('backend.apps.group.progress'),
          value: `${group.installed}/${group.total}`,
        },
        ...(group.dependents > 0
          ? [
              {
                kind: 'dependents' as const,
                term: _('backend.apps.group.dependents'),
                value: String(group.dependents),
              },
            ]
          : []),
      ]}
      action={
        group.fixed
          ? undefined
          : {
              action: group.state === 'installed' ? 'uninstall' : 'install',
              label: group.state === 'installed' ? _('backend.apps.uninstall') : _('backend.apps.install'),
              disabled: group.state === 'installed' && (!group.removable || group.dependents > 0),
            }
      }
    />
  )
  const sections: Array<{
    key: string
    title: string
    items: Array<AppRow | AppGroupRow>
  }> = [
    ...(groups.length ? [{ key: 'groups', title: _('backend.apps.groups'), items: groups }] : []),
    ...(standalone.length
      ? [
          {
            key: 'standalone',
            title: _('backend.apps.standalone'),
            items: standalone,
          },
        ]
      : []),
  ]
  return shell(
    _,
    _('backend.apps.title'),
    apps.length === 0 ? (
      emptyState(_('backend.apps.empty.message'), _('backend.apps.empty.hint'))
    ) : (
      <CardGroups
        groups={sections}
        id={(item) => item.name}
        footer={extras['apps.footer']}
        card={(item) => ('total' in item ? groupCard(item as AppGroupRow) : standaloneCard(item as AppRow))}
      />
    ),
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

/**
 * The list screen, as the design catalogue and the table contract exercise it.
 *
 * No route renders this: `website_backend` owns the product page list, which is
 * site-scoped and carries revisions, preview and publish. This one used to be
 * served at `/admin/pages` beside it, so the sidebar offered "Trang" twice, in two
 * different apps, over the same rows. It stays because it is the smallest complete
 * example of `dataTable` with chrome, and both `/catalogue` and the contract test
 * are built on it.
 */
export const pagesScreen = (
  _: Translator,
  pages: PageRow[],
  frame: Frame = {},
  table: Partial<DataTable<PageRow>> = {},
): TemplateResult => (
  <Framed
    translator={_}
    title={_('backend.pages.title')}
    frame={frame}
    body={
      pages.length === 0
        ? emptyState(_('backend.pages.empty.message'), _('backend.pages.empty.hint'))
        : dataTable(_, { columns: pageColumns(_), rows: pages, id: (p) => p.id, ...table })
    }
  />
)

export const screens = { appsScreen, pagesScreen, emptyState }
