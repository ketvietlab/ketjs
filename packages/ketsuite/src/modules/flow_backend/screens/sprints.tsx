import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  dataTable,
  ListScreen,
  LinkButton,
  modalForm,
  modalWorkspace,
  Notice,
  RecordActions,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import type { AnyRow } from './shared.tsx'
import { empty, sprintStateBadge, when } from './shared.tsx'

export type SprintCreateValues = { name?: string; startDate?: string; endDate?: string }

export const sprintCreateFields = (_: Translator, values: SprintCreateValues = {}): FormField[] => [
  { name: 'name', label: _('flow_backend.field.name'), value: values.name ?? '', required: true },
  {
    name: 'startDate',
    label: _('flow_backend.field.startDate'),
    type: 'date',
    value: values.startDate ?? '',
  },
  { name: 'endDate', label: _('flow_backend.field.endDate'), type: 'date', value: values.endDate ?? '' },
]

export type SprintsScreenOptions = {
  projectName: string
  sprints: readonly AnyRow[]
  action: string
  createHref: string
  closeHref: string
  createOpen?: boolean
  createValues?: SprintCreateValues
  createErrors?: readonly string[]
  errors?: readonly string[]
  recordId: string
  idempotencyKey: string
  transitionKey: (sprint: AnyRow) => string
}

export const sprintsScreen = (_: Translator, frame: Frame, options: SprintsScreenOptions): TemplateResult => {
  const workspace = (
    <ListScreen
      translator={_}
      title={options.projectName}
      subtitle={_('flow_backend.menu.sprints')}
      frame={frame}
      actions={
        <LinkButton label={_('flow_backend.action.create')} href={options.createHref} variant="primary" />
      }
      body={
        <>
          {options.errors?.length ? (
            <Notice
              tone="danger"
              title={_('flow_backend.error.invalid')}
              message={options.errors.join(' · ')}
            />
          ) : null}
          {options.sprints.length
            ? dataTable(_, {
                rows: options.sprints,
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
                    kind: 'status',
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
                      row.state === 'planned' || row.state === 'active' ? (
                        <RecordActions
                          action={options.action}
                          hidden={{ id: String(row.id), idempotencyKey: options.transitionKey(row) }}
                          actions={[
                            row.state === 'planned'
                              ? {
                                  value: 'start',
                                  label: _('flow_backend.action.start'),
                                  variant: 'secondary' as const,
                                }
                              : {
                                  value: 'close',
                                  label: _('flow_backend.action.close'),
                                  variant: 'secondary' as const,
                                },
                          ]}
                        />
                      ) : (
                        '—'
                      ),
                  },
                ],
              })
            : empty(_)}
        </>
      }
    />
  )
  if (!options.createOpen) return workspace
  return modalWorkspace(
    workspace,
    modalForm({
      id: 'flow-sprint-create',
      title: _('flow_backend.action.create'),
      description: options.projectName,
      closeHref: options.closeHref,
      closeLabel: _('flow_backend.action.cancel'),
      form: {
        id: 'flow-sprint-create-form',
        scope: 'flow-sprint-create',
        action: options.action,
        submit: _('flow_backend.action.create'),
        submitVariant: 'primary',
        cancelHref: options.closeHref,
        cancelLabel: _('flow_backend.action.cancel'),
        hidden: { action: 'save', id: options.recordId, idempotencyKey: options.idempotencyKey },
        fields: sprintCreateFields(_, options.createValues),
        errors: options.createErrors,
      },
    }),
  )
}
