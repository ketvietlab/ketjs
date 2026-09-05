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
import { badge, code, dataTable, emptyState, ListScreen } from '../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../ui/index.ts'

export type PageRow = { id: string; path: string; title: string; published: boolean }

export type Screen = 'pages'

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
  <ListScreen
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

export const screens = { pagesScreen, emptyState }
