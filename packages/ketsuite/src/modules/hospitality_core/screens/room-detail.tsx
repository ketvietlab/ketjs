import { FormScreenFrame } from './page-frame.tsx'
import {
  badge,
  type BuildingRow,
  DefinitionList,
  type FloorRow,
  type Frame,
  icon,
  linkButton,
  type PropertyRow,
  RecordActions,
  RecordWorkspace,
  type RoomDetail,
  roomFeedback,
  roomForm,
  type RoomFormValues,
  type RoomTypeRow,
  Section,
  stack,
  statusTone,
  Surface,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const roomDetailScreen = (
  _: Translator,
  room: RoomDetail,
  values: RoomFormValues,
  properties: PropertyRow[],
  roomTypes: RoomTypeRow[],
  buildings: BuildingRow[],
  floors: FloorRow[],
  locale: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult => {
  const query = `lang=${encodeURIComponent(locale)}`
  const propertyName = room.property?.name ?? room.property?.code ?? room.propertyId
  const location = [room.building?.name ?? room.building?.code, room.floor?.name ?? room.floor?.code]
    .filter(Boolean)
    .join(' · ')
  return (
    <FormScreenFrame
      translator={_}
      title={room.name}
      frame={frame}
      body={stack([
        roomFeedback(_, status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.room.detail.kicker')}
          title={room.name}
          subtitle={`${room.code} · ${propertyName}`}
          imageFallback={icon('hotel')}
          badges={[
            badge(_(`hospitality_core.roomStatus.${room.status}`), statusTone(room.status), room.status),
            badge(
              _(room.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive'),
              room.active ? 'positive' : 'neutral',
            ),
          ]}
          summary={[
            { id: 'capacity', label: _('hospitality_core.col.capacity'), value: room.capacity },
            {
              id: 'roomType',
              label: _('hospitality_core.col.roomType'),
              value: room.roomType?.name ?? room.roomType?.code ?? room.roomTypeId,
            },
            {
              id: 'location',
              label: _('hospitality_core.col.location'),
              value: location || _('hospitality_core.room.value.unassignedLocation'),
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.room.action.back'),
            href: `/admin/hospitality/rooms?property=${encodeURIComponent(room.propertyId)}&${query}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.room.section.information')}
              description={_('hospitality_core.room.section.informationHint')}
              body={
                <DefinitionList
                  title={room.name}
                  items={[
                    { key: 'property', term: _('hospitality_core.room.field.property'), value: propertyName },
                    {
                      key: 'type',
                      term: _('hospitality_core.room.field.roomType'),
                      value: room.roomType?.name ?? room.roomType?.code ?? room.roomTypeId,
                    },
                    {
                      key: 'location',
                      term: _('hospitality_core.col.location'),
                      value: location || _('hospitality_core.room.value.unassignedLocation'),
                    },
                    {
                      key: 'status',
                      term: _('hospitality_core.col.status'),
                      value: _(`hospitality_core.roomStatus.${room.status}`),
                    },
                  ]}
                />
              }
            />,
            <Section
              title={_('hospitality_core.room.section.settings')}
              description={_('hospitality_core.room.section.settingsHint')}
              body={roomForm(
                _,
                values,
                properties,
                roomTypes,
                buildings,
                floors,
                locale,
                `/admin/hospitality/rooms/${encodeURIComponent(room.id)}?${query}`,
                _('hospitality_core.room.action.save'),
                `/admin/hospitality/rooms?property=${encodeURIComponent(room.propertyId)}&${query}`,
              )}
            />,
            <Section
              title={_('hospitality_core.room.section.lifecycle')}
              description={_('hospitality_core.room.section.lifecycleHint')}
              body={stack([
                linkButton({
                  label: _('hospitality_core.room.action.openHousekeeping'),
                  href: `/admin/hospitality/housekeeping/rooms/${encodeURIComponent(room.id)}?${query}`,
                  variant: 'secondary',
                }),
                <Surface
                  body={
                    <RecordActions
                      action={`/admin/hospitality/rooms/${encodeURIComponent(room.id)}/archive?${query}`}
                      actions={[
                        room.active
                          ? {
                              value: 'archive',
                              label: _('hospitality_core.room.action.archive'),
                              variant: 'destructive',
                            }
                          : {
                              value: 'restore',
                              label: _('hospitality_core.room.action.restore'),
                              variant: 'secondary',
                            },
                      ]}
                    />
                  }
                />,
              ])}
            />,
          ])}
        />,
      ])}
    />
  )
}
