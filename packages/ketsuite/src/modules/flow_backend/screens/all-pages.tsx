import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { dataTable, linkButton, ListPage, listChrome, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'
import type { AnyRow } from './shared.tsx'
import { empty, when } from './shared.tsx'

export type AllPagesScreenOptions = {
  title: string
  pages: readonly AnyRow[]
  total?: number
  locale?: string
}

/**
 * Every readable document across projects.
 *
 * This is intentionally flat: pages from different projects have no shared
 * root. Project identity is therefore a first-class column and destination,
 * while the Live Doc itself remains behind the page-detail link.
 */
export const allPagesScreen = (
  _: Translator,
  frame: Frame,
  options: AllPagesScreenOptions,
): TemplateResult => {
  const locale = options.locale ?? ''
  return shell(
    _,
    options.title,
    <ListPage
      title={options.title}
      description={_('flow_backend.pages.title')}
      actions={frame.extras?.['topbar.end']}
      controls={
        frame.chrome
          ? listChrome(
              _,
              options.title,
              {
                ...frame.chrome,
                layout: 'command',
                section: undefined,
                create: null,
                selection: null,
              },
              false,
            )
          : undefined
      }
      status={`${options.title}: ${String(options.total ?? options.pages.length)}`}
      body={
        options.pages.length
          ? dataTable(_, {
              rows: options.pages,
              id: (page) => String(page.id),
              rowHref: (page) =>
                localized(`/admin/flow/pages/${encodeURIComponent(String(page.id))}`, locale),
              columns: [
                {
                  key: 'title',
                  label: _('flow_backend.pages.name'),
                  priority: 'primary',
                  cell: (page) =>
                    linkButton({
                      href: localized(`/admin/flow/pages/${encodeURIComponent(String(page.id))}`, locale),
                      label: String(page.title ?? ''),
                      variant: 'tertiary',
                      size: 'compact',
                    }),
                },
                {
                  key: 'project',
                  label: _('flow_backend.field.project'),
                  priority: 'secondary',
                  cell: (page) =>
                    linkButton({
                      href: localized(
                        `/admin/flow/projects/${encodeURIComponent(String(page.projectId))}/pages`,
                        locale,
                      ),
                      label: String(page.projectName ?? '—'),
                      variant: 'tertiary',
                      size: 'compact',
                    }),
                },
                {
                  key: 'preview',
                  label: _('flow_backend.field.description'),
                  cell: (page) =>
                    String(page.previewText ?? '').slice(0, 140) || _('flow_backend.pages.emptyDocument'),
                },
                {
                  key: 'updatedAt',
                  label: _('flow_backend.field.updatedAt'),
                  kind: 'date',
                  cell: (page) => when(page.updatedAt),
                },
              ],
            })
          : empty(_)
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
