// The one bar above a list: primary action, title, search, filters, paging and view.
// Every state-changing navigation remains a link or a method=get form.

import { each } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import type { Translator } from 'ketjs'
import { icon } from './icons.ts'

export const HOOKS = [
  'chrome-lead',
  'chrome-tail',
  'chrome-create',
  'title',
  'chrome-search',
  'chrome-search-icon',
  'chrome-search-input',
  'facet',
  'facet-label',
  'facet-remove',
  'pager',
  'pager-range',
  'pager-step',
  'view-switch',
  'view-kind',
] as const

export type Facet = { label: string; without: string }

export type Pager = {
  from: number
  to: number
  total: number
  prev?: string | null
  next?: string | null
}

export type ViewKind = { id: string; label: string; icon: string; path: string; active: boolean }

export type ListChrome = {
  create?: { label: string; path: string } | null
  search?: {
    name: string
    value?: string
    placeholder: string
    facets?: Facet[]
    keep?: Record<string, string>
  } | null
  pager?: Pager | null
  views?: ViewKind[]
}

const pagerLabel = (pager: Pager): string =>
  pager.total === 0 ? '0' : `${pager.from}-${pager.to} / ${pager.total}`

export const topbarSearch = (_: Translator, chrome: ListChrome): TemplateResult => {
  const search = chrome.search!
  return (
    <form data-ui="chrome-search" method="get" role="search">
      <span data-ui="chrome-search-icon">{icon('search')}</span>
      {each(
        Object.entries(search.keep ?? {}),
        ([key]) => key,
        ([key, value]) => (
          <input type="hidden" name={key} value={value} />
        ),
      )}
      {each(
        search.facets ?? [],
        (facet) => facet.label,
        (facet) => (
          <span data-ui="facet">
            <span data-ui="facet-label">{facet.label}</span>
            <a data-ui="facet-remove" href={facet.without} aria-label={_('backend.chrome.removeFilter')}>
              {icon('x')}
            </a>
          </span>
        ),
      )}
      <input
        data-ui="chrome-search-input"
        type="search"
        name={search.name}
        value={search.value ?? ''}
        placeholder={search.placeholder}
        aria-label={search.placeholder}
      />
    </form>
  )
}

export const listChrome = (_: Translator, title: string, chrome: ListChrome): TemplateResult => (
  <>
    {chromeLead(title, chrome)}
    {!!chrome.search && topbarSearch(_, chrome)}
    {chromeTail(_, chrome)}
  </>
)

const chromeLead = (title: string, chrome: ListChrome): TemplateResult => (
  <div data-ui="chrome-lead">
    {!!chrome.create && (
      <a data-ui="chrome-create" href={chrome.create.path}>
        {icon('plus')}
        {chrome.create.label}
      </a>
    )}
    <h1 data-ui="title">{title}</h1>
  </div>
)

const pagerStep = (
  direction: 'prev' | 'next',
  href: string | null | undefined,
  label: string,
): TemplateResult =>
  href ? (
    <a data-ui="pager-step" data-dir={direction} href={href} aria-label={label}>
      {icon(direction === 'prev' ? 'chevron-left' : 'chevron-right')}
    </a>
  ) : (
    <span data-ui="pager-step" data-dir={direction} aria-disabled="true">
      {icon(direction === 'prev' ? 'chevron-left' : 'chevron-right')}
    </span>
  )

const chromeTail = (_: Translator, chrome: ListChrome): TemplateResult => (
  <div data-ui="chrome-tail">
    {!!chrome.pager && (
      <div data-ui="pager">
        <span data-ui="pager-range">{pagerLabel(chrome.pager)}</span>
        {pagerStep('prev', chrome.pager.prev, _('backend.chrome.previous'))}
        {pagerStep('next', chrome.pager.next, _('backend.chrome.next'))}
      </div>
    )}

    {(chrome.views ?? []).length > 1 && (
      <div data-ui="view-switch" role="group" aria-label={_('backend.chrome.views')}>
        {each(
          chrome.views!,
          (view) => view.id,
          (view) => (
            <a
              data-ui="view-kind"
              data-kind={view.id}
              data-active={String(view.active)}
              href={view.path}
              title={view.label}
              aria-label={view.label}
            >
              {icon(view.icon)}
            </a>
          ),
        )}
      </div>
    )}
  </div>
)
