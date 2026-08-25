import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { dataTable, Framed, linkButton, RecordForm, Section, stack } from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import type { AnyRow } from './shared.tsx'
import { empty } from './shared.tsx'

export const settingsScreen = (
  _: Translator,
  frame: Frame,
  projectName: string,
  endpoint: string,
  options: {
    columns: AnyRow[]
    columnFields: FormField[]
    editingColumnId?: string
    types: AnyRow[]
    typeFields: FormField[]
    editingTypeId?: string
    tags: AnyRow[]
    tagFields: FormField[]
    editingTagId?: string
    /** One error sink per section: a duplicate tag name reported above the
     * columns form reads as a broken column. */
    columnErrors?: string[]
    typeErrors?: string[]
    tagErrors?: string[]
  },
): TemplateResult => (
  <Framed
    translator={_}
    title={projectName}
    frame={frame}
    body={stack([
      <Section
        title={_('flow_backend.settings.columns')}
        body={stack([
          options.columns.length
            ? dataTable(_, {
                rows: options.columns,
                id: (row) => String(row.id),
                columns: [
                  {
                    key: 'sequence',
                    label: _('flow_backend.field.sequence'),
                    cell: (row) => String(row.sequence),
                  },
                  {
                    key: 'name',
                    label: _('flow_backend.field.name'),
                    priority: 'primary',
                    cell: (row) => String(row.name),
                  },
                  {
                    key: 'code',
                    label: _('flow_backend.field.code'),
                    kind: 'identifier',
                    cell: (row) => String(row.code),
                  },
                  {
                    key: 'terminal',
                    label: _('flow_backend.field.terminalState'),
                    cell: (row) => (row.terminalState ? '✓' : '—'),
                  },
                  {
                    key: 'edit',
                    label: '',
                    align: 'end',
                    cell: (row) =>
                      linkButton({
                        href: `?editColumnId=${String(row.id)}`,
                        label: _('flow_backend.action.edit'),
                        variant: 'tertiary',
                        size: 'compact',
                      }),
                  },
                  {
                    key: 'archive',
                    label: '',
                    align: 'end',
                    cell: (row) =>
                      row.terminalState || row.active === false ? (
                        '—'
                      ) : (
                        <RecordForm
                          action={endpoint}
                          hidden={{ action: 'archiveColumn', id: String(row.id) }}
                          fields={[]}
                          submit={_('flow_backend.action.archive')}
                          submitVariant="destructive"
                          submitSize="compact"
                          layout="inline"
                        />
                      ),
                  },
                ],
              })
            : empty(_),
          <RecordForm
            action={endpoint}
            hidden={{ action: 'saveColumn', id: options.editingColumnId ?? '' }}
            fields={options.columnFields}
            errors={options.columnErrors}
            submit={_('flow_backend.action.save')}
            submitVariant="secondary"
          />,
        ])}
      />,
      <Section
        title={_('flow_backend.settings.types')}
        description={_('flow_backend.settings.typesHint')}
        body={stack([
          options.types.length
            ? dataTable(_, {
                rows: options.types,
                id: (row) => String(row.id),
                columns: [
                  {
                    key: 'sequence',
                    label: _('flow_backend.field.sequence'),
                    cell: (row) => String(row.sequence),
                  },
                  {
                    key: 'name',
                    label: _('flow_backend.field.name'),
                    priority: 'primary',
                    cell: (row) => String(row.name),
                  },
                  {
                    key: 'code',
                    label: _('flow_backend.field.code'),
                    kind: 'identifier',
                    cell: (row) => String(row.code),
                  },
                  {
                    key: 'edit',
                    label: '',
                    align: 'end',
                    cell: (row) =>
                      linkButton({
                        href: `?editTypeId=${String(row.id)}`,
                        label: _('flow_backend.action.edit'),
                        variant: 'tertiary',
                        size: 'compact',
                      }),
                  },
                  {
                    key: 'archive',
                    label: '',
                    align: 'end',
                    cell: (row) => (
                      <RecordForm
                        action={endpoint}
                        hidden={{ action: 'archiveType', id: String(row.id) }}
                        fields={[]}
                        submit={_('flow_backend.action.archive')}
                        submitVariant="destructive"
                        submitSize="compact"
                        layout="inline"
                      />
                    ),
                  },
                ],
              })
            : empty(_),
          <RecordForm
            action={endpoint}
            hidden={{ action: 'saveType', id: options.editingTypeId ?? '' }}
            fields={options.typeFields}
            errors={options.typeErrors}
            submit={_('flow_backend.action.save')}
            submitVariant="secondary"
          />,
        ])}
      />,
      <Section
        title={_('flow_backend.settings.tags')}
        body={stack([
          options.tags.length
            ? dataTable(_, {
                rows: options.tags,
                id: (row) => String(row.id),
                columns: [
                  {
                    key: 'name',
                    label: _('flow_backend.field.name'),
                    priority: 'primary',
                    cell: (row) => String(row.name),
                  },
                  {
                    key: 'edit',
                    label: '',
                    align: 'end',
                    cell: (row) =>
                      linkButton({
                        href: `?editTagId=${String(row.id)}`,
                        label: _('flow_backend.action.edit'),
                        variant: 'tertiary',
                        size: 'compact',
                      }),
                  },
                  {
                    key: 'archive',
                    label: '',
                    align: 'end',
                    cell: (row) => (
                      <RecordForm
                        action={endpoint}
                        hidden={{ action: 'archiveTag', id: String(row.id) }}
                        fields={[]}
                        submit={_('flow_backend.action.archive')}
                        submitVariant="destructive"
                        submitSize="compact"
                        layout="inline"
                      />
                    ),
                  },
                ],
              })
            : empty(_),
          <RecordForm
            action={endpoint}
            hidden={{ action: 'saveTag', id: options.editingTagId ?? '' }}
            fields={options.tagFields}
            errors={options.tagErrors}
            submit={_('flow_backend.action.save')}
            submitVariant="secondary"
          />,
        ])}
      />,
    ])}
  />
)
