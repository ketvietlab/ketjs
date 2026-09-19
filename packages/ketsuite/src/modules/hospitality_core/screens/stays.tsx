import { prepareCollectionTable } from '../../../ui/index.ts'
import { ListScreenFrame } from './page-frame.tsx'
import {
  collectionTable,
  emptyState,
  type Frame,
  stayColumns,
  type StayRow,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const staysScreen = (
  _: Translator,
  rows: StayRow[],
  locale: string,
  timezone: string,
  frame: Frame,
): TemplateResult => {
  const collection = prepareCollectionTable(
    _,
    frame,
    { columns: stayColumns(_, locale, timezone), rows, id: (row) => row.id },
    { paginate: true },
  )
  return (
    <ListScreenFrame
      translator={_}
      title={_('hospitality_core.screen.stays.title')}
      frame={collection.frame}
      body={
        collection.table.rows.length
          ? collectionTable(_, collection.table)
          : emptyState(_('hospitality_core.screen.stays.empty'), _('hospitality_core.screen.stays.emptyHint'))
      }
    />
  )
}
