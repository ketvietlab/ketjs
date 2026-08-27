import {
  CardGrid,
  type Choice,
  choices,
  dataTable,
  DatePicker,
  emptyState,
  feedback,
  FormCluster,
  type Frame,
  Framed,
  inventoryColumns,
  type InventoryRow,
  Metric,
  RecordForm,
  Section,
  stack,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const inventoryScreen = (
  _: Translator,
  rows: InventoryRow[],
  properties: Choice[],
  roomTypes: Choice[],
  selected: { propertyId?: string; roomTypeId?: string; from: string; to: string },
  frame: Frame,
  state?: string | null,
): TemplateResult => {
  const selectedRoomTypes = roomTypes.filter((row) => row.propertyId === selected.propertyId)
  const hidden = {
    propertyId: selected.propertyId ?? '',
    roomTypeId: selected.roomTypeId ?? '',
  }
  return (
    <Framed
      translator={_}
      title={_('hospitality_core.screen.inventory.title')}
      frame={frame}
      body={stack([
        feedback(_, state),
        <FormCluster
          label={_('hospitality_core.screen.inventory.filters')}
          forms={[
            <RecordForm
              action="/admin/hospitality/inventory"
              method="get"
              layout="inline"
              submit={_('hospitality_core.action.select')}
              submitVariant="secondary"
              hidden={{ from: selected.from, to: selected.to }}
              fields={[
                {
                  name: 'property',
                  label: _('hospitality_core.menu.properties'),
                  type: 'select',
                  value: selected.propertyId,
                  options: choices(properties),
                  required: true,
                },
                {
                  name: 'roomType',
                  label: _('hospitality_core.col.roomType'),
                  type: 'select',
                  value: selected.roomTypeId,
                  options: choices(selectedRoomTypes),
                  required: true,
                },
              ]}
            />,
            <DatePicker
              action="/admin/hospitality/inventory"
              label={_('hospitality_core.screen.inventory.dateRange')}
              fields={[
                {
                  name: 'from',
                  label: _('hospitality_core.field.from'),
                  value: selected.from,
                  required: true,
                },
                { name: 'to', label: _('hospitality_core.field.to'), value: selected.to, required: true },
              ]}
              hidden={{
                property: selected.propertyId ?? '',
                roomType: selected.roomTypeId ?? '',
              }}
              submit={_('hospitality_core.action.apply')}
            />,
          ]}
        />,
        <CardGrid
          items={[
            { id: 'days', label: _('hospitality_core.metric.inventoryDays'), value: rows.length },
            {
              id: 'available',
              label: _('hospitality_core.metric.minimumAvailable'),
              value: rows.length ? Math.min(...rows.map((row) => row.available)) : 0,
            },
            {
              id: 'sold',
              label: _('hospitality_core.metric.sold'),
              value: rows.reduce((sum, row) => sum + row.sold, 0),
            },
            {
              id: 'blocked',
              label: _('hospitality_core.metric.blocked'),
              value: rows.reduce((sum, row) => sum + row.blocked, 0),
            },
          ]}
          id={(item) => item.id}
          card={(item) => <Metric label={item.label} value={String(item.value)} tone={item.id} />}
        />,
        <Section
          title={_('hospitality_core.screen.inventory.allotment')}
          description={_('hospitality_core.screen.inventory.allotmentHint')}
          body={
            selected.roomTypeId ? (
              <RecordForm
                action="/admin/hospitality/inventory"
                method="post"
                submit={_('hospitality_core.action.updateAllotment')}
                submitVariant="primary"
                hidden={{ ...hidden, operation: 'set-inventory' }}
                fields={[
                  {
                    name: 'from',
                    label: _('hospitality_core.field.from'),
                    type: 'date',
                    value: selected.from,
                    required: true,
                  },
                  {
                    name: 'to',
                    label: _('hospitality_core.field.to'),
                    type: 'date',
                    value: selected.to,
                    required: true,
                  },
                  { name: 'total', label: _('hospitality_core.col.total'), type: 'number', required: true },
                  { name: 'blocked', label: _('hospitality_core.col.blocked'), type: 'number' },
                ]}
              />
            ) : (
              emptyState(
                _('hospitality_core.screen.inventory.noRoomType'),
                _('hospitality_core.screen.inventory.noRoomTypeHint'),
              )
            )
          }
        />,
        <Section
          title={_('hospitality_core.screen.inventory.restrictions')}
          description={_('hospitality_core.screen.inventory.restrictionsHint')}
          body={
            selected.roomTypeId ? (
              <RecordForm
                action="/admin/hospitality/inventory"
                method="post"
                submit={_('hospitality_core.action.updateRestrictions')}
                submitVariant="secondary"
                hidden={{ ...hidden, operation: 'set-restrictions' }}
                fields={[
                  {
                    name: 'from',
                    label: _('hospitality_core.field.from'),
                    type: 'date',
                    value: selected.from,
                    required: true,
                  },
                  {
                    name: 'to',
                    label: _('hospitality_core.field.to'),
                    type: 'date',
                    value: selected.to,
                    required: true,
                  },
                  { name: 'minLos', label: _('hospitality_core.field.minLos'), type: 'number', value: 0 },
                  { name: 'maxLos', label: _('hospitality_core.field.maxLos'), type: 'number', value: 0 },
                  { name: 'stopSell', label: _('hospitality_core.restriction.stopSell'), type: 'checkbox' },
                  { name: 'closedToArrival', label: _('hospitality_core.restriction.cta'), type: 'checkbox' },
                  {
                    name: 'closedToDeparture',
                    label: _('hospitality_core.restriction.ctd'),
                    type: 'checkbox',
                  },
                ]}
              />
            ) : null
          }
        />,
        rows.length
          ? dataTable(_, { columns: inventoryColumns(_), rows, id: (row) => row.id })
          : emptyState(
              _('hospitality_core.screen.inventory.empty'),
              _('hospitality_core.screen.inventory.emptyHint'),
            ),
      ])}
    />
  )
}
