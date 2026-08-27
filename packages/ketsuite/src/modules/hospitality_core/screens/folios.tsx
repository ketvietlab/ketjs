import { ListScreenFrame } from './page-frame.tsx'
import { dataTable, emptyState, folioColumns, type FolioRow, type Frame, type TemplateResult, type Translator } from './shared.tsx'

export const foliosScreen = (
  _: Translator,
  rows: FolioRow[],
  locale: string,
  timezone: string,
  frame: Frame,
): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_('hospitality_core.screen.folios.title')}
    frame={frame}
    body={
      rows.length
        ? dataTable(_, { columns: folioColumns(_, locale, timezone), rows, id: (row) => row.id })
        : emptyState(_('hospitality_core.screen.folios.empty'), _('hospitality_core.screen.folios.emptyHint'))
    }
  />
)
