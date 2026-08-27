import { ListScreenFrame } from './page-frame.tsx'
import {
  CardGrid,
  choices,
  dataTable,
  emptyState,
  type Frame,
  linkButton,
  Metric,
  Notice,
  type PropertyRow,
  RecordForm,
  roomTypeColumns,
  type RoomTypeRow,
  setupAction,
  stack,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const roomTypesScreen = (
  _: Translator,
  rows: RoomTypeRow[],
  properties: PropertyRow[],
  propertyId: string | undefined,
  locale: string,
  frame: Frame,
): TemplateResult => {
  const propertyQuery = propertyId ? `&property=${encodeURIComponent(propertyId)}` : ''
  return (
    <ListScreenFrame
      translator={_}
      title={_('hospitality_core.screen.roomTypes.title')}
      frame={frame}
      actions={
        properties.length
          ? linkButton({
              label: _('hospitality_core.roomType.action.create'),
              href: `/admin/hospitality/room-types/new?lang=${encodeURIComponent(locale)}${propertyQuery}`,
              variant: 'primary',
            })
          : undefined
      }
      body={stack([
        <RecordForm
          action="/admin/hospitality/room-types"
          method="get"
          layout="inline"
          fields={[
            {
              name: 'property',
              label: _('hospitality_core.roomType.field.property'),
              type: 'select',
              value: propertyId,
              options: choices(properties),
            },
          ]}
          hidden={{ lang: locale }}
          submit={_('hospitality_core.action.apply')}
          submitVariant="secondary"
        />,
        properties.length ? null : (
          <Notice
            title={_('hospitality_core.roomType.empty.noProperty')}
            message={_('hospitality_core.roomType.empty.noPropertyHint')}
            tone="warning"
            actions={setupAction(
              _('hospitality_core.property.action.create'),
              '/admin/hospitality/properties/new',
            )}
          />
        ),
        <CardGrid
          items={[
            { id: 'types', label: _('hospitality_core.roomType.metric.types'), value: rows.length },
            {
              id: 'published',
              label: _('hospitality_core.roomType.metric.published'),
              value: rows.filter((row) => row.published).length,
            },
            {
              id: 'rooms',
              label: _('hospitality_core.metric.rooms'),
              value: rows.reduce((sum, row) => sum + (row.rooms?.length ?? 0), 0),
            },
          ]}
          id={(item) => item.id}
          card={(item) => <Metric label={item.label} value={String(item.value)} tone={item.id} />}
        />,
        rows.length
          ? dataTable(_, {
              columns: roomTypeColumns(_),
              rows,
              id: (row) => row.id,
              rowHref: (row) =>
                `/admin/hospitality/room-types/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
            })
          : emptyState(
              _('hospitality_core.screen.roomTypes.empty'),
              _('hospitality_core.screen.roomTypes.emptyHint'),
            ),
      ])}
    />
  )
}
