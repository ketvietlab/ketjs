import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { dataTable, Framed, RecordActions, RecordForm, stack, Surface } from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import type { AnyRow } from './shared.tsx'
import { empty, sprintStateBadge, when } from './shared.tsx'

export const sprintsScreen = (
  _: Translator,
  frame: Frame,
  projectName: string,
  endpoint: string,
  sprints: AnyRow[],
  fields: FormField[],
  errors: string[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={projectName}
    frame={frame}
    body={stack([
      <Surface
        body={
          <RecordForm
            action={endpoint}
            hidden={{ action: 'save' }}
            fields={fields}
            errors={errors}
            submit={_('flow_backend.action.create')}
            submitVariant="primary"
          />
        }
      />,
      sprints.length
        ? dataTable(_, {
            rows: sprints,
            id: (row) => String(row.id),
            columns: [
              {
                key: 'name',
                label: _('flow_backend.field.name'),
                priority: 'primary',
                cell: (row) => String(row.name),
              },
              {
                key: 'state',
                label: _('flow_backend.field.state'),
                cell: (row) => sprintStateBadge(_, row.state),
              },
              {
                key: 'startDate',
                label: _('flow_backend.field.startDate'),
                kind: 'date',
                cell: (row) => when(row.startDate),
              },
              {
                key: 'endDate',
                label: _('flow_backend.field.endDate'),
                kind: 'date',
                cell: (row) => when(row.endDate),
              },
              {
                key: 'actions',
                label: '',
                align: 'end',
                cell: (row) =>
                  row.state === 'planned' ? (
                    <RecordActions
                      action={endpoint}
                      hidden={{ id: String(row.id) }}
                      actions={[
                        { value: 'start', label: _('flow_backend.action.start'), variant: 'secondary' },
                      ]}
                    />
                  ) : row.state === 'active' ? (
                    <RecordActions
                      action={endpoint}
                      hidden={{ id: String(row.id) }}
                      actions={[
                        { value: 'close', label: _('flow_backend.action.close'), variant: 'secondary' },
                      ]}
                    />
                  ) : (
                    '—'
                  ),
              },
            ],
          })
        : empty(_),
    ])}
  />
)
