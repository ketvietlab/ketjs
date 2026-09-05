import { FormScreenFrame } from './page-frame.tsx'
import {
  badge,
  type BranchChoice,
  DefinitionList,
  type Frame,
  icon,
  linkButton,
  type PolicyRow,
  type PropertyDetail,
  propertyFeedback,
  propertyForm,
  type PropertyFormValues,
  RecordWorkspace,
  Section,
  stack,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const propertyDetailScreen = (
  _: Translator,
  property: PropertyDetail,
  policies: readonly PolicyRow[],
  branches: readonly BranchChoice[],
  locale: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
  attempted?: PropertyFormValues,
): TemplateResult => {
  const query = `lang=${encodeURIComponent(locale)}`
  const values = attempted ?? property
  const rooms = property.rooms ?? []
  return (
    <FormScreenFrame
      translator={_}
      title={property.name}
      frame={frame}
      body={stack([
        propertyFeedback(_, status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.property.detail.kicker')}
          title={property.name}
          subtitle={`${property.code} · ${property.publicName || property.name}`}
          imageFallback={icon('hotel')}
          badges={[
            badge(_(`hospitality_core.accommodation.${property.accommodationType}`), 'info'),
            badge(
              _(property.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive'),
              property.active ? 'positive' : 'neutral',
            ),
          ]}
          summary={[
            {
              id: 'rooms',
              label: _('hospitality_core.metric.rooms'),
              value: rooms.length,
              href: `/admin/hospitality/rooms?property=${encodeURIComponent(property.id)}&${query}`,
            },
            {
              id: 'room-types',
              label: _('hospitality_core.menu.roomTypes'),
              value: property.roomTypes?.length ?? 0,
              href: `/admin/hospitality/room-types?property=${encodeURIComponent(property.id)}&${query}`,
            },
            {
              id: 'buildings',
              label: _('hospitality_core.property.metric.buildings'),
              value: property.buildings?.length ?? 0,
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.property.action.back'),
            href: `/admin/hospitality/properties?${query}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.property.section.information')}
              description={_('hospitality_core.property.section.informationHint')}
              body={
                <DefinitionList
                  title={property.publicName || property.name}
                  items={[
                    {
                      key: 'address',
                      term: _('hospitality_core.property.field.address'),
                      value: property.addressLine || '—',
                    },
                    {
                      key: 'timezone',
                      term: _('hospitality_core.property.field.timezone'),
                      value: property.timezone,
                    },
                    {
                      key: 'check-in',
                      term: _('hospitality_core.property.field.defaultCheckIn'),
                      value: property.defaultCheckIn,
                    },
                    {
                      key: 'check-out',
                      term: _('hospitality_core.property.field.defaultCheckOut'),
                      value: property.defaultCheckOut,
                    },
                    {
                      key: 'policy',
                      term: _('hospitality_core.property.field.defaultCancellationPolicy'),
                      value:
                        property.defaultCancellationPolicy?.name ??
                        property.defaultCancellationPolicy?.code ??
                        _('hospitality_core.property.value.noDefaultPolicy'),
                    },
                  ]}
                />
              }
            />,
            <Section
              title={_('hospitality_core.property.section.settings')}
              description={_('hospitality_core.property.section.settingsHint')}
              body={propertyForm(
                _,
                values,
                policies,
                branches,
                locale,
                `/admin/hospitality/properties/${encodeURIComponent(property.id)}?${query}`,
                _('hospitality_core.property.action.save'),
                `/admin/hospitality/properties?${query}`,
              )}
            />,
            <Section
              title={_('hospitality_core.property.section.next')}
              description={_('hospitality_core.property.section.nextHint')}
              body={stack(
                [
                  linkButton({
                    label: _('hospitality_core.menu.roomTypes'),
                    href: `/admin/hospitality/room-types?property=${encodeURIComponent(property.id)}&${query}`,
                    variant: 'secondary',
                  }),
                  linkButton({
                    label: _('hospitality_core.menu.rooms'),
                    href: `/admin/hospitality/rooms?property=${encodeURIComponent(property.id)}&${query}`,
                    variant: 'secondary',
                  }),
                  linkButton({
                    label: _('hospitality_core.menu.inventory'),
                    href: `/admin/hospitality/inventory?property=${encodeURIComponent(property.id)}&${query}`,
                    variant: 'secondary',
                  }),
                  linkButton({
                    label: _('hospitality_core.menu.content'),
                    href: `/admin/hospitality/content?property=${encodeURIComponent(property.id)}&${query}`,
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
