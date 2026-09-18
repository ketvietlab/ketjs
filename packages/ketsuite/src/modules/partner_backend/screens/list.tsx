import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  bulkActions,
  CollectionTabs,
  inline,
  LinkButton,
  ListPage,
  listChrome,
  shell,
  stack,
} from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import type { PartnerListSummary } from './types.ts'

export const partnersScreen = (
  _: Translator,
  frame: Frame,
  // Pre-rendered by the route via `backend/ket-table.ts`'s `tableGrid()` —
  // `partnersScreen` stays a pure, synchronous view function, and the island
  // only needs `ctx`/`url`/`req` (for its joint) at the one call site that
  // already has them. The island also owns its own empty state, so there is
  // no `rows.length ? … : emptyState(...)` branch left to keep here.
  tableGrid: JSXChild,
  locale = '',
  summary?: PartnerListSummary,
  total = 0,
): TemplateResult =>
  shell(
    _,
    _('partner_backend.screen.title'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('partner_backend.screen.title')}
      description={_('partner_backend.screen.description')}
      actions={
        frame.chrome?.create || frame.chrome?.selection || frame.extras?.['topbar.end'] !== undefined
          ? inline([
              frame.chrome?.create ? (
                <LinkButton
                  label={frame.chrome.create.label}
                  href={frame.chrome.create.path}
                  variant="primary"
                />
              ) : (
                ''
              ),
              frame.chrome?.selection ? bulkActions(_, frame.chrome.selection) : '',
              frame.extras?.['topbar.end'] ?? '',
            ])
          : undefined
      }
      controls={
        frame.chrome
          ? listChrome(
              _,
              _('partner_backend.screen.title'),
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
      status={_('partner_backend.screen.results', { count: total })}
      body={
        summary
          ? stack(
              [
                <CollectionTabs
                  label={_('partner_backend.list.summary')}
                  items={[
                    {
                      id: 'all',
                      label: _('partner_backend.list.all'),
                      count: summary.total,
                      href: summary.allHref,
                      active: summary.active === 'all',
                    },
                    {
                      id: 'customers',
                      label: _('partner_backend.filter.customers'),
                      count: summary.customers,
                      href: summary.customersHref,
                      active: summary.active === 'customers',
                    },
                    {
                      id: 'suppliers',
                      label: _('partner_backend.filter.suppliers'),
                      count: summary.suppliers,
                      href: summary.suppliersHref,
                      active: summary.active === 'suppliers',
                    },
                    {
                      id: 'archived',
                      label: _('partner_backend.filter.includeArchived'),
                      count: summary.archived,
                      href: summary.archivedHref,
                      active: summary.active === 'archived',
                    },
                  ]}
                />,
                tableGrid,
              ],
              'compact',
            )
          : tableGrid
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
