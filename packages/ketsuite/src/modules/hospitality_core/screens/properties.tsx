import { ListScreenFrame } from './page-frame.tsx'
import {
  CardGrid,
  dataTable,
  emptyState,
  type Frame,
  linkButton,
  Metric,
  propertyColumns,
  type PropertyRow,
  stack,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const propertiesScreen = (
  _: Translator,
  rows: PropertyRow[],
  totals: { rooms: number; available: number; attention: number },
  locale: string,
  frame: Frame,
): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_('hospitality_core.screen.properties.title')}
    frame={frame}
    actions={linkButton({
      label: _('hospitality_core.property.action.create'),
      href: `/admin/hospitality/properties/new?lang=${encodeURIComponent(locale)}`,
      variant: 'primary',
    })}
    body={stack([
      <CardGrid
        items={[
          {
            id: 'properties',
            label: _('hospitality_core.metric.properties'),
            value: rows.length,
            tone: 'neutral' as const,
          },
          {
            id: 'rooms',
            label: _('hospitality_core.metric.rooms'),
            value: totals.rooms,
            tone: 'neutral' as const,
          },
          {
            id: 'available',
            label: _('hospitality_core.metric.available'),
            value: totals.available,
            // No sellable room is not a small number, it is a stopped hotel.
            tone: totals.rooms && !totals.available ? ('warning' as const) : ('neutral' as const),
          },
          {
            id: 'attention',
            label: _('hospitality_core.metric.attention'),
            value: totals.attention,
            tone: totals.attention ? ('danger' as const) : ('positive' as const),
          },
        ]}
        id={(item) => item.id}
        card={(item) => <Metric label={item.label} value={String(item.value)} tone={item.tone} />}
      />,
      rows.length
        ? dataTable(_, {
            columns: propertyColumns(_),
            rows,
            id: (row) => row.id,
            rowHref: (row) =>
              `/admin/hospitality/properties/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
          })
        : emptyState(
            _('hospitality_core.screen.properties.empty'),
            _('hospitality_core.screen.properties.emptyHint'),
          ),
    ])}
  />
)
