import { prepareCollectionTable } from '../../../ui/index.ts'
import { ListScreenFrame } from './page-frame.tsx'
import {
  collectionTable,
  emptyState,
  folioColumns,
  type FolioRow,
  type DataTable,
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
  /** What the route decided about the table, notably the groups it is read by. */
  table?: Partial<DataTable<FolioRow>>,
): TemplateResult => {
  const collection = prepareCollectionTable(
    _,
    frame,
    { columns: folioColumns(_, locale, timezone), rows, id: (row) => row.id, ...table },
    { paginate: !table?.groups },
  )
  return (
    <ListScreenFrame
      translator={_}
      title={_('hospitality_core.screen.folios.title')}
      frame={collection.frame}
      body={
        collection.table.rows.length || table?.groups?.length
          ? collectionTable(_, collection.table)
          : emptyState(
              _('hospitality_core.screen.folios.empty'),
              _('hospitality_core.screen.folios.emptyHint'),
            )
      }
    />
  )
}
