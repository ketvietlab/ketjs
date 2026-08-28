import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  Framed,
  icon,
  ListPage,
  RecordForm,
  RecordWorkspace,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

type Row = Record<string, unknown>
const closeBadge = (_: Translator, state: unknown) => {
  const value = String(state)
  return badge(
    _(`account_backend.wave1.state.${value}`),
    value === 'hard_closed'
      ? 'positive'
      : value === 'soft_closed'
        ? 'info'
        : value === 'open'
          ? 'warning'
          : 'neutral',
    value,
  )
}

export const periodClosesListScreen = (
  _: Translator,
  options: {
    frame: Frame
    rows: Row[]
    action: string
    fields: FormField[]
    rowHref: (row: Row) => string
    errors?: string[]
  },
): TemplateResult =>
  shell(
    _,
    _('account_backend.close.title'),
    <ListPage
      title={_('account_backend.close.title')}
      description={_('account_backend.close.subtitle')}
      status={`${_('account_backend.close.summary')}: ${String(options.rows.length)}`}
      body={stack(
        [
          <Section
            title={_('account_backend.close.create')}
            description={_('account_backend.close.createHint')}
            body={
              <Surface
                body={
                  <RecordForm
                    id="close-create-form"
                    scope="close-create"
                    action={options.action}
                    submit={_('account_backend.close.create')}
                    submitVariant="secondary"
                    fields={options.fields}
                    errors={options.errors}
                  />
                }
              />
            }
          />,
          options.rows.length ? (
            dataTable(_, {
              rows: options.rows,
              id: (row) => String(row.id),
              rowHref: options.rowHref,
              columns: [
                {
                  key: 'period',
                  label: _('account_backend.close.period'),
                  priority: 'primary',
                  cell: (row) => String(row.periodKey),
                },
                {
                  key: 'range',
                  label: _('account_backend.close.range'),
                  cell: (row) => `${String(row.dateFrom)} – ${String(row.dateTo)}`,
                },
                {
                  key: 'state',
                  label: _('account_backend.field.state'),
                  kind: 'status',
                  cell: (row) => closeBadge(_, row.state),
                },
                {
                  key: 'blockers',
                  label: _('account_backend.close.blockers'),
                  cell: (row) => String(row.blockerCount),
                  align: 'end',
                },
              ],
            })
          ) : (
            <Surface
              padding="compact"
              body={emptyState(_('account_backend.close.empty'), _('account_backend.close.emptyHint'), {
                icon: icon('calendar-check'),
              })}
            />
          ),
        ],
        'loose',
      )}
    />,
    { ...options.frame, chrome: null, topbar: false },
  )

export const periodCloseDetailScreen = (
  _: Translator,
  options: { frame: Frame; period: Row; steps: Row[]; action: string; errors?: string[] },
): TemplateResult => (
  <Framed
    translator={_}
    title={`${_('account_backend.close.period')} ${String(options.period.periodKey)}`}
    frame={options.frame}
    body={
      <RecordWorkspace
        kicker={_('account_backend.close.title')}
        title={`${_('account_backend.close.period')} ${String(options.period.periodKey)}`}
        subtitle={`${String(options.period.dateFrom)} – ${String(options.period.dateTo)}`}
        status={closeBadge(_, options.period.state)}
        imageFallback={icon('calendar-check')}
        summary={[
          {
            id: 'blockers',
            label: _('account_backend.close.blockers'),
            value: String(options.period.blockerCount),
          },
          {
            id: 'version',
            label: _('account_backend.close.version'),
            value: String(options.period.checklistVersion),
          },
          {
            id: 'revision',
            label: _('account_backend.close.revision'),
            value: String(options.period.revision),
          },
        ]}
        body={stack(
          [
            options.errors?.length ? (
              <Section
                title={_('account_backend.close.blocked')}
                body={<Surface padding="compact" body={options.errors.join(' · ')} />}
              />
            ) : null,
            <Section
              title={_('account_backend.close.checklist')}
              description={_('account_backend.close.checklistHint')}
              actions={
                <RecordForm
                  id="close-refresh-form"
                  scope="close-refresh"
                  action={options.action}
                  submit={_('account_backend.close.refresh')}
                  submitVariant="secondary"
                  hidden={{ action: 'refresh' }}
                  fields={[]}
                />
              }
              body={
                <Surface
                  padding="compact"
                  body={dataTable(_, {
                    rows: options.steps,
                    id: (row) => String(row.id ?? row.code),
                    columns: [
                      {
                        key: 'check',
                        label: _('account_backend.close.check'),
                        priority: 'primary',
                        cell: (row) => _(`account_backend.close.check.${String(row.code)}`),
                      },
                      {
                        key: 'required',
                        label: _('account_backend.close.required'),
                        cell: (row) => (row.required ? _('account_backend.yes') : _('account_backend.no')),
                      },
                      {
                        key: 'state',
                        label: _('account_backend.field.state'),
                        kind: 'status',
                        cell: (row) =>
                          badge(
                            _(`account_backend.wave1.state.${String(row.state)}`),
                            row.state === 'passed' ? 'positive' : row.required ? 'danger' : 'neutral',
                          ),
                      },
                      {
                        key: 'detail',
                        label: _('account_backend.close.evidence'),
                        cell: (row) => String(row.detail ?? ''),
                      },
                    ],
                  })}
                />
              }
            />,
            options.period.state === 'hard_closed' ? null : (
              <Section
                title={_('account_backend.close.actions')}
                description={_('account_backend.close.actionsHint')}
                body={stack(
                  [
                    <Surface
                      body={
                        <RecordForm
                          id="close-action-form"
                          scope="close-action"
                          action={options.action}
                          submit={
                            options.period.state === 'soft_closed'
                              ? _('account_backend.close.reopen')
                              : _('account_backend.close.soft')
                          }
                          submitVariant="primary"
                          hidden={{
                            action: options.period.state === 'soft_closed' ? 'reopen' : 'close',
                            mode: 'soft',
                            expectedRevision: String(options.period.revision),
                          }}
                          fields={[
                            {
                              name: 'reason',
                              label: _('account_backend.field.reason'),
                              type: 'textarea',
                              required: true,
                            },
                          ]}
                        />
                      }
                    />,
                    options.period.state === 'soft_closed' ? null : (
                      <Surface
                        body={
                          <RecordForm
                            id="close-hard-form"
                            scope="close-hard"
                            action={options.action}
                            submit={_('account_backend.close.hard')}
                            submitVariant="secondary"
                            hidden={{
                              action: 'close',
                              mode: 'hard',
                              expectedRevision: String(options.period.revision),
                            }}
                            fields={[
                              {
                                name: 'reason',
                                label: _('account_backend.field.reason'),
                                type: 'textarea',
                                required: true,
                              },
                            ]}
                          />
                        }
                      />
                    ),
                  ],
                  'loose',
                )}
              />
            ),
          ],
          'loose',
        )}
      />
    }
  />
)
