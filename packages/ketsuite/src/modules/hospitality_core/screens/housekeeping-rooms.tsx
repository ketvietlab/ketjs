import {
  CardGrid,
  choices,
  dataTable,
  emptyState,
  type Frame,
  WorkspaceScreen,
  housekeepingRoomColumns,
  Metric,
  type PropertyRow,
  RecordForm,
  ROOM_STATUSES,
  type RoomRow,
  type RoomStatusSummary,
  Section,
  stack,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const housekeepingRoomsScreen = (
  _: Translator,
  data: {
    rows: RoomRow[]
    properties: PropertyRow[]
    propertyId?: string
    state: string
    summary: RoomStatusSummary
  },
  locale: string,
  frame: Frame,
): TemplateResult => {
  const total =
    data.summary.available +
    data.summary.occupied +
    data.summary.dirty +
    data.summary.cleaning +
    data.summary.maintenance +
    data.summary.outOfOrder
  const attention =
    data.summary.dirty + data.summary.cleaning + data.summary.maintenance + data.summary.outOfOrder
  const metrics = [
    { id: 'rooms', value: total, tone: 'neutral' as const },
    {
      id: 'available',
      value: data.summary.available,
      tone: total && !data.summary.available ? ('warning' as const) : ('neutral' as const),
    },
    { id: 'occupied', value: data.summary.occupied, tone: 'neutral' as const },
    // Every room in this count is one a guest cannot be put into yet.
    { id: 'attention', value: attention, tone: attention ? ('danger' as const) : ('positive' as const) },
  ]

  return (
    <WorkspaceScreen
      translator={_}
      title={_('hospitality_core.screen.housekeepingRooms.title')}
      frame={frame}
      body={stack([
        <RecordForm
          action="/admin/hospitality/housekeeping/rooms"
          method="get"
          layout="inline"
          submit={_('hospitality_core.action.select')}
          submitVariant="secondary"
          hidden={{ lang: locale }}
          fields={[
            {
              name: 'property',
              label: _('hospitality_core.menu.properties'),
              type: 'select',
              value: data.propertyId,
              required: true,
              options: choices(data.properties),
            },
            {
              name: 'state',
              label: _('hospitality_core.col.status'),
              type: 'select',
              value: data.state,
              options: ['all', ...ROOM_STATUSES].map((value) => ({
                value,
                label: _(`hospitality_core.roomStatus.${value}`),
              })),
            },
          ]}
        />,
        <CardGrid
          items={metrics}
          id={(item) => item.id}
          card={(item) => (
            <Metric
              label={_(`hospitality_core.metric.${item.id}`)}
              value={String(item.value)}
              tone={item.tone}
            />
          )}
        />,
        <Section
          title={_('hospitality_core.housekeeping.rooms.section.board')}
          description={_('hospitality_core.housekeeping.rooms.section.boardHint')}
          body={
            data.rows.length
              ? dataTable(_, {
                  columns: housekeepingRoomColumns(_),
                  rows: data.rows,
                  id: (row) => row.id,
                  rowHref: (row) =>
                    `/admin/hospitality/housekeeping/rooms/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
                })
              : emptyState(
                  _('hospitality_core.screen.housekeepingRooms.empty'),
                  _('hospitality_core.screen.housekeepingRooms.emptyHint'),
                )
          }
        />,
      ])}
    />
  )
}
