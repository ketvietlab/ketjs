import type { Row, Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  ContentCard,
  emptyState,
  FormCluster,
  inline,
  linkButton,
  ListPage,
  RecordForm,
  shell,
  stack,
} from '../../../ui/index.ts'
import type { Frame, Tone } from '../../../ui/index.ts'

export type ActivityListRow = Row & { targetHref: string | null }

export type ActivitiesListScreenOptions = {
  rows: readonly ActivityListRow[]
  action: string
  toggleHref: string
  includeDone: boolean
  today: string
}

const tone = (state: string): Tone =>
  state === 'overdue' ? 'danger' : state === 'today' ? 'warning' : state === 'done' ? 'positive' : 'neutral'

export const activitiesScreen = (
  _: Translator,
  frame: Frame,
  options: ActivitiesListScreenOptions,
): TemplateResult => {
  const overdue = options.rows.filter((row) => row.state === 'overdue').length
  const today = options.rows.filter((row) => row.state === 'today').length
  return shell(
    _,
    _('activity_backend.title'),
    <ListPage
      title={_('activity_backend.title')}
      description={_('activity_backend.subtitle')}
      actions={frame.extras?.['topbar.end']}
      status={`${_('activity_backend.title')}: ${String(options.rows.length)}`}
      body={stack([
        inline([
          badge(`${overdue} ${_('activity_backend.overdue')}`, 'danger'),
          badge(`${today} ${_('activity_backend.today')}`, 'warning'),
          linkButton({
            label: options.includeDone ? _('activity_backend.hideDone') : _('activity_backend.showDone'),
            href: options.toggleHref,
            variant: 'tertiary',
          }),
        ]),
        options.rows.length === 0
          ? emptyState(_('activity_backend.empty'), _('activity_backend.emptyHint'))
          : stack(
              options.rows.map((row) => (
                <ContentCard
                  title={String(row.summary)}
                  href={row.targetHref}
                  summary={`${String(row.typeName)} · ${String(row.targetName)} · ${String(row.dueDate)}`}
                  meta={badge(
                    _(`activity_backend.state.${String(row.state)}`),
                    tone(String(row.state)),
                    String(row.state),
                  )}
                  body={row.note ? String(row.note) : undefined}
                  actions={
                    row.active === true ? (
                      <FormCluster
                        forms={[
                          <RecordForm
                            action={options.action}
                            submit={_('activity_backend.complete')}
                            submitVariant="primary"
                            layout="inline"
                            hidden={{ action: 'complete', id: String(row.id), today: options.today }}
                            fields={[
                              {
                                name: 'feedback',
                                label: _('activity_backend.feedback'),
                                value: '',
                              },
                            ]}
                          />,
                          <RecordForm
                            action={options.action}
                            submit={_('activity_backend.reschedule')}
                            submitVariant="secondary"
                            layout="inline"
                            hidden={{ action: 'reschedule', id: String(row.id), today: options.today }}
                            fields={[
                              {
                                name: 'dueDate',
                                label: _('activity_backend.dueDate'),
                                type: 'date',
                                value: String(row.dueDate),
                                required: true,
                              },
                            ]}
                          />,
                          <RecordForm
                            action={options.action}
                            submit={_('activity_backend.cancel')}
                            submitVariant="destructive"
                            layout="inline"
                            hidden={{ action: 'cancel', id: String(row.id), today: options.today }}
                            fields={[]}
                          />,
                        ]}
                      />
                    ) : undefined
                  }
                />
              )),
            ),
      ])}
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
