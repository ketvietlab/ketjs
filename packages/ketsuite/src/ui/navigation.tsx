// Navigation below the app shell. Operational collection and form workspaces
// share one canonical location trail instead of hand-writing breadcrumbs or
// organisation context in every module.

import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { MenuNode } from '@ketvietlab/ketjs'
import { icon } from './icons.ts'
import type { Viewer } from './nav.tsx'

export const HOOKS = [
  'breadcrumbs',
  'breadcrumb',
  'page-context',
  'page-context-trail',
  'page-context-viewer',
  'page-context-icon',
  'page-context-copy',
  'page-context-company',
  'page-context-branch',
  'tabs',
  'tab',
] as const

export type Breadcrumb = { label: string; href?: string | null }
export type PageContextFrame = { menu?: MenuNode[]; viewer?: Viewer | null }
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

const viewerContext = (viewer: Viewer): TemplateResult => {
  const company = viewer.companyName ?? viewer.company
  const content = (
    <>
      <span data-ui="page-context-icon">{icon('building-2')}</span>
      <span data-ui="page-context-copy">
        {!!company && <span data-ui="page-context-company">{company}</span>}
        {!!viewer.branchName && <span data-ui="page-context-branch">{viewer.branchName}</span>}
      </span>
    </>
  )
  return viewer.contextPath ? (
    <a data-ui="page-context-viewer" href={viewer.contextPath}>
      {content}
    </a>
  ) : (
    <span data-ui="page-context-viewer">{content}</span>
  )
}

/**
 * Page-level navigation on the left and the live organisation context on the
 * right. It is deliberately independent from ListPage so record and reporting
 * workspaces can opt into the same strip later.
 */
export const pageContext = (o: {
  label: string
  items: readonly Breadcrumb[]
  viewer?: Viewer | null
}): TemplateResult => (
  <div data-ui="page-context">
    <div data-ui="page-context-trail">{breadcrumbs({ label: o.label, items: o.items })}</div>
    {!!o.viewer &&
      !!(o.viewer.companyName ?? o.viewer.company ?? o.viewer.branchName) &&
      viewerContext(o.viewer)}
  </div>
)

const activeTrail = (nodes: readonly MenuNode[]): MenuNode[] => {
  const node = nodes.find((candidate) => candidate.active)
  if (!node) return []
  return [node, ...activeTrail(node.children)]
}

/**
 * Turn the authoritative application frame into the location strip shared by
 * collection and form workspaces. Dynamic pages keep the nearest registered
 * menu branch and append their concrete record title.
 */
export const pageContextFromFrame = (title: string, frame: PageContextFrame): TemplateResult => {
  const items = activeTrail(frame.menu ?? []).map((node) => ({
    label: node.label,
    href: node.path,
  }))
  if (items.length === 0 || items.at(-1)?.label !== title) items.push({ label: title, href: null })
  return pageContext({ label: title, items, viewer: frame.viewer })
}

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
