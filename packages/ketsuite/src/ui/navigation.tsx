// Navigation below the app shell. The current list screens intentionally do not
// use breadcrumbs, but deeper ERP records still need a canonical component rather
// than forty hand-written trails or tab bars.

import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = ['breadcrumbs', 'breadcrumb', 'tabs', 'tab'] as const

export type Breadcrumb = { label: string; href?: string | null }
export type Tab = { id: string; label: string; href: string; active?: boolean; count?: number | null }

export const breadcrumbs = (o: { label: string; items: readonly Breadcrumb[] }): TemplateResult => (
  <nav data-ui="breadcrumbs" aria-label={o.label}>
    <ol>
      {each(
        o.items,
        (item, i) => `${i}:${item.label}`,
        (item, i) => (
          <li data-ui="breadcrumb">
            {item.href && i < o.items.length - 1 ? (
              <a href={item.href}>{item.label}</a>
            ) : (
              <span aria-current={i === o.items.length - 1 ? 'page' : null}>{item.label}</span>
            )}
          </li>
        ),
      )}
    </ol>
  </nav>
)

export const tabs = (o: { label: string; items: readonly Tab[] }): TemplateResult => (
  <nav data-ui="tabs" aria-label={o.label}>
    {each(
      o.items,
      (item) => item.id,
      (item) => (
        <a
          data-ui="tab"
          data-active={String(item.active === true)}
          href={item.href}
          aria-current={item.active ? 'page' : null}
        >
          {item.label}
          {item.count !== undefined && item.count !== null && (
            <>
              {' '}
              <span>{String(item.count)}</span>
            </>
          )}
        </a>
      ),
    )}
  </nav>
)
