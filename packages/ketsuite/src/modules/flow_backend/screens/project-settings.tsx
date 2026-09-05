import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  dataTable,
  WorkspaceScreen,
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
  /** Name, key and description — the fields only the create form ever offered. */
  profile: FormField[]
  profileErrors?: readonly string[]
  /** Whether this project is archived, so the button offers the other direction. */
  archived: boolean
  /**
   * How many issues in the company carry each tag.
   *
   * Tags are company-scope by design (FLW-DEC-006) and this block sits in a
   * *project's* settings, beside three blocks that really are the project's.
   * The count is what makes the difference visible before somebody archives a
   * tag here and clears it from every project at once.
   */
  tagUsage: Record<string, number>
  /**
   * Who is on this project, and the picker for putting somebody else on it.
   *
   * This block is not configuration in the way the four below it are: it is the
   * list of people for whom this project exists at all. Somebody taken off here
   * stops seeing the project entirely — not a narrower view of it — which is
   * why the block says so in words rather than leaving it to be discovered.
   */
  members: readonly AnyRow[]
  memberPicker: JSXChild
  memberErrors?: readonly string[]
  memberIdempotencyKey: string
  /**
   * The project's own name, and the key for the one command that cannot be
   * taken back.
   *
   * The name is here because the confirmation is to type it: a dialog that
   * only asks "are you sure?" is a dialog people learn to dismiss, and one
   * that makes you copy the name out is one you cannot get through while
   * looking at a different project.
   */
  deleteName: string
  deleteErrors?: readonly string[]
  deleteIdempotencyKey: string
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
    <WorkspaceScreen
      translator={_}
      title={projectName}
      frame={frame}
      body={stack([
        <Section
          title={_('flow_backend.settings.profile')}
          description={_('flow_backend.settings.profileHint')}
          body={stack([
            <RecordForm
              action={options.endpoint}
              hidden={{ action: 'saveProject' }}
              fields={options.profile}
              errors={options.profileErrors}
              submit={_('flow_backend.action.save')}
              submitVariant="primary"
            />,
            // Archiving a project is not deleting it, and it is reversible from
            // the same button — which is why the list needs a way to show
            // archived projects, and why this is not a destructive-only action.
            <RecordForm
              action={options.endpoint}
              hidden={{ action: options.archived ? 'restoreProject' : 'archiveProject' }}
              fields={[]}
              submit={_(
                options.archived ? 'flow_backend.action.restore' : 'flow_backend.settings.archiveProject',
              )}
              submitVariant={options.archived ? 'secondary' : 'destructive'}
              submitSize="compact"
              layout="inline"
            />,
          ])}
        />,
        <Section title={_('flow_backend.settings.brief')} body={options.brief} />,
        <Section
          title={_('flow_backend.settings.members')}
          description={_('flow_backend.settings.membersHint')}
          body={stack([
            options.members.length
              ? dataTable(_, {
                  rows: options.members,
                  id: (row) => String(row.id),
                  columns: [
                    {
                      key: 'userName',
                      label: _('flow_backend.settings.memberUser'),
                      priority: 'primary',
                      cell: (row) => String(row.userName || row.userId),
                    },
                    {
                      key: 'addedAt',
                      label: _('flow_backend.settings.memberSince'),
                      cell: (row) => String(row.addedAt ?? '').slice(0, 10),
                    },
                    {
                      key: 'remove',
                      label: '',
                      align: 'end',
                      cell: (row) => (
                        <RecordForm
                          action={options.endpoint}
                          hidden={{ action: 'removeMember', userId: String(row.userId) }}
                          fields={[]}
                          submit={_('flow_backend.settings.memberRemove')}
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
              action={options.endpoint}
              hidden={{ action: 'addMember', idempotencyKey: options.memberIdempotencyKey }}
              fields={[
                {
                  name: 'userId',
                  label: _('flow_backend.settings.memberUser'),
                  required: true,
                  control: options.memberPicker,
                },
              ]}
              errors={options.memberErrors}
              submit={_('flow_backend.settings.memberAdd')}
              submitVariant="primary"
              submitSize="compact"
            />,
          ])}
        />,
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
          title={_('flow_backend.settings.delete')}
          description={_('flow_backend.settings.deleteHint')}
          body={
            <RecordForm
              action={options.endpoint}
              hidden={{ action: 'deleteProject', idempotencyKey: options.deleteIdempotencyKey }}
              fields={[
                {
                  name: 'confirmName',
                  label: _('flow_backend.settings.deleteConfirm'),
                  required: true,
                  placeholder: options.deleteName,
                  span: 'full',
                },
              ]}
              errors={options.deleteErrors}
              submit={_('flow_backend.settings.deleteAction')}
              submitVariant="destructive"
            />
          }
        />,
        <Section
          title={_('flow_backend.settings.tags')}
          description={_('flow_backend.settings.tagsScope')}
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
                      key: 'usage',
                      label: _('flow_backend.settings.tagUsage'),
                      cell: (row) =>
                        _('flow_backend.settings.tagUsageCount', {
                          count: options.tagUsage[String(row.id)] ?? 0,
                        }),
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
