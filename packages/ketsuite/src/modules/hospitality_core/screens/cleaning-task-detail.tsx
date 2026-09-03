import { FormScreenFrame } from './page-frame.tsx'
import {
  badge,
  cleaningTaskFeedback,
  type CleaningTaskRow,
  cleaningTone,
  dateTime,
  DefinitionList,
  type Frame,
  icon,
  linkButton,
  RecordForm,
  RecordWorkspace,
  Section,
  stack,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const cleaningTaskDetailScreen = (
  _: Translator,
  task: CleaningTaskRow,
  locale: string,
  timezone: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
  permissions: { start: boolean; complete: boolean; cancel: boolean } = {
    start: true,
    complete: true,
    cancel: true,
  },
): TemplateResult => {
  const action = `/admin/hospitality/housekeeping/tasks/${encodeURIComponent(task.id)}?lang=${encodeURIComponent(locale)}`
  const room = task.room?.name ?? task.room?.code ?? task.roomId
  const actions: TemplateResult[] = []

  if (task.state === 'todo' && permissions.start)
    actions.push(
      <Section
        title={_('hospitality_core.housekeeping.action.start')}
        description={_('hospitality_core.housekeeping.action.startHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.housekeeping.action.start')}
            submitVariant="primary"
            hidden={{ operation: 'start', lang: locale }}
            fields={[
              {
                name: 'assigneeId',
                label: _('hospitality_core.col.assignee'),
                value: task.assigneeId,
                help: _('hospitality_core.housekeeping.field.assigneeHint'),
              },
            ]}
          />
        }
      />,
    )

  if (task.state === 'in_progress' && permissions.complete)
    actions.push(
      <Section
        title={_('hospitality_core.housekeeping.action.complete')}
        description={_('hospitality_core.housekeeping.action.completeHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.housekeeping.action.complete')}
            submitVariant="primary"
            hidden={{ operation: 'complete', lang: locale }}
            fields={[]}
          />
        }
      />,
    )

  if ((task.state === 'todo' || task.state === 'in_progress') && permissions.cancel)
    actions.push(
      <Section
        title={_('hospitality_core.housekeeping.action.cancel')}
        description={_('hospitality_core.housekeeping.action.cancelHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.housekeeping.action.cancel')}
            submitVariant="destructive"
            hidden={{ operation: 'cancel', lang: locale }}
            fields={[]}
          />
        }
      />,
    )

  return (
    <FormScreenFrame
      translator={_}
      title={_('hospitality_core.housekeeping.detail.title', { code: task.code })}
      frame={frame}
      body={stack([
        cleaningTaskFeedback(_, status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.housekeeping.detail.kicker')}
          title={task.code}
          subtitle={room}
          imageFallback={icon('check-circle')}
          badges={[
            badge(_(`hospitality_core.cleaningState.${task.state}`), cleaningTone(task.state), task.state),
            badge(
              _(`hospitality_core.cleaningPriority.${task.priority}`),
              task.priority === 'urgent' ? 'danger' : 'neutral',
            ),
          ]}
          summary={[
            {
              id: 'room',
              label: _('hospitality_core.col.room'),
              value: room,
            },
            {
              id: 'type',
              label: _('hospitality_core.col.type'),
              value: _(`hospitality_core.cleaningType.${task.taskType}`),
            },
            {
              id: 'assignee',
              label: _('hospitality_core.col.assignee'),
              value: task.assigneeId || '—',
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.housekeeping.action.back'),
            href: `/admin/hospitality/housekeeping?property=${encodeURIComponent(task.propertyId)}&lang=${encodeURIComponent(locale)}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.housekeeping.section.information')}
              description={_('hospitality_core.housekeeping.section.informationHint')}
              body={
                <DefinitionList
                  title={task.code}
                  items={[
                    {
                      key: 'property',
                      term: _('hospitality_core.menu.properties'),
                      value: task.property?.name ?? task.property?.code ?? task.propertyId,
                    },
                    {
                      key: 'room',
                      term: _('hospitality_core.col.room'),
                      value: room,
                    },
                    {
                      key: 'requested',
                      term: _('hospitality_core.col.requestedAt'),
                      value: dateTime(task.requestedAt, locale, timezone),
                    },
                    ...(task.startedAt
                      ? [
                          {
                            key: 'started',
                            term: _('hospitality_core.housekeeping.field.startedAt'),
                            value: dateTime(task.startedAt, locale, timezone),
                          },
                        ]
                      : []),
                    ...(task.doneAt
                      ? [
                          {
                            key: 'done',
                            term: _('hospitality_core.housekeeping.field.doneAt'),
                            value: dateTime(task.doneAt, locale, timezone),
                          },
                        ]
                      : []),
                    ...(task.stayId
                      ? [
                          {
                            key: 'stay',
                            term: _('hospitality_core.menu.stays'),
                            value: task.stay?.code ?? task.stayId,
                          },
                        ]
                      : []),
                    ...(task.notes
                      ? [
                          {
                            key: 'notes',
                            term: _('hospitality_core.housekeeping.field.notes'),
                            value: task.notes,
                          },
                        ]
                      : []),
                  ]}
                />
              }
            />,
            ...actions,
          ])}
        />,
      ])}
    />
  )
}
