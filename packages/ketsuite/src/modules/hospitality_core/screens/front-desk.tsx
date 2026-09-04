import {
  CardGrid,
  dataTable,
  emptyState,
  type Frame,
  WorkspaceScreen,
  Metric,
  Section,
  setupAction,
  stack,
  stayColumns,
  type StayRow,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const frontDeskScreen = (
  _: Translator,
  rows: StayRow[],
  overdueRows: StayRow[],
  totals: { arrivals: number; inHouse: number; departures: number; overdue: number; openFolios: number },
  locale: string,
  timezone: string,
  frame: Frame,
  configured = true,
): TemplateResult => (
  <WorkspaceScreen
    translator={_}
    title={_('hospitality_core.screen.frontDesk.title')}
    frame={frame}
    body={stack([
      <CardGrid
        items={[
          { id: 'arrivals', label: _('hospitality_core.metric.arrivals'), value: totals.arrivals },
          { id: 'in-house', label: _('hospitality_core.metric.inHouse'), value: totals.inHouse },
          { id: 'departures', label: _('hospitality_core.metric.departures'), value: totals.departures },
          { id: 'overdue', label: _('hospitality_core.metric.overdue'), value: totals.overdue },
          { id: 'folios', label: _('hospitality_core.metric.openFolios'), value: totals.openFolios },
        ]}
        id={(item) => item.id}
        card={(item) => <Metric label={item.label} value={String(item.value)} tone={item.id} />}
      />,
      overdueRows.length ? (
        <Section
          title={_('hospitality_core.screen.frontDesk.overdue')}
          description={_('hospitality_core.screen.frontDesk.overdueHint', {
            count: overdueRows.length,
          })}
          body={dataTable(_, {
            columns: stayColumns(_, locale, timezone),
            rows: overdueRows,
            id: (row) => row.id,
          })}
        />
      ) : null,
      rows.length
        ? dataTable(_, { columns: stayColumns(_, locale, timezone), rows, id: (row) => row.id })
        : configured
          ? emptyState(
              _('hospitality_core.screen.frontDesk.empty'),
              _('hospitality_core.screen.frontDesk.emptyHint'),
            )
          : emptyState(
              _('hospitality_core.screen.frontDesk.setup'),
              _('hospitality_core.screen.frontDesk.setupHint'),
              {
                actions: setupAction(
                  _('hospitality_core.property.action.create'),
                  '/admin/hospitality/properties/new',
                ),
              },
            ),
    ])}
  />
)
