import { ListScreenFrame } from './page-frame.tsx'
import {
  dataTable,
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
): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_('hospitality_core.screen.stays.title')}
    frame={frame}
    body={
      rows.length
        ? dataTable(_, { columns: stayColumns(_, locale, timezone), rows, id: (row) => row.id })
        : emptyState(_('hospitality_core.screen.stays.empty'), _('hospitality_core.screen.stays.emptyHint'))
    }
  />
)
