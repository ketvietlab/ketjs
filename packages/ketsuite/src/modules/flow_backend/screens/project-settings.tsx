import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  dataTable,
  Framed,
  LinkButton,
  modalForm,
  modalWorkspace,
  RecordForm,
  Section,
  stack,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import type { AnyRow } from './shared.tsx'
import { empty } from './shared.tsx'

export type SettingsEditorKind = 'column' | 'type' | 'field' | 'tag'

export type SettingsEditor = {
  kind: SettingsEditorKind
  title: string
  action: string
  closeHref: string
  fields: readonly FormField[]
  errors?: readonly string[]
  recordId: string
  idempotencyKey: string
}

export type SettingsScreenOptions = {
  endpoint: string
  columns: readonly AnyRow[]
  types: readonly AnyRow[]
  fields: readonly AnyRow[]
  tags: readonly AnyRow[]
  createHref: Record<SettingsEditorKind, string>
  editColumnHref: (row: AnyRow) => string
  editTypeHref: (row: AnyRow) => string
  editFieldHref: (row: AnyRow) => string
  editTagHref: (row: AnyRow) => string
  editor?: SettingsEditor
  brief: JSXChild
}

const editAction = (_: Translator, href: string): TemplateResult => (
  <LinkButton label={_('flow_backend.action.edit')} href={href} variant="tertiary" size="compact" />
)

const archiveAction = (_: Translator, endpoint: string, action: string, id: string): TemplateResult => (
  <RecordForm
    action={endpoint}
    hidden={{ action, id }}
    fields={[]}
    submit={_('flow_backend.action.archive')}
    submitVariant="destructive"
    submitSize="compact"
    layout="inline"
  />
)

const createAction = (_: Translator, href: string): TemplateResult => (
  <LinkButton label={_('flow_backend.action.create')} href={href} variant="primary" size="compact" />
)

export const settingsScreen = (
  _: Translator,
  frame: Frame,
  projectName: string,
  options: SettingsScreenOptions,
): TemplateResult => {
  const workspace = (
    <Framed
      translator={_}
      title={projectName}
      frame={frame}
      body={stack([
        <Section title={_('flow_backend.settings.brief')} body={options.brief} />,
        <Section
          title={_('flow_backend.settings.columns')}
          actions={createAction(_, options.createHref.column)}
          body={
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
                      cell: (row) => editAction(_, options.editColumnHref(row)),
                    },
                    {
                      key: 'archive',
                      label: '',
                      align: 'end',
                      cell: (row) =>
                        row.terminalState || row.active === false
                          ? '—'
                          : archiveAction(_, options.endpoint, 'archiveColumn', String(row.id)),
                    },
                  ],
                })
              : empty(_)
          }
        />,
        <Section
          title={_('flow_backend.settings.types')}
          description={_('flow_backend.settings.typesHint')}
          actions={createAction(_, options.createHref.type)}
          body={
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
                      cell: (row) => editAction(_, options.editTypeHref(row)),
                    },
                    {
                      key: 'archive',
                      label: '',
                      align: 'end',
                      cell: (row) => archiveAction(_, options.endpoint, 'archiveType', String(row.id)),
                    },
                  ],
                })
              : empty(_)
          }
        />,
        <Section
          title={_('flow_backend.settings.fields')}
          description={_('flow_backend.settings.fieldsHint')}
          actions={createAction(_, options.createHref.field)}
          body={
            options.fields.length
              ? dataTable(_, {
                  rows: options.fields,
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
                      key: 'kind',
                      label: _('flow_backend.field.kind'),
                      cell: (row) => _(`flow_backend.kind.${String(row.kind)}`),
                    },
                    {
                      key: 'options',
                      label: _('flow_backend.field.options'),
                      cell: (row) =>
                        (((row.config as AnyRow | null)?.options as AnyRow[] | undefined) ?? [])
                          .map((option) => String(option.label ?? option.code))
                          .join(', ') || '—',
                    },
                    {
                      key: 'edit',
                      label: '',
                      align: 'end',
                      cell: (row) => editAction(_, options.editFieldHref(row)),
                    },
                    {
                      key: 'archive',
                      label: '',
                      align: 'end',
                      cell: (row) => archiveAction(_, options.endpoint, 'archiveField', String(row.id)),
                    },
                  ],
                })
              : empty(_)
          }
        />,
        <Section
          title={_('flow_backend.settings.tags')}
          actions={createAction(_, options.createHref.tag)}
          body={
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
                      cell: (row) => editAction(_, options.editTagHref(row)),
                    },
                    {
                      key: 'archive',
                      label: '',
                      align: 'end',
                      cell: (row) => archiveAction(_, options.endpoint, 'archiveTag', String(row.id)),
                    },
                  ],
                })
              : empty(_)
          }
        />,
      ])}
    />
  )
  if (!options.editor) return workspace
  const command = `save${options.editor.kind[0]!.toUpperCase()}${options.editor.kind.slice(1)}`
  return modalWorkspace(
    workspace,
    modalForm({
      id: `flow-settings-${options.editor.kind}`,
      title: options.editor.title,
      closeHref: options.editor.closeHref,
      closeLabel: _('flow_backend.action.cancel'),
      form: {
        id: `flow-settings-${options.editor.kind}-form`,
        scope: `flow-settings-${options.editor.kind}`,
        action: options.editor.action,
        submit: _('flow_backend.action.save'),
        submitVariant: 'primary',
        cancelHref: options.editor.closeHref,
        cancelLabel: _('flow_backend.action.cancel'),
        hidden: {
          action: command,
          id: options.editor.recordId,
          idempotencyKey: options.editor.idempotencyKey,
        },
        fields: options.editor.fields,
        errors: options.editor.errors,
      },
    }),
  )
}
