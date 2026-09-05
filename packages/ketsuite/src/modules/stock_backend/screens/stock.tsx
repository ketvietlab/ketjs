import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { emptyState, ListScreen, stack } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { stockRowsTable } from './shared.tsx'
import type { StockRow } from './shared.tsx'

/** Unrouted compatibility surface retained for the i18n catalogue. */
export const stockScreen = (
  _: Translator,
  title: string,
  rows: StockRow[],
  frame: Frame,
  additions: readonly JSXChild[] = [],
  showEmpty = true,
): TemplateResult => (
  <ListScreen
    translator={_}
    title={title}
    frame={frame}
    body={stack([
      ...additions,
      rows.length
        ? stockRowsTable(_, rows)
        : showEmpty
          ? emptyState(_('stock_backend.empty'), _('stock_backend.emptyHint'))
          : '',
    ])}
  />
)
