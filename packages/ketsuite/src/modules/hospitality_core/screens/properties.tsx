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
    body={stack([
      linkButton({
        label: _('hospitality_core.property.action.create'),
        href: `/admin/hospitality/properties/new?lang=${encodeURIComponent(locale)}`,
        variant: 'primary',
      }),
      <CardGrid
        items={[
          { id: 'properties', label: _('hospitality_core.metric.properties'), value: rows.length },
          { id: 'rooms', label: _('hospitality_core.metric.rooms'), value: totals.rooms },
          { id: 'available', label: _('hospitality_core.metric.available'), value: totals.available },
          { id: 'attention', label: _('hospitality_core.metric.attention'), value: totals.attention },
        ]}
        id={(item) => item.id}
        card={(item) => <Metric label={item.label} value={String(item.value)} tone={item.id} />}
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
