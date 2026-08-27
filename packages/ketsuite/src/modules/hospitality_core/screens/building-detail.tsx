import { FormScreenFrame } from './page-frame.tsx'
import { badge, type BuildingDetail, buildingForm, type BuildingFormValues, dataTable, DefinitionList, emptyState, floorColumns, type Frame, icon, linkButton, locationFeedback, RecordActions, RecordWorkspace, Section, stack, Surface, type TemplateResult, type Translator } from './shared.tsx'

export const buildingDetailScreen = (
  _: Translator,
  building: BuildingDetail,
  values: BuildingFormValues,
  locale: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult => {
  const query = `lang=${encodeURIComponent(locale)}`
  const propertyName = building.property?.name ?? building.property?.code ?? building.propertyId
  const activeFloors = building.floors.filter((row) => row.active)
  const activeRooms = building.rooms.filter((row) => row.active)
  return (
    <FormScreenFrame
      translator={_}
      title={building.name}
      frame={frame}
      body={stack([
        locationFeedback(_, 'building', status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.building.detail.kicker')}
          title={building.name}
          subtitle={`${building.code} · ${propertyName}`}
          imageFallback={icon('hotel')}
          badges={[
            badge(
              _(building.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive'),
              building.active ? 'positive' : 'neutral',
            ),
          ]}
          summary={[
            {
              id: 'floors',
              label: _('hospitality_core.room.metric.floors'),
              value: activeFloors.length,
            },
            { id: 'rooms', label: _('hospitality_core.metric.rooms'), value: activeRooms.length },
            {
              id: 'sequence',
              label: _('hospitality_core.building.field.sequence'),
              value: building.sequence,
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.building.action.back'),
            href: `/admin/hospitality/rooms?property=${encodeURIComponent(building.propertyId)}&${query}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.building.section.information')}
              description={_('hospitality_core.building.section.informationHint')}
              body={
                <DefinitionList
                  title={building.name}
                  items={[
                    {
                      key: 'property',
                      term: _('hospitality_core.building.field.property'),
                      value: propertyName,
                    },
                    { key: 'code', term: _('hospitality_core.building.field.code'), value: building.code },
                    {
                      key: 'status',
                      term: _('hospitality_core.col.status'),
                      value: _(
                        building.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive',
                      ),
                    },
                  ]}
                />
              }
            />,
            <Section
              title={_('hospitality_core.building.section.settings')}
              description={_('hospitality_core.building.section.settingsHint')}
              body={buildingForm(_, values, locale)}
            />,
            <Section
              title={_('hospitality_core.building.section.floors')}
              description={_('hospitality_core.building.section.floorsHint')}
              body={
                building.floors.length
                  ? dataTable(_, {
                      columns: floorColumns(_),
                      rows: building.floors,
                      id: (row) => row.id,
                      rowHref: (row) =>
                        `/admin/hospitality/levels/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
                    })
                  : emptyState(
                      _('hospitality_core.building.empty.floors'),
                      _('hospitality_core.building.empty.floorsHint'),
                    )
              }
            />,
            <Section
              title={_('hospitality_core.building.section.lifecycle')}
              description={_('hospitality_core.building.section.lifecycleHint')}
              body={
                <Surface
                  body={
                    <RecordActions
                      action={`/admin/hospitality/buildings/${encodeURIComponent(building.id)}/archive?${query}`}
                      actions={[
                        building.active
                          ? {
                              value: 'archive',
                              label: _('hospitality_core.building.action.archive'),
                              variant: 'destructive',
                            }
                          : {
                              value: 'restore',
                              label: _('hospitality_core.building.action.restore'),
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
