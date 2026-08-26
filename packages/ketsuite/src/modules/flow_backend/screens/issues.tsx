import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { dataTable, Framed, linkButton, Progress, RecordForm, stack, Surface } from '../../../ui/index.ts'
import type { FormField, Frame, TableGroup } from '../../../ui/index.ts'
import type { AnyRow } from './shared.tsx'
import { empty, priorityBadge, when } from './shared.tsx'

export const issuesScreen = (
  _: Translator,
  frame: Frame,
  projectName: string,
  endpoint: string,
  createFields: FormField[],
  rows: AnyRow[],
  groups: TableGroup<AnyRow>[] = [],
  errors: string[] = [],
  /** This project's custom fields, each becoming a column of its own. */
  fields: AnyRow[] = [],
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
            fields={createFields}
            errors={errors}
            submit={_('flow_backend.action.create')}
            submitVariant="primary"
            layout="inline"
          />
        }
      />,
      rows.length || groups.length
        ? dataTable(_, {
            rows,
            groups,
            id: (row) => String(row.id),
            columns: [
              {
                key: 'title',
                label: _('flow_backend.field.title'),
                priority: 'primary',
                cell: (row) =>
                  linkButton({
                    href: `/admin/flow/issues/${String(row.id)}`,
                    label: String(row.title),
                    variant: 'tertiary',
                    size: 'compact',
                  }),
              },
              {
                key: 'column',
                label: _('flow_backend.field.column'),
                cell: (row) => String(row.columnName ?? '—'),
              },
              {
                key: 'assignee',
                label: _('flow_backend.field.assignee'),
                cell: (row) => String(row.assigneeName ?? '—'),
              },
              {
                key: 'priority',
                label: _('flow_backend.field.priority'),
                cell: (row) => priorityBadge(_, row.priority),
              },
              {
                key: 'dueDate',
                label: _('flow_backend.field.dueDate'),
                kind: 'date',
                cell: (row) => when(row.dueDate),
              },
              // One column per field the project defined, after everything Flow
              // itself asks about. A select shows the option's label rather
              // than its code — the code is what the filter speaks, not what
              // anybody named it.
              ...fields.map((field) => ({
                key: `field:${String(field.code)}`,
                label: String(field.name),
                cell: (row: AnyRow) => {
                  const held = (row.fieldValues as Record<string, unknown> | undefined)?.[String(field.id)]
                  if (held == null || held === '') return '\u2014'
                  const options = ((field.config as AnyRow | null)?.options as AnyRow[] | undefined) ?? []
                  const chosen = options.find((option) => String(option.code) === String(held))
                  return String(chosen?.label ?? held)
                },
              })),
              {
                key: 'progress',
                label: _('flow_backend.field.progress'),
                cell: (row) => (
                  <Progress
                    value={row.progress == null ? null : Number(row.progress)}
                    label={_('flow_backend.field.progress')}
                    text={
                      row.progress == null
                        ? null
                        : `${String(row.subtaskDone ?? 0)}/${String(row.subtaskTotal ?? 0)}`
                    }
                  />
                ),
              },
            ],
          })
        : empty(_),
    ])}
  />
)
