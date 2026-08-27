import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  Framed,
  KanbanCard,
  KanbanGrid,
  LinkButton,
  linkButton,
  modalForm,
  modalWorkspace,
  Notice,
  RecordForm,
  Section,
  stack,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'
import type { AnyRow } from './shared.tsx'
import { empty } from './shared.tsx'

export type ProjectEpicCreateValues = {
  title?: string
  color?: string
}

export const projectEpicCreateFields = (_: Translator, values: ProjectEpicCreateValues = {}): FormField[] => [
  {
    name: 'title',
    label: _('flow_backend.field.title'),
    value: values.title ?? '',
    required: true,
  },
  {
    name: 'color',
    label: _('flow_backend.field.color'),
    type: 'color',
    value: values.color ?? '',
  },
]

export type ProjectEpicsScreenOptions = {
  projectName: string
  epics: readonly AnyRow[]
  action: string
  closeHref: string
  createAction: string
  createHref: string
  createOpen?: boolean
  createFields: FormField[]
  createErrors?: readonly string[]
  recordId: string
  idempotencyKey: string
  locale?: string
  errors?: readonly string[]
}

/**
 * Project epics remain a specialized card map rather than a flat table.
 *
 * Each card keeps three distinct paths visible: the epic brief, its filtered
 * backlog, and its dependency map. Creation is the only short contextual form,
 * so it opens over the collection and keeps the project context in view.
 */
export const epicsScreen = (
  _: Translator,
  frame: Frame,
  options: ProjectEpicsScreenOptions,
): TemplateResult => {
  const locale = options.locale ?? ''
  const collection = options.epics.length ? (
    <Section
      title={_('flow_backend.menu.epics')}
      body={
        <KanbanGrid
          rows={options.epics}
          id={(epic) => String(epic.id)}
          card={(epic) => {
            const id = encodeURIComponent(String(epic.id))
            const projectId = encodeURIComponent(String(epic.projectId))
            const count = _('flow_backend.epics.issueCount', {
              count: Number(epic.totalCount ?? 0),
            })
            return (
              <KanbanCard
                key={String(epic.id)}
                title={String(epic.title ?? '')}
                href={localized(`/admin/flow/epics/${id}`, locale)}
                meta={
                  epic.issuesHref
                    ? linkButton({
                        href: localized(String(epic.issuesHref), locale),
                        label: count,
                        variant: 'tertiary',
                        size: 'compact',
                      })
                    : count
                }
                actions={stack(
                  [
                    linkButton({
                      href: localized(`/admin/flow/projects/${projectId}/epics/${id}/map`, locale),
                      label: _('flow_backend.epics.map'),
                      variant: 'tertiary',
                      size: 'compact',
                    }),
                    <RecordForm
                      action={options.action}
                      hidden={{ action: 'archive', id: String(epic.id) }}
                      fields={[]}
                      submit={_('flow_backend.action.archive')}
                      submitVariant="destructive"
                      submitSize="compact"
                      layout="inline"
                    />,
                  ],
                  'compact',
                )}
              />
            )
          }}
        />
      }
    />
  ) : (
    empty(_)
  )
  const workspace = (
    <Framed
      translator={_}
      title={options.projectName}
      subtitle={_('flow_backend.menu.epics')}
      frame={frame}
      actions={
        <LinkButton label={_('flow_backend.action.create')} href={options.createHref} variant="primary" />
      }
      body={stack([
        options.errors?.length ? (
          <Notice
            title={_('flow_backend.error.invalid')}
            message={options.errors.join(' · ')}
            tone="danger"
          />
        ) : null,
        collection,
      ])}
    />
  )
  if (!options.createOpen) return workspace
  return modalWorkspace(
    workspace,
    modalForm({
      id: 'flow-project-epic-create',
      title: _('flow_backend.action.create'),
      description: options.projectName,
      closeHref: options.closeHref,
      closeLabel: _('flow_backend.action.cancel'),
      form: {
        id: 'flow-project-epic-create-form',
        scope: 'flow-project-epic-create',
        action: options.createAction,
        submit: _('flow_backend.action.create'),
        submitVariant: 'primary',
        cancelHref: options.closeHref,
        cancelLabel: _('flow_backend.action.cancel'),
        hidden: {
          action: 'save',
          id: options.recordId,
          idempotencyKey: options.idempotencyKey,
        },
        fields: options.createFields,
        errors: options.createErrors,
      },
    }),
  )
}
