import { ListScreenFrame } from './page-frame.tsx'
import {
  CardGrid,
  choices,
  cleaningTaskColumns,
  type CleaningTaskRow,
  type CleaningTaskSummary,
  dataTable,
  cleaningTone,
  emptyState,
  type Frame,
  linkButton,
  Metric,
  modalForm,
  modalWorkspace,
  Notice,
  type PropertyRow,
  RecordForm,
  type RoomRow,
  Section,
  stack,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

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
  modal?: {
    open: boolean
    createHref: string
    closeHref: string
    action: string
    errors?: readonly string[]
    values?: Record<string, string>
  },
  canCreate = true,
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

  const list = (
    <ListScreenFrame
      translator={_}
      title={_('hospitality_core.screen.cleaningTasks.title')}
      frame={frame}
      actions={
        canCreate && data.rooms.length
          ? linkButton({
              label: _('hospitality_core.housekeeping.action.create'),
              href: modal?.createHref ?? '/admin/hospitality/housekeeping?create=1',
              variant: 'primary',
            })
          : undefined
      }
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
              tone={cleaningTone(item.state)}
            />
          )}
        />,
        data.rooms.length
          ? null
          : emptyState(
              _('hospitality_core.housekeeping.empty.rooms'),
              _('hospitality_core.housekeeping.empty.roomsHint'),
            ),
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
  if (!canCreate || !modal?.open || !data.rooms.length) return list
  return modalWorkspace(
    list,
    modalForm({
      id: 'hospitality-cleaning-task-create',
      title: _('hospitality_core.housekeeping.section.create'),
      description: _('hospitality_core.housekeeping.section.createHint'),
      closeHref: modal.closeHref,
      closeLabel: _('hospitality_core.action.cancel'),
      presentation: 'dialog',
      size: 'large',
      form: {
        id: 'hospitality-cleaning-task-create-form',
        scope: 'hospitality-cleaning-task-create',
        action: modal.action || action,
        submit: _('hospitality_core.housekeeping.action.create'),
        submitVariant: 'primary',
        errors: modal.errors,
        cancelHref: modal.closeHref,
        cancelLabel: _('hospitality_core.action.cancel'),
        hidden: {
          operation: 'create',
          lang: locale,
          id: data.id,
          code: data.code,
          propertyId: data.propertyId ?? '',
          state: data.state,
        },
        fields: [
          {
            name: 'roomId',
            label: _('hospitality_core.col.room'),
            type: 'select',
            value: modal.values?.roomId ?? data.selectedRoomId,
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
            value: modal.values?.taskType ?? 'daily_clean',
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
            value: modal.values?.priority ?? 'normal',
            required: true,
            options: ['normal', 'urgent'].map((value) => ({
              value,
              label: _(`hospitality_core.cleaningPriority.${value}`),
            })),
          },
          {
            name: 'assigneeId',
            label: _('hospitality_core.col.assignee'),
            value: modal.values?.assigneeId,
            help: _('hospitality_core.housekeeping.field.assigneeHint'),
          },
          {
            name: 'notes',
            label: _('hospitality_core.housekeeping.field.notes'),
            type: 'textarea',
            value: modal.values?.notes,
            span: 'full',
          },
        ],
      },
    }),
  )
}
