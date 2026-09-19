import { prepareCollectionTable } from '../../../ui/index.ts'
import { ListScreenFrame } from './page-frame.tsx'
import {
  collectionTable,
  emptyState,
  folioColumns,
  type FolioRow,
  type Frame,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const foliosScreen = (
  _: Translator,
  rows: FolioRow[],
  locale: string,
  timezone: string,
  frame: Frame,
): TemplateResult => {
  const collection = prepareCollectionTable(
    _,
    frame,
    { columns: folioColumns(_, locale, timezone), rows, id: (row) => row.id },
    { paginate: true },
  )
  return (
    <ListScreenFrame
      translator={_}
      title={_('hospitality_core.screen.folios.title')}
      frame={collection.frame}
      body={
        collection.table.rows.length
          ? collectionTable(_, collection.table)
          : emptyState(
              _('hospitality_core.screen.folios.empty'),
              _('hospitality_core.screen.folios.emptyHint'),
            )
      }
    />
  )
}
