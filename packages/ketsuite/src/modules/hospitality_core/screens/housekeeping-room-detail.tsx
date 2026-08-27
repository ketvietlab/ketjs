import {
  badge,
  cleaningTaskColumns,
  type CleaningTaskRow,
  dataTable,
  DefinitionList,
  emptyState,
  type Frame,
  Framed,
  housekeepingRoomFeedback,
  icon,
  linkButton,
  RecordForm,
  RecordWorkspace,
  type RoomRow,
  Section,
  stack,
  statusTone,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const housekeepingRoomDetailScreen = (
  _: Translator,
  room: RoomRow,
  tasks: CleaningTaskRow[],
  locale: string,
  timezone: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult => {
  const action = `/admin/hospitality/housekeeping/rooms/${encodeURIComponent(room.id)}?lang=${encodeURIComponent(locale)}`
  const taskQueue = `/admin/hospitality/housekeeping?property=${encodeURIComponent(room.propertyId)}&room=${encodeURIComponent(room.id)}&lang=${encodeURIComponent(locale)}`
  const location = [room.building?.name ?? room.building?.code, room.floor?.name ?? room.floor?.code]
    .filter(Boolean)
    .join(' · ')
  const actions: TemplateResult[] = []

  if (room.status === 'available' || room.status === 'dirty')
    actions.push(
      <Section
        title={_('hospitality_core.housekeeping.rooms.section.service')}
        description={_('hospitality_core.housekeeping.rooms.section.serviceHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.housekeeping.rooms.action.takeOut')}
            submitVariant="destructive"
            hidden={{ operation: 'set-status', expectedStatus: room.status, lang: locale }}
            fields={[
              {
                name: 'status',
                label: _('hospitality_core.housekeeping.rooms.field.targetStatus'),
                type: 'select',
                value: 'maintenance',
                required: true,
                options: ['maintenance', 'out_of_order'].map((value) => ({
                  value,
                  label: _(`hospitality_core.roomStatus.${value}`),
                })),
              },
              {
                name: 'note',
                label: _('hospitality_core.housekeeping.rooms.field.reason'),
                type: 'textarea',
                required: true,
                span: 'full',
              },
            ]}
          />
        }
      />,
    )

  if (room.status === 'maintenance' || room.status === 'out_of_order')
    actions.push(
      <Section
        title={_('hospitality_core.housekeeping.rooms.section.release')}
        description={_('hospitality_core.housekeeping.rooms.section.releaseHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.housekeeping.rooms.action.release')}
            submitVariant="primary"
            hidden={{
              operation: 'set-status',
              expectedStatus: room.status,
              status: 'dirty',
              lang: locale,
            }}
            fields={[]}
          />
        }
      />,
    )

  const currentStay = room.currentStay
  const guest = currentStay?.partner?.name

  return (
    <Framed
      translator={_}
      title={_('hospitality_core.housekeeping.rooms.detail.title', { code: room.code })}
      frame={frame}
      body={stack([
        housekeepingRoomFeedback(_, status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.housekeeping.rooms.detail.kicker')}
          title={room.code}
          subtitle={room.name}
          imageFallback={icon('hotel')}
          badges={[
            badge(_(`hospitality_core.roomStatus.${room.status}`), statusTone(room.status), room.status),
          ]}
          summary={[
            {
              id: 'room-type',
              label: _('hospitality_core.col.roomType'),
              value: room.roomType?.name ?? room.roomType?.code ?? room.roomTypeId,
            },
            {
              id: 'capacity',
              label: _('hospitality_core.col.capacity'),
              value: room.capacity,
            },
            {
              id: 'tasks',
              label: _('hospitality_core.housekeeping.rooms.metric.openTasks'),
              value: tasks.filter((task) => task.state === 'todo' || task.state === 'in_progress').length,
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.housekeeping.rooms.action.back'),
            href: `/admin/hospitality/housekeeping/rooms?property=${encodeURIComponent(room.propertyId)}&lang=${encodeURIComponent(locale)}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.housekeeping.rooms.section.information')}
              description={_('hospitality_core.housekeeping.rooms.section.informationHint')}
              body={stack([
                <DefinitionList
                  title={room.name}
                  items={[
                    {
                      key: 'property',
                      term: _('hospitality_core.menu.properties'),
                      value: room.property?.name ?? room.property?.code ?? room.propertyId,
                    },
                    {
                      key: 'room-type',
                      term: _('hospitality_core.col.roomType'),
                      value: room.roomType?.name ?? room.roomType?.code ?? room.roomTypeId,
                    },
                    {
                      key: 'location',
                      term: _('hospitality_core.col.location'),
                      value: location || '—',
                    },
                    {
                      key: 'guest',
                      term: _('hospitality_core.reservation.field.guest'),
                      value: guest ?? '—',
                    },
                    {
                      key: 'note',
                      term: _('hospitality_core.housekeeping.field.notes'),
                      value: room.note || '—',
                    },
                  ]}
                />,
                currentStay?.id
                  ? linkButton({
                      label: _('hospitality_core.housekeeping.rooms.action.openStay'),
                      href: `/admin/hospitality/stays/${encodeURIComponent(currentStay.id)}?lang=${encodeURIComponent(locale)}`,
                      variant: 'secondary',
                    })
                  : null,
              ])}
            />,
            <Section
              title={_('hospitality_core.housekeeping.rooms.section.tasks')}
              description={_('hospitality_core.housekeeping.rooms.section.tasksHint')}
              body={stack([
                tasks.length
                  ? dataTable(_, {
                      columns: cleaningTaskColumns(_, locale, timezone),
                      rows: tasks,
                      id: (task) => task.id,
                      rowHref: (task) =>
                        `/admin/hospitality/housekeeping/tasks/${encodeURIComponent(task.id)}?lang=${encodeURIComponent(locale)}`,
                    })
                  : emptyState(
                      _('hospitality_core.housekeeping.rooms.empty.tasks'),
                      _('hospitality_core.housekeeping.rooms.empty.tasksHint'),
                    ),
                linkButton({
                  label: _('hospitality_core.housekeeping.action.create'),
                  href: taskQueue,
                  variant: 'secondary',
                }),
              ])}
            />,
            ...actions,
          ])}
        />,
      ])}
    />
  )
}
