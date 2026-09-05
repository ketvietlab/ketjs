import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  DocTree,
  inline,
  ListScreen,
  LinkButton,
  modalForm,
  modalWorkspace,
  Section,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'
import type { AnyRow } from './shared.tsx'
import { empty } from './shared.tsx'

export type ProjectPageCreateValues = {
  title?: string
  parentPageId?: string
}

export const projectPageCreateFields = (
  _: Translator,
  pages: readonly AnyRow[],
  values: ProjectPageCreateValues = {},
): FormField[] => {
  const parentPageId = values.parentPageId ?? ''
  const parentOptions = [
    { value: '', label: _('flow_backend.pages.root') },
    ...pages.map((page) => ({ value: String(page.id), label: String(page.title ?? '') })),
  ]
  if (parentPageId && !parentOptions.some((option) => option.value === parentPageId)) {
    parentOptions.unshift({ value: parentPageId, label: parentPageId })
  }
  return [
    {
      name: 'title',
      label: _('flow_backend.pages.name'),
      value: values.title ?? '',
      required: true,
    },
    {
      name: 'parentPageId',
      label: _('flow_backend.pages.parent'),
      type: 'select',
      value: parentPageId,
      options: parentOptions,
    },
  ]
}

export type ProjectPagesScreenOptions = {
  projectName: string
  pages: readonly AnyRow[]
  createHref: string
  /** Where to go to see archived documents, and whether they are showing. */
  archivedHref?: string
  showingArchived?: boolean
  createFields: FormField[]
  createAction: string
  closeHref: string
  locale?: string
  createOpen?: boolean
  errors?: readonly string[]
  recordId: string
  idempotencyKey: string
}

/**
 * The project's documents remain a hierarchy, not a flat ListPage.
 *
 * `DocTree` carries the parent/child semantics in nested markup. The only
 * small contextual form is creation, so it opens over the tree and leaves the
 * hierarchy visible instead of claiming a full route of its own.
 */
export const pagesScreen = (
  _: Translator,
  frame: Frame,
  options: ProjectPagesScreenOptions,
): TemplateResult => {
  const workspace = (
    <ListScreen
      translator={_}
      title={options.projectName}
      subtitle={_('flow_backend.pages.title')}
      frame={frame}
      actions={inline([
        options.archivedHref ? (
          <LinkButton
            label={_(
              options.showingArchived ? 'flow_backend.issue.hideArchived' : 'flow_backend.pages.showArchived',
            )}
            href={options.archivedHref}
            variant="secondary"
          />
        ) : (
          ''
        ),
        <LinkButton label={_('flow_backend.pages.create')} href={options.createHref} variant="primary" />,
      ])}
      body={
        options.pages.length ? (
          <Section
            title={_('flow_backend.pages.title')}
            body={
              <DocTree
                rows={options.pages}
                id={(page) => String(page.id)}
                parent={(page) => (page.parentPageId ? String(page.parentPageId) : null)}
                title={(page) => String(page.title ?? '')}
                href={(page) =>
                  localized(`/admin/flow/pages/${encodeURIComponent(String(page.id))}`, options.locale ?? '')
                }
                summary={(page) =>
                  String(page.previewText ?? '').slice(0, 140) || _('flow_backend.pages.emptyDocument')
                }
                count={(page) =>
                  Number(page.childCount ?? 0) > 0
                    ? _('flow_backend.pages.childCount', { count: Number(page.childCount) })
                    : null
                }
              />
            }
          />
        ) : (
          empty(_)
        )
      }
    />
  )
  if (!options.createOpen) return workspace
  return modalWorkspace(
    workspace,
    modalForm({
      id: 'flow-project-page-create',
      title: _('flow_backend.pages.create'),
      description: options.projectName,
      closeHref: options.closeHref,
      closeLabel: _('flow_backend.action.cancel'),
      form: {
        id: 'flow-project-page-create-form',
        scope: 'flow-project-page-create',
        action: options.createAction,
        submit: _('flow_backend.pages.create'),
        submitVariant: 'primary',
        cancelHref: options.closeHref,
        cancelLabel: _('flow_backend.action.cancel'),
        hidden: { action: 'save', id: options.recordId, idempotencyKey: options.idempotencyKey },
        fields: options.createFields,
        errors: options.errors,
      },
    }),
  )
}
