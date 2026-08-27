import { FormScreenFrame } from './page-frame.tsx'
import { badge, DefinitionList, formatMoney, type Frame, icon, linkButton, type PolicyRow, type PropertyRow, RecordWorkspace, type RoomTypeDetail, roomTypeFeedback, roomTypeForm, type RoomTypeFormValues, Section, stack, type TemplateResult, type Translator } from './shared.tsx'

export const roomTypeDetailScreen = (
  _: Translator,
  roomType: RoomTypeDetail,
  properties: PropertyRow[],
  policies: PolicyRow[],
  locale: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
  attempted?: RoomTypeFormValues,
): TemplateResult => {
  const query = `lang=${encodeURIComponent(locale)}`
  const values = attempted ?? roomType
  const propertyName = roomType.property?.name ?? roomType.property?.code ?? roomType.propertyId
  return (
    <FormScreenFrame
      translator={_}
      title={roomType.name}
      frame={frame}
      body={stack([
        roomTypeFeedback(_, status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.roomType.detail.kicker')}
          title={roomType.name}
          subtitle={`${roomType.code} · ${propertyName}`}
          imageFallback={icon('hotel')}
          badges={[
            badge(
              _(roomType.published ? 'hospitality_core.value.published' : 'hospitality_core.value.draft'),
              roomType.published ? 'positive' : 'neutral',
            ),
            badge(
              _(roomType.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive'),
              roomType.active ? 'positive' : 'neutral',
            ),
          ]}
          summary={[
            {
              id: 'rooms',
              label: _('hospitality_core.metric.rooms'),
              value: roomType.rooms?.length ?? 0,
              href: `/admin/hospitality/rooms?property=${encodeURIComponent(roomType.propertyId)}&${query}`,
            },
            {
              id: 'rates',
              label: _('hospitality_core.menu.ratePlans'),
              value: roomType.ratePlans?.length ?? 0,
              href: `/admin/hospitality/rate-plans?property=${encodeURIComponent(roomType.propertyId)}&${query}`,
            },
            {
              id: 'beds',
              label: _('hospitality_core.roomType.metric.beds'),
              value: (roomType.beds ?? []).reduce((sum, bed) => sum + Number(bed.quantity ?? 0), 0),
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.roomType.action.back'),
            href: `/admin/hospitality/room-types?property=${encodeURIComponent(roomType.propertyId)}&${query}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.roomType.section.information')}
              description={_('hospitality_core.roomType.section.informationHint')}
              body={
                <DefinitionList
                  title={roomType.publicName || roomType.name}
                  items={[
                    {
                      key: 'property',
                      term: _('hospitality_core.roomType.field.property'),
                      value: propertyName,
                    },
                    {
                      key: 'capacity',
                      term: _('hospitality_core.roomType.field.defaultCapacity'),
                      value: _('hospitality_core.roomType.value.capacity', {
                        default: roomType.defaultCapacity,
                        adults: roomType.maxAdults,
                        children: roomType.maxChildren,
                      }),
                    },
                    {
                      key: 'rate',
                      term: _('hospitality_core.roomType.field.baseRate'),
                      value: formatMoney(_, roomType.baseRate),
                    },
                    {
                      key: 'policy',
                      term: _('hospitality_core.roomType.field.cancellationPolicy'),
                      value:
                        roomType.cancellationPolicy?.name ??
                        roomType.cancellationPolicy?.code ??
                        _('hospitality_core.roomType.value.inheritPolicy'),
                    },
                  ]}
                />
              }
            />,
            <Section
              title={_('hospitality_core.roomType.section.settings')}
              description={_('hospitality_core.roomType.section.settingsHint')}
              body={roomTypeForm(
                _,
                values,
                properties,
                policies,
                locale,
                `/admin/hospitality/room-types/${encodeURIComponent(roomType.id)}?${query}`,
                _('hospitality_core.roomType.action.save'),
                `/admin/hospitality/room-types?property=${encodeURIComponent(roomType.propertyId)}&${query}`,
                false,
              )}
            />,
            <Section
              title={_('hospitality_core.roomType.section.next')}
              description={_('hospitality_core.roomType.section.nextHint')}
              body={stack(
                [
                  linkButton({
                    label: _('hospitality_core.menu.rooms'),
                    href: `/admin/hospitality/rooms?property=${encodeURIComponent(roomType.propertyId)}&${query}`,
                    variant: 'secondary',
                  }),
                  linkButton({
                    label: _('hospitality_core.menu.ratePlans'),
                    href: `/admin/hospitality/rate-plans?property=${encodeURIComponent(roomType.propertyId)}&${query}`,
                    variant: 'secondary',
                  }),
                  linkButton({
                    label: _('hospitality_core.menu.inventory'),
                    href: `/admin/hospitality/inventory?property=${encodeURIComponent(roomType.propertyId)}&roomType=${encodeURIComponent(roomType.id)}&${query}`,
                    variant: 'secondary',
                  }),
                  linkButton({
                    label: _('hospitality_core.menu.content'),
                    href: `/admin/hospitality/content?property=${encodeURIComponent(roomType.propertyId)}&target=room_type%3A${encodeURIComponent(roomType.id)}&${query}`,
                    variant: 'secondary',
                  }),
                ],
                'compact',
              )}
            />,
          ])}
        />,
      ])}
    />
  )
}
