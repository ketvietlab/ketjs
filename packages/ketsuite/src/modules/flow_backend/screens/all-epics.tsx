import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { dataTable, linkButton, ListPage, listChrome, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'
import type { AnyRow } from './shared.tsx'
import { empty } from './shared.tsx'

export type AllEpicsScreenOptions = {
  title: string
  epics: readonly AnyRow[]
  total?: number
  locale?: string
}

/**
 * Every active epic across projects.
 *
 * Epics from unrelated projects have no shared hierarchy, so this collection
 * stays flat and makes the owning project a first-class destination. The
 * collaborative brief remains behind the epic-detail link.
 */
export const allEpicsScreen = (
  _: Translator,
  frame: Frame,
  options: AllEpicsScreenOptions,
): TemplateResult => {
  const locale = options.locale ?? ''
  return shell(
    _,
    options.title,
    <ListPage
      title={options.title}
      description={_('flow_backend.menu.epics')}
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
      status={`${options.title}: ${String(options.total ?? options.epics.length)}`}
      body={
        options.epics.length
          ? dataTable(_, {
              rows: options.epics,
              id: (epic) => String(epic.id),
              rowHref: (epic) =>
                localized(`/admin/flow/epics/${encodeURIComponent(String(epic.id))}`, locale),
              columns: [
                {
                  key: 'title',
                  label: _('flow_backend.field.title'),
                  priority: 'primary',
                  cell: (epic) =>
                    linkButton({
                      href: localized(`/admin/flow/epics/${encodeURIComponent(String(epic.id))}`, locale),
                      label: String(epic.title ?? ''),
                      variant: 'tertiary',
                      size: 'compact',
                    }),
                },
                {
                  key: 'project',
                  label: _('flow_backend.field.project'),
                  priority: 'secondary',
                  cell: (epic) =>
                    linkButton({
                      href: localized(
                        `/admin/flow/projects/${encodeURIComponent(String(epic.projectId))}/epics`,
                        locale,
                      ),
                      label: String(epic.projectName ?? '—'),
                      variant: 'tertiary',
                      size: 'compact',
                    }),
                },
                {
                  key: 'preview',
                  label: _('flow_backend.field.description'),
                  cell: (epic) =>
                    String(epic.previewText ?? '').slice(0, 140) || _('flow_backend.epics.emptyDocument'),
                },
              ],
            })
          : empty(_)
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
