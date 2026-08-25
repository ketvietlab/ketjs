import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  Breadcrumbs,
  DocTree,
  Framed,
  RecordForm,
  RecordList,
  Section,
  Surface,
  linkButton,
  stack,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import type { AnyRow } from './shared.tsx'
import { empty } from './shared.tsx'

/**
 * The project's documents, as the hierarchy they form.
 *
 * `DocTree` nests the markup rather than indenting a flat list, so a page that
 * sits under another says so to a screen reader and not only to the eye. Rows
 * arrive flat from `page.list` — there is no recursive read — and the tree is
 * assembled from `parentPageId` inside the component.
 */
export const pagesScreen = (
  _: Translator,
  frame: Frame,
  projectName: string,
  endpoint: string,
  pages: readonly AnyRow[],
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
            submit={_('flow_backend.pages.create')}
            submitVariant="primary"
          />
        }
      />,
      pages.length ? (
        <Section
          title={_('flow_backend.pages.title')}
          body={
            <DocTree
              rows={pages}
              id={(page) => String(page.id)}
              parent={(page) => (page.parentPageId ? String(page.parentPageId) : null)}
              title={(page) => String(page.title ?? '')}
              href={(page) => `/admin/flow/pages/${String(page.id)}`}
              summary={(page) =>
                String(page.previewText ?? '').slice(0, 140) ||
                _('flow_backend.pages.emptyDocument')
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
      ),
    ])}
  />
)

/**
 * Every document the reader can see, across projects.
 *
 * Flat, not a tree: pages from different projects have no shared root, so the
 * hierarchy that makes sense inside one project is noise across all of them.
 * The project's name is the summary, which is the thing you actually need to
 * tell two similarly-titled docs apart.
 */
export const allPagesScreen = (
  _: Translator,
  frame: Frame,
  title: string,
  pages: readonly AnyRow[],
): TemplateResult => (
  <Framed
    translator={_}
    title={title}
    frame={frame}
    body={stack([
      pages.length ? (
        <Section
          title={_('flow_backend.pages.title')}
          body={
            <RecordList
              rows={pages}
              id={(page) => String(page.id)}
              title={(page) => String(page.title ?? '')}
              href={(page) => `/admin/flow/pages/${String(page.id)}`}
              summary={(page) =>
                String(page.previewText ?? '').slice(0, 140) ||
                _('flow_backend.pages.emptyDocument')
              }
              value={(page) => String(page.projectName ?? '')}
            />
          }
        />
      ) : (
        empty(_)
      ),
    ])}
  />
)

/**
 * One page: where it sits, its title, its document, and what hangs off it.
 *
 * The editor is placed through a joint rather than written here, the same way
 * the issue screen places it — the island belongs to Live Doc, and this screen
 * only knows where it goes.
 */
export const pageDetailScreen = (
  _: Translator,
  frame: Frame,
  page: AnyRow,
  endpoint: string,
  editor: JSXChild,
  titleFields: FormField[],
  childFields: FormField[],
  moveFields: FormField[],
  errors: string[] = [],
): TemplateResult => {
  const trail = (page.trail as Array<{ id: string; title: string }> | undefined) ?? []
  const children = (page.children as AnyRow[] | undefined) ?? []
  const projectId = String(page.projectId)
  return (
    <Framed
      translator={_}
      title={String(page.title ?? '')}
      frame={frame}
      body={stack([
        <Breadcrumbs
          label={_('flow_backend.pages.trail')}
          items={[
            { label: String(page.projectName ?? ''), href: `/admin/flow/projects/${projectId}/pages` },
            ...trail.map((step) => ({ label: step.title, href: `/admin/flow/pages/${step.id}` })),
            { label: String(page.title ?? '') },
          ]}
        />,
        <Surface
          body={
            <RecordForm
              action={endpoint}
              // The version the reader was shown, so a save made against a
              // stale page is refused rather than overwriting whoever got
              // there first — `savePage`'s compareAndSet reads this.
              hidden={{ action: 'save', expectedVersion: String(page.version ?? 0) }}
              fields={titleFields}
              errors={errors}
              submit={_('flow_backend.action.save')}
              submitVariant="primary"
              layout="inline"
            />
          }
        />,
        <Section title={_('flow_backend.pages.document')} body={editor} />,
        <Section
          title={_('flow_backend.pages.children')}
          body={stack([
            children.length ? (
              <RecordList
                rows={children}
                id={(child) => String(child.id)}
                title={(child) => String(child.title ?? '')}
                href={(child) => `/admin/flow/pages/${String(child.id)}`}
                summary={(child) =>
                  String(child.previewText ?? '').slice(0, 140) ||
                  _('flow_backend.pages.emptyDocument')
                }
              />
            ) : (
              empty(_)
            ),
            <RecordForm
              action={endpoint}
              hidden={{ action: 'addChild' }}
              fields={childFields}
              submit={_('flow_backend.pages.addChild')}
              submitVariant="secondary"
              layout="inline"
            />,
          ])}
        />,
        // Re-parenting is its own action rather than a field on the title form:
        // the title form posts a partial record, and a page moving in the tree
        // is a different decision from renaming it.
        <Section
          title={_('flow_backend.pages.move')}
          body={stack([
            <RecordForm
              action={endpoint}
              hidden={{ action: 'move' }}
              fields={moveFields}
              submit={_('flow_backend.pages.moveSubmit')}
              submitVariant="secondary"
              layout="inline"
            />,
            // Order among siblings, as two nudges rather than a number to
            // type: `sequence` is bookkeeping, and asking a writer to pick one
            // is asking them to know what every neighbour holds.
            <RecordForm
              action={endpoint}
              hidden={{ action: 'orderUp' }}
              fields={[]}
              submit={_('flow_backend.pages.orderUp')}
              submitVariant="tertiary"
              submitSize="compact"
              layout="inline"
            />,
            <RecordForm
              action={endpoint}
              hidden={{ action: 'orderDown' }}
              fields={[]}
              submit={_('flow_backend.pages.orderDown')}
              submitVariant="tertiary"
              submitSize="compact"
              layout="inline"
            />,
          ])}
        />,
        <Surface
          body={stack([
            linkButton({
              href: `/admin/flow/projects/${projectId}/pages`,
              label: _('flow_backend.pages.backToList'),
              variant: 'tertiary',
            }),
            <RecordForm
              action={endpoint}
              hidden={{ action: 'archive' }}
              fields={[]}
              submit={_('flow_backend.action.archive')}
              submitVariant="destructive"
              submitSize="compact"
              layout="inline"
            />,
          ])}
        />,
      ])}
    />
  )
}
