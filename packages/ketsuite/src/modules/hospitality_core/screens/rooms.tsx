import { ListScreenFrame } from './page-frame.tsx'
import {
  buildingColumns,
  type BuildingRow,
  CardGrid,
  choices,
  dataTable,
  emptyState,
  floorColumns,
  type FloorRow,
  FormCluster,
  type Frame,
  linkButton,
  Metric,
  Notice,
  type PropertyRow,
  RecordForm,
  roomColumns,
  roomFeedback,
  type RoomRow,
  type RoomTypeRow,
  Section,
  setupAction,
  stack,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const roomsScreen = (
  _: Translator,
  data: {
    rows: RoomRow[]
    properties: PropertyRow[]
    propertyId?: string
    roomTypes: RoomTypeRow[]
    buildings: BuildingRow[]
    floors: FloorRow[]
  },
  locale: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult => {
  const query = new URLSearchParams({ lang: locale })
  if (data.propertyId) query.set('property', data.propertyId)
  const action = `/admin/hospitality/rooms?${query.toString()}`
  const activeBuildings = data.buildings.filter((row) => row.active)
  const activeFloors = data.floors.filter((row) => row.active)
  const canCreateRoom = Boolean(data.propertyId && data.roomTypes.length)
  return (
    <ListScreenFrame
      translator={_}
      title={_('hospitality_core.screen.rooms.title')}
      frame={frame}
      actions={
        canCreateRoom
          ? linkButton({
              label: _('hospitality_core.room.action.create'),
              href: `/admin/hospitality/rooms/new?${query.toString()}`,
              variant: 'primary',
            })
          : undefined
      }
      body={stack([
        roomFeedback(_, status, errors),
        <RecordForm
          action="/admin/hospitality/rooms"
          method="get"
          layout="inline"
          fields={[
            {
              name: 'property',
              label: _('hospitality_core.room.field.property'),
              type: 'select',
              value: data.propertyId,
              options: choices(data.properties),
            },
          ]}
          hidden={{ lang: locale }}
          submit={_('hospitality_core.action.apply')}
          submitVariant="secondary"
        />,
        canCreateRoom ? null : (
          <Notice
            title={_('hospitality_core.room.empty.prerequisite')}
            message={_('hospitality_core.room.empty.prerequisiteHint')}
            tone="warning"
          />
        ),
        <CardGrid
          items={[
            {
              id: 'rooms',
              label: _('hospitality_core.metric.rooms'),
              value: data.rows.length,
              tone: 'neutral' as const,
            },
            {
              id: 'buildings',
              label: _('hospitality_core.property.metric.buildings'),
              value: activeBuildings.length,
              tone: 'neutral' as const,
            },
            {
              id: 'floors',
              label: _('hospitality_core.room.metric.floors'),
              value: activeFloors.length,
              tone: 'neutral' as const,
            },
            {
              id: 'available',
              label: _('hospitality_core.metric.available'),
              value: data.rows.filter((row) => row.status === 'available').length,
              // Rooms exist but none is ready: the desk has nothing to give out.
              tone:
                data.rows.length && !data.rows.some((row) => row.status === 'available')
                  ? ('warning' as const)
                  : ('neutral' as const),
            },
          ]}
          id={(item) => item.id}
          card={(item) => <Metric label={item.label} value={String(item.value)} tone={item.tone} />}
        />,
        ...(data.propertyId
          ? [
              <Section
                title={_('hospitality_core.room.section.locationSetup')}
                description={_('hospitality_core.room.section.locationSetupHint')}
                body={
                  <FormCluster
                    label={_('hospitality_core.room.section.locationSetup')}
                    forms={[
                      <RecordForm
                        action={action}
                        hidden={{
                          id: 'new-building',
                          operation: 'save-building',
                          propertyId: data.propertyId,
                        }}
                        submit={_('hospitality_core.room.action.createBuilding')}
                        submitVariant="secondary"
                        fields={[
                          {
                            name: 'code',
                            label: _('hospitality_core.room.field.buildingCode'),
                            required: true,
                          },
                          {
                            name: 'name',
                            label: _('hospitality_core.room.field.buildingName'),
                            required: true,
                          },
                          {
                            name: 'sequence',
                            label: _('hospitality_core.room.field.sequence'),
                            type: 'number',
                            value: 10,
                            step: '1',
                          },
                        ]}
                      />,
                      ...(activeBuildings.length
                        ? [
                            <RecordForm
                              action={action}
                              hidden={{
                                id: 'new-floor',
                                operation: 'save-floor',
                                propertyId: data.propertyId,
                              }}
                              submit={_('hospitality_core.room.action.createFloor')}
                              submitVariant="secondary"
                              fields={[
                                {
                                  name: 'buildingId',
                                  label: _('hospitality_core.room.field.building'),
                                  type: 'select' as const,
                                  options: choices(activeBuildings),
                                  required: true,
                                },
                                {
                                  name: 'code',
                                  label: _('hospitality_core.room.field.floorCode'),
                                  required: true,
                                },
                                {
                                  name: 'name',
                                  label: _('hospitality_core.room.field.floorName'),
                                  required: true,
                                },
                                {
                                  name: 'sequence',
                                  label: _('hospitality_core.room.field.sequence'),
                                  type: 'number' as const,
                                  value: 10,
                                  step: '1',
                                },
                              ]}
                            />,
                          ]
                        : []),
                    ]}
                  />
                }
              />,
              <Section
                title={_('hospitality_core.room.section.buildings')}
                description={_('hospitality_core.room.section.buildingsHint')}
                body={
                  data.buildings.length
                    ? dataTable(_, {
                        columns: buildingColumns(_),
                        rows: data.buildings,
                        id: (row) => row.id,
                        rowHref: (row) =>
                          `/admin/hospitality/buildings/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
                      })
                    : emptyState(
                        _('hospitality_core.room.empty.buildings'),
                        _('hospitality_core.room.empty.buildingsHint'),
                      )
                }
              />,
              <Section
                title={_('hospitality_core.room.section.floors')}
                description={_('hospitality_core.room.section.floorsHint')}
                body={
                  data.floors.length
                    ? dataTable(_, {
                        columns: floorColumns(_),
                        rows: data.floors,
                        id: (row) => row.id,
                        rowHref: (row) =>
                          `/admin/hospitality/levels/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
                      })
                    : emptyState(
                        _('hospitality_core.room.empty.floors'),
                        _('hospitality_core.room.empty.floorsHint'),
                      )
                }
              />,
            ]
          : []),
        <Section
          title={_('hospitality_core.room.section.rooms')}
          description={_('hospitality_core.room.section.roomsHint')}
          body={
            data.rows.length
              ? dataTable(_, {
                  columns: roomColumns(_),
                  rows: data.rows,
                  id: (row) => row.id,
                  rowHref: (row) =>
                    `/admin/hospitality/rooms/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
                })
              : emptyState(
                  _('hospitality_core.screen.rooms.empty'),
                  _('hospitality_core.screen.rooms.emptyHint'),
                  {
                    actions: setupAction(
                      _('hospitality_core.room.action.create'),
                      '/admin/hospitality/rooms/new',
                    ),
                  },
                )
          }
        />,
      ])}
    />
  )
}
