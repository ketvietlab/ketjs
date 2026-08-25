import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { dataTable, Framed, linkButton, RecordForm, stack, Surface } from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import type { AnyRow } from './shared.tsx'
import { empty } from './shared.tsx'

/** Column-template presets offered when creating a project — see routes.ts's COLUMN_TEMPLATES. */
export const TEMPLATE_OPTIONS = (_: Translator) => [
  { value: 'simple', label: _('flow_backend.template.simple') },
  { value: 'kanban', label: _('flow_backend.template.kanban') },
  { value: 'scrum', label: _('flow_backend.template.scrum') },
  { value: 'custom', label: _('flow_backend.template.custom') },
]

export const projectsScreen = (
  _: Translator,
  frame: Frame,
  rows: AnyRow[],
  fields: FormField[],
  errors: string[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={_('flow_backend.projects.title')}
    frame={frame}
    body={stack([
      <Surface
        body={
          <RecordForm
            action="/admin/flow/projects"
            fields={fields}
            errors={errors}
            submit={_('flow_backend.action.create')}
            submitVariant="primary"
          />
        }
      />,
      rows.length
        ? dataTable(_, {
            rows,
            id: (row) => String(row.id),
            columns: [
              {
                key: 'key',
                label: _('flow_backend.field.key'),
                kind: 'identifier',
                cell: (row) => String(row.key),
              },
              {
                key: 'name',
                label: _('flow_backend.field.name'),
                priority: 'primary',
                cell: (row) =>
                  linkButton({
                    href: `/admin/flow/projects/${String(row.id)}/board`,
                    label: String(row.name),
                    variant: 'tertiary',
                    size: 'compact',
                  }),
              },
              {
                key: 'settings',
                label: '',
                align: 'end',
                cell: (row) =>
                  linkButton({
                    href: `/admin/flow/projects/${String(row.id)}/settings`,
                    label: _('flow_backend.action.settings'),
                    variant: 'tertiary',
                    size: 'compact',
                  }),
              },
            ],
          })
        : empty(_),
    ])}
  />
)
