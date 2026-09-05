import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  Breadcrumbs,
  button,
  FormCluster,
  FormPage,
  inline,
  linkButton,
  modalForm,
  modalWorkspace,
  Notice,
  RecordForm,
  RecordList,
  RecordMore,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'
import type { AnyRow } from './shared.tsx'
import { empty } from './shared.tsx'

export type PageDetailAction = 'save' | 'addChild' | 'move' | 'orderUp' | 'orderDown' | 'archive' | 'restore'

export type PageDetailScreenOptions = {
  page: AnyRow
  editor: JSXChild
  titleFields: FormField[]
  childFields: FormField[]
  moveFields: FormField[]
  locale?: string
  dialog?: 'addChild' | 'move'
  childId: string
  idempotencyKey?: string
  orderUpIdempotencyKey: string
  orderDownIdempotencyKey: string
  errors?: { action: PageDetailAction; messages: readonly string[] }
}

/**
 * A FormPage record shell around a specialized Live Doc workflow.
 *
 * The editor remains the joint-provided island. Only adding a child and moving
 * the page are short contextual forms, so those open as route-owned modals;
 * title save, sibling nudges and archive keep their existing write endpoints.
 */
export const pageDetailScreen = (
  _: Translator,
  frame: Frame,
  options: PageDetailScreenOptions,
): TemplateResult => {
  const page = options.page
  const trail = (page.trail as Array<{ id: string; title: string }> | undefined) ?? []
  const children = (page.children as AnyRow[] | undefined) ?? []
  const projectId = String(page.projectId)
  const locale = options.locale ?? ''
  const endpoint = localized(`/admin/flow/pages/${encodeURIComponent(String(page.id))}`, locale)
  const projectHref = localized(`/admin/flow/projects/${encodeURIComponent(projectId)}/pages`, locale)
  const dialogHref = (dialog: 'addChild' | 'move'): string => {
    const target = new URL(endpoint, 'http://ket.local')
    target.searchParams.set('dialog', dialog)
    return `${target.pathname}${target.search}`
  }
  const errorsFor = (action: PageDetailAction): readonly string[] | undefined =>
    options.errors?.action === action ? options.errors.messages : undefined
  const activeDialog =
    options.dialog ??
    (options.errors?.action === 'addChild' || options.errors?.action === 'move'
      ? options.errors.action
      : undefined)
  const idempotent = (hidden: Record<string, string>): Record<string, string> =>
    options.idempotencyKey ? { ...hidden, idempotencyKey: options.idempotencyKey } : hidden
  const formId = 'flow-page-detail-form'

  const orderUp = (
    <RecordForm
      action={endpoint}
      hidden={{ action: 'orderUp', idempotencyKey: options.orderUpIdempotencyKey }}
      fields={[]}
      submit={_('flow_backend.pages.orderUp')}
      submitVariant="tertiary"
      submitSize="compact"
      layout="inline"
    />
  )
  const orderDown = (
    <RecordForm
      action={endpoint}
      hidden={{ action: 'orderDown', idempotencyKey: options.orderDownIdempotencyKey }}
      fields={[]}
      submit={_('flow_backend.pages.orderDown')}
      submitVariant="tertiary"
      submitSize="compact"
      layout="inline"
    />
  )
  // Both directions from one place. `page.restore` has always existed and has
  // always handled the archived-parent case; no screen ever offered it, so
  // pressing Archive was how a document left every screen for good.
  const archived = page.active === false
  const archive = (
    <RecordForm
      action={endpoint}
      hidden={{ action: archived ? 'restore' : 'archive' }}
      fields={[]}
      submit={_(archived ? 'flow_backend.action.restore' : 'flow_backend.action.archive')}
      submitVariant={archived ? 'secondary' : 'destructive'}
      submitSize="compact"
      layout="inline"
    />
  )
  const pageView = (
    <FormPage
      variant="operational"
      frame={frame}
      scope="flow-page-detail-form-page"
      title={String(page.title ?? '')}
      description={String(page.projectName ?? '')}
      actions={inline([
        <FormCluster
          label={_('flow_backend.pages.document')}
          forms={[
            button({
              label: _('flow_backend.action.save'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('flow_backend.pages.addChild'),
              href: dialogHref('addChild'),
              variant: 'secondary',
            }),
            linkButton({
              label: _('flow_backend.pages.move'),
              href: dialogHref('move'),
              variant: 'secondary',
            }),
            <RecordMore
              label={_('flow_backend.action.more')}
              body={
                <FormCluster
                  label={_('flow_backend.action.more')}
                  forms={[
                    orderUp,
                    orderDown,
                    linkButton({
                      href: projectHref,
                      label: _('flow_backend.pages.backToList'),
                      variant: 'tertiary',
                    }),
                    archive,
                  ]}
                />
              }
            />,
          ]}
        />,
        frame.extras?.['topbar.end'] ?? '',
      ])}
      navigation={
        <Breadcrumbs
          label={_('flow_backend.pages.trail')}
          items={[
            { label: String(page.projectName ?? ''), href: projectHref },
            ...trail.map((step) => ({
              label: step.title,
              href: localized(`/admin/flow/pages/${encodeURIComponent(step.id)}`, locale),
            })),
            { label: String(page.title ?? '') },
          ]}
        />
      }
      body={stack([
        options.errors && !['save', 'addChild', 'move'].includes(options.errors.action) ? (
          <Notice
            tone="danger"
            title={_('flow_backend.error.invalid')}
            message={options.errors.messages.join(' · ')}
          />
        ) : null,
        <Surface
          body={
            <RecordForm
              id={formId}
              scope="flow-page-detail"
              action={endpoint}
              hidden={idempotent({
                action: 'save',
                expectedVersion: String(page.version ?? 0),
              })}
              fields={options.titleFields}
              errors={errorsFor('save')}
              submit={_('flow_backend.action.save')}
              submitVariant="primary"
              submitPlacement="external"
            />
          }
        />,
        <Section title={_('flow_backend.pages.document')} body={options.editor} />,
        <Section
          title={_('flow_backend.pages.children')}
          body={
            children.length ? (
              <RecordList
                rows={children}
                id={(child) => String(child.id)}
                title={(child) => String(child.title ?? '')}
                href={(child) =>
                  localized(`/admin/flow/pages/${encodeURIComponent(String(child.id))}`, locale)
                }
                summary={(child) =>
                  String(child.previewText ?? '').slice(0, 140) || _('flow_backend.pages.emptyDocument')
                }
              />
            ) : (
              empty(_)
            )
          }
        />,
      ])}
      slots={{ header: 'flow.page-header', body: 'flow.page-body' }}
    />
  )
  const workspace = shell(_, String(page.title ?? ''), pageView, {
    ...frame,
    topbar: false,
    titled: false,
  })
  if (!activeDialog) return workspace
  const adding = activeDialog === 'addChild'
  return modalWorkspace(
    workspace,
    modalForm({
      id: `flow-page-${activeDialog}`,
      title: _(adding ? 'flow_backend.pages.addChild' : 'flow_backend.pages.move'),
      description: String(page.title ?? ''),
      closeHref: endpoint,
      closeLabel: _('flow_backend.action.cancel'),
      form: {
        id: `flow-page-${activeDialog}-form`,
        scope: `flow-page-${activeDialog}`,
        action: dialogHref(activeDialog),
        submit: _(adding ? 'flow_backend.pages.addChild' : 'flow_backend.pages.moveSubmit'),
        submitVariant: 'primary',
        cancelHref: endpoint,
        cancelLabel: _('flow_backend.action.cancel'),
        hidden: adding ? idempotent({ action: 'addChild', childId: options.childId }) : { action: 'move' },
        fields: adding ? options.childFields : options.moveFields,
        errors: errorsFor(activeDialog),
      },
    }),
  )
}
