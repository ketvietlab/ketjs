import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import { collectionActions, collectionControls, ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

export const partnersScreen = (
  _: Translator,
  frame: Frame,
  // The filter island occupies the same compact command bar as the catalogue.
  searchFilterBar: JSXChild,
  // Pre-rendered by the route via `backend/ket-table.ts`'s `tableGrid()` —
  // `partnersScreen` stays a pure, synchronous view function, and the island
  // only needs `ctx`/`url`/`req` (for its joint) at the one call site that
  // already has them. The island also owns its own empty state, so there is
  // no `rows.length ? … : emptyState(...)` branch left to keep here.
  tableGrid: JSXChild,
  total = 0,
): TemplateResult =>
  shell(
    _,
    _('partner_backend.screen.title'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('partner_backend.screen.title')}
      description={_('partner_backend.screen.description')}
      actions={collectionActions(_, frame)}
      controls={collectionControls(_, _('partner_backend.screen.title'), {
        ...frame,
        chrome: { ...frame.chrome, searchContent: searchFilterBar },
      })}
      status={_('partner_backend.screen.results', { count: total })}
      body={tableGrid}
    />,
    { ...frame, chrome: null, topbar: false },
  )
