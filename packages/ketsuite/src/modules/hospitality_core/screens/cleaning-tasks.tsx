import { ListScreenFrame } from './page-frame.tsx'
import { CardGrid, choices, cleaningTaskColumns, type CleaningTaskRow, type CleaningTaskSummary, dataTable, emptyState, feedback, type Frame, Metric, Notice, type PropertyRow, RecordForm, type RoomRow, Section, stack, type TemplateResult, type Translator } from './shared.tsx'

export const cleaningTasksScreen = (
  _: Translator,
  data: {
    rows: CleaningTaskRow[]
    properties: PropertyRow[]
    propertyId?: string
    state: string
    rooms: RoomRow[]
    summary: CleaningTaskSummary
    id: string
    code: string
    selectedRoomId?: string
  },
  locale: string,
  timezone: string,
  frame: Frame,
  status?: string | null,
): TemplateResult => {
  const visibleRows = data.state === 'all' ? data.rows : data.rows.filter((row) => row.state === data.state)
  const query = new URLSearchParams({ lang: locale })
  if (data.propertyId) query.set('property', data.propertyId)
  if (data.state !== 'all') query.set('state', data.state)
  const action = `/admin/hospitality/housekeeping?${query.toString()}`
  const feedback =
    status === 'created' ? (
      <Notice
        title={_('hospitality_core.housekeeping.feedback.created')}
        message={_('hospitality_core.housekeeping.feedback.createdHint')}
        tone="positive"
      />
    ) : status === 'invalid' ? (
      <Notice
        title={_('hospitality_core.feedback.invalid')}
        message={_('hospitality_core.housekeeping.feedback.invalidHint')}
        tone="danger"
      />
    ) : null

  return (
    <ListScreenFrame
      translator={_}
      title={_('hospitality_core.screen.cleaningTasks.title')}
      frame={frame}
      body={stack([
        feedback,
        <RecordForm
          action="/admin/hospitality/housekeeping"
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
              options: ['all', 'todo', 'in_progress', 'done', 'cancelled'].map((value) => ({
                value,
                label: _(`hospitality_core.cleaningState.${value}`),
              })),
            },
          ]}
        />,
        <CardGrid
          items={['todo', 'in_progress', 'done'].map((state) => ({
            state,
            count:
              state === 'todo'
                ? data.summary.todo
                : state === 'in_progress'
                  ? data.summary.inProgress
                  : data.summary.done,
          }))}
          id={(item) => item.state}
          card={(item) => (
            <Metric
              label={_(`hospitality_core.cleaningState.${item.state}`)}
              value={String(item.count)}
              tone={item.state}
            />
          )}
        />,
        <Section
          title={_('hospitality_core.housekeeping.section.create')}
          description={_('hospitality_core.housekeeping.section.createHint')}
          body={
            data.rooms.length ? (
              <RecordForm
                action={action}
                method="post"
                submit={_('hospitality_core.housekeeping.action.create')}
                submitVariant="secondary"
                hidden={{
                  operation: 'create',
                  lang: locale,
                  id: data.id,
                  code: data.code,
                  propertyId: data.propertyId ?? '',
                  state: data.state,
                }}
                fields={[
                  {
                    name: 'roomId',
                    label: _('hospitality_core.col.room'),
                    type: 'select',
                    value: data.selectedRoomId,
                    required: true,
                    options: data.rooms.map((room) => ({
                      value: room.id,
                      label: `${room.code} · ${room.name} · ${_(`hospitality_core.roomStatus.${room.status}`)}`,
                    })),
                  },
                  {
                    name: 'taskType',
                    label: _('hospitality_core.col.type'),
                    type: 'select',
                    value: 'daily_clean',
                    required: true,
                    options: ['checkout_clean', 'daily_clean', 'maintenance', 'inspection'].map((value) => ({
                      value,
                      label: _(`hospitality_core.cleaningType.${value}`),
                    })),
                  },
                  {
                    name: 'priority',
                    label: _('hospitality_core.col.priority'),
                    type: 'select',
                    value: 'normal',
                    required: true,
                    options: ['normal', 'urgent'].map((value) => ({
                      value,
                      label: _(`hospitality_core.cleaningPriority.${value}`),
                    })),
                  },
                  {
                    name: 'assigneeId',
                    label: _('hospitality_core.col.assignee'),
                    help: _('hospitality_core.housekeeping.field.assigneeHint'),
                  },
                  {
                    name: 'notes',
                    label: _('hospitality_core.housekeeping.field.notes'),
                    type: 'textarea',
                    span: 'full',
                  },
                ]}
              />
            ) : (
              emptyState(
                _('hospitality_core.housekeeping.empty.rooms'),
                _('hospitality_core.housekeeping.empty.roomsHint'),
              )
            )
          }
        />,
        <Section
          title={_('hospitality_core.housekeeping.section.queue')}
          description={_('hospitality_core.housekeeping.section.queueHint')}
          body={
            visibleRows.length
              ? dataTable(_, {
                  columns: cleaningTaskColumns(_, locale, timezone),
                  rows: visibleRows,
                  id: (row) => row.id,
                  rowHref: (row) =>
                    `/admin/hospitality/housekeeping/tasks/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
                })
              : emptyState(
                  _('hospitality_core.screen.cleaningTasks.empty'),
                  _('hospitality_core.screen.cleaningTasks.emptyHint'),
                )
          }
        />,
      ])}
    />
  )
}
