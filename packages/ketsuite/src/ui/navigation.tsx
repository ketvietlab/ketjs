// Navigation below the app shell. The current list screens intentionally do not
// use breadcrumbs, but deeper ERP records still need a canonical component rather
// than forty hand-written trails or tab bars.

import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = ['breadcrumbs', 'breadcrumb', 'tabs', 'tab'] as const

export type Breadcrumb = { label: string; href?: string | null }
export type Tab = {
  id: string
  label: string
  href?: string | null
  active?: boolean
  count?: number | null
  /** Keeps a future section visible in the information architecture without making it navigable yet. */
  disabled?: boolean
}

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

/**
 * One row of mutually exclusive links, one of them current.
 *
 * `wrap` decides what happens when they do not fit. A navigation row scrolls,
 * because its order carries meaning and the tab you are on is the one you just
 * clicked. A filter row wraps, because the current choice can be any of them and
 * one sitting past the edge of a phone, with nothing to say so, is a choice that
 * does not exist as far as the reader is concerned.
 */
export const tabs = (o: { label: string; items: readonly Tab[]; wrap?: boolean }): TemplateResult => (
  <nav data-ui="tabs" data-wrap={String(o.wrap === true)} aria-label={o.label}>
    {each(
      o.items,
      (item) => item.id,
      (item) =>
        item.disabled || !item.href ? (
          <span
            data-ui="tab"
            data-active={String(item.active === true)}
            data-disabled="true"
            aria-disabled="true"
          >
            {item.label}
            {item.count !== undefined && item.count !== null && (
              <>
                {' '}
                <span>{String(item.count)}</span>
              </>
            )}
          </span>
        ) : (
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
