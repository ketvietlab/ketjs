import { FormScreenFrame } from './page-frame.tsx'
import { badge, dataTable, DefinitionList, emptyState, type FloorDetail, floorForm, type FloorFormValues, type Frame, icon, linkButton, locationFeedback, RecordActions, RecordWorkspace, roomColumns, Section, stack, Surface, type TemplateResult, type Translator } from './shared.tsx'

export const floorDetailScreen = (
  _: Translator,
  floor: FloorDetail,
  values: FloorFormValues,
  locale: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult => {
  const query = `lang=${encodeURIComponent(locale)}`
  const propertyName = floor.property?.name ?? floor.property?.code ?? floor.propertyId
  const buildingName = floor.building?.name ?? floor.building?.code ?? floor.buildingId
  const activeRooms = floor.rooms.filter((row) => row.active)
  return (
    <FormScreenFrame
      translator={_}
      title={floor.name}
      frame={frame}
      body={stack([
        locationFeedback(_, 'floor', status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.floor.detail.kicker')}
          title={floor.name}
          subtitle={`${floor.code} · ${buildingName}`}
          imageFallback={icon('hotel')}
          badges={[
            badge(
              _(floor.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive'),
              floor.active ? 'positive' : 'neutral',
            ),
          ]}
          summary={[
            { id: 'rooms', label: _('hospitality_core.metric.rooms'), value: activeRooms.length },
            {
              id: 'building',
              label: _('hospitality_core.floor.field.building'),
              value: buildingName,
            },
            {
              id: 'sequence',
              label: _('hospitality_core.floor.field.sequence'),
              value: floor.sequence,
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.floor.action.back'),
            href: `/admin/hospitality/buildings/${encodeURIComponent(floor.buildingId)}?${query}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.floor.section.information')}
              description={_('hospitality_core.floor.section.informationHint')}
              body={
                <DefinitionList
                  title={floor.name}
                  items={[
                    {
                      key: 'property',
                      term: _('hospitality_core.floor.field.property'),
                      value: propertyName,
                    },
                    {
                      key: 'building',
                      term: _('hospitality_core.floor.field.building'),
                      value: buildingName,
                    },
                    { key: 'code', term: _('hospitality_core.floor.field.code'), value: floor.code },
                    {
                      key: 'status',
                      term: _('hospitality_core.col.status'),
                      value: _(
                        floor.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive',
                      ),
                    },
                  ]}
                />
              }
            />,
            <Section
              title={_('hospitality_core.floor.section.settings')}
              description={_('hospitality_core.floor.section.settingsHint')}
              body={floorForm(_, values, locale)}
            />,
            <Section
              title={_('hospitality_core.floor.section.rooms')}
              description={_('hospitality_core.floor.section.roomsHint')}
              body={
                floor.rooms.length
                  ? dataTable(_, {
                      columns: roomColumns(_),
                      rows: floor.rooms,
                      id: (row) => row.id,
                      rowHref: (row) =>
                        `/admin/hospitality/rooms/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
                    })
                  : emptyState(
                      _('hospitality_core.floor.empty.rooms'),
                      _('hospitality_core.floor.empty.roomsHint'),
                    )
              }
            />,
            <Section
              title={_('hospitality_core.floor.section.lifecycle')}
              description={_('hospitality_core.floor.section.lifecycleHint')}
              body={
                <Surface
                  body={
                    <RecordActions
                      action={`/admin/hospitality/levels/${encodeURIComponent(floor.id)}/archive?${query}`}
                      actions={[
                        floor.active
                          ? {
                              value: 'archive',
                              label: _('hospitality_core.floor.action.archive'),
                              variant: 'destructive',
                            }
                          : {
                              value: 'restore',
                              label: _('hospitality_core.floor.action.restore'),
                              variant: 'secondary',
                            },
                      ]}
                    />
                  }
                />
              }
            />,
          ])}
        />,
      ])}
    />
  )
}
