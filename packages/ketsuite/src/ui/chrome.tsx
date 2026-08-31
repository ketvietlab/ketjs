// The one bar above a list: primary action, title, search, filters, paging and view.
// Every state-changing navigation remains a link or a method=get form.

import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import { icon } from './icons.ts'
import type { TableSelection } from './table.tsx'

export const HOOKS = [
  'list-chrome',
  'list-context',
  'list-chrome-row',
  'chrome-tools',
  'chrome-lead',
  'chrome-tail',
  'chrome-create',
  'bulk-form',
  'bulk-actions',
  'bulk-actions-open',
  'bulk-actions-menu',
  'bulk-action',
  'title',
  'chrome-search',
  'chrome-search-query',
  'chrome-search-menus',
  'chrome-search-icon',
  'chrome-search-input',
  'chrome-search-toggle',
  'chrome-search-modal',
  'chrome-search-panel',
  'chrome-search-actions',
  'chrome-search-apply',
  'facet',
  'facet-label',
  'facet-remove',
  'search-menu',
  'search-menu-open',
  'search-menu-badge',
  'search-menu-content',
  'search-menu-item',
  'custom-filter',
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
export type SearchMenuItem = {
  id: string
  label: string
  path?: string
  active?: boolean
  children?: SearchMenuItem[]
}
export type SearchMenu = {
  id: string
  label: string
  /** Optional compact trigger for high-frequency filters next to the global query. */
  icon?: string
  ariaLabel?: string
  badge?: string | number
  items: SearchMenuItem[]
  customFilter?: {
    fields: Array<{ value: string; label: string }>
    operators: Array<{ value: string; label: string }>
    fieldLabel: string
    operatorLabel: string
    valueLabel: string
    applyLabel: string
  }
}

export type ListChrome = {
  /** Optional visual treatment for catalogue topbars or in-page command bars. */
  layout?: 'catalogue' | 'command'
  /** Small section label above the list title. */
  section?: string
  create?: { label: string; path: string } | null
  selection?: TableSelection | null
  search?: {
    name: string
    value?: string
    placeholder: string
    facets?: Facet[]
    keep?: Record<string, string | string[]>
    menus?: SearchMenu[]
  } | null
  pager?: Pager | null
  views?: ViewKind[]
}

const pagerLabel = (pager: Pager): string =>
  pager.total === 0 ? '0' : `${pager.from}-${pager.to} / ${pager.total}`

const GLOBAL_FILTER_ID = 'backend-global-filter'
type SearchConfig = NonNullable<ListChrome['search']>

const searchForm = (
  _: Translator,
  search: SearchConfig,
  presentation: 'inline' | 'modal',
): TemplateResult => (
  <form
    data-ui="chrome-search"
    data-presentation={presentation}
    method="get"
    role="search"
    autocomplete="off"
  >
    <div data-ui="chrome-search-query">
      <span data-ui="chrome-search-icon">{icon('search')}</span>
      {each(
        Object.entries(search.keep ?? {}),
        ([key]) => key,
        ([key, value]) => (
          <>
            {each(
              Array.isArray(value) ? value : [value],
              (item, index) => `${key}:${index}:${item}`,
              (item) => (
                <input type="hidden" name={key} value={item} autocomplete="off" />
              ),
            )}
          </>
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
        autocomplete="off"
      />
    </div>
    <div data-ui="chrome-search-menus">
      {each(
        search.menus ?? [],
        (menu) => menu.id,
        (menu) => searchMenu(menu),
      )}
    </div>
    {presentation === 'modal' && (
      <div data-ui="chrome-search-actions">
        <button data-ui="chrome-search-apply" type="submit">
          {_('backend.chrome.apply')}
        </button>
      </div>
    )}
  </form>
)

export const topbarSearch = (_: Translator, chrome: ListChrome): TemplateResult => {
  const search = chrome.search!
  return (
    <>
      {searchForm(_, search, 'inline')}
      <button
        data-ui="chrome-search-toggle"
        type="button"
        aria-label={_('backend.chrome.globalFilter')}
        aria-controls={GLOBAL_FILTER_ID}
        aria-expanded="false"
        title={_('backend.chrome.globalFilter')}
      >
        {icon('sliders-horizontal')}
      </button>
      <dialog
        data-ui="chrome-search-modal"
        id={GLOBAL_FILTER_ID}
        aria-labelledby={`${GLOBAL_FILTER_ID}-title`}
      >
        <section data-ui="chrome-search-panel">
          <header data-ui="modal-head">
            <h2 data-ui="modal-title" id={`${GLOBAL_FILTER_ID}-title`}>
              {_('backend.chrome.globalFilter')}
            </h2>
          </header>
          {searchForm(_, search, 'modal')}
        </section>
      </dialog>
    </>
  )
}

const menuItems = (items: SearchMenuItem[]): TemplateResult => (
  <>
    {each(
      items,
      (item) => item.id,
      (item) =>
        item.children?.length ? (
          <div data-ui="search-menu-item" data-nested="true">
            <span>{item.label}</span>
            {menuItems(item.children)}
          </div>
        ) : (
          <a data-ui="search-menu-item" data-active={String(item.active === true)} href={item.path ?? '#'}>
            <span>{item.active ? '✓' : ''}</span>
            {item.label}
          </a>
        ),
    )}
  </>
)

const searchMenu = (menu: SearchMenu): TemplateResult => (
  <details data-ui="search-menu">
    <summary
      data-ui="search-menu-open"
      data-icon-only={menu.icon ? 'true' : null}
      aria-label={menu.ariaLabel ?? menu.label}
      title={menu.ariaLabel ?? menu.label}
    >
      {menu.icon ? icon(menu.icon) : menu.label}
      {menu.badge != null && <span data-ui="search-menu-badge">{String(menu.badge)}</span>}
      {icon('chevron-down')}
    </summary>
    <div data-ui="search-menu-content">
      {menuItems(menu.items)}
      {!!menu.customFilter && (
        <fieldset data-ui="custom-filter">
          <select name="filterField" aria-label={menu.customFilter.fieldLabel}>
            {each(
              menu.customFilter.fields,
              (field) => field.value,
              (field) => (
                <option value={field.value}>{field.label}</option>
              ),
            )}
          </select>
          <select name="filterOp" aria-label={menu.customFilter.operatorLabel}>
            {each(
              menu.customFilter.operators,
              (operator) => operator.value,
              (operator) => (
                <option value={operator.value}>{operator.label}</option>
              ),
            )}
          </select>
          <input name="filterValue" autocomplete="off" aria-label={menu.customFilter.valueLabel} />
          <button type="submit" name="applyFilter" value="1">
            {menu.customFilter.applyLabel}
          </button>
        </fieldset>
      )}
    </div>
  </details>
)

/**
 * `titled` is false when the screen below opens with its own heading, which is
 * every framed list: the name was printed twice, once here and once a line down in
 * a larger size. The row keeps its shape either way — the lead still holds the
 * create action, and the search stays centred.
 */
export const listChrome = (
  _: Translator,
  title: string,
  chrome: ListChrome,
  titled = true,
): TemplateResult => (
  <section data-ui="list-chrome" data-layout={chrome.layout ?? null}>
    <span data-ui="list-context">{chrome.section ?? ''}</span>
    <div data-ui="list-chrome-row">
      {chromeLead(_, title, chrome, titled)}
      <div data-ui="chrome-tools">
        {!!chrome.search && topbarSearch(_, chrome)}
        {chromeTail(_, chrome)}
      </div>
    </div>
  </section>
)

/**
 * Selection actions belong with page actions, not with query controls. Keeping
 * this renderer public lets a self-titled ListPage place More directly beside
 * Create while legacy topbars can continue to render the same form in chrome.
 */
export const bulkActions = (_: Translator, selection: TableSelection): TemplateResult => (
  <form data-ui="bulk-form" id={selection.formId} method="post" action={selection.action}>
    {each(
      Object.entries(selection.hidden ?? {}),
      ([key]) => key,
      ([key, value]) => (
        <input type="hidden" name={key} value={value} autocomplete="off" />
      ),
    )}
    <details data-ui="bulk-actions">
      <summary data-ui="bulk-actions-open" aria-label={_('backend.chrome.more')}>
        …
      </summary>
      <div data-ui="bulk-actions-menu">
        {each(
          selection.actions,
          (action) => action.id,
          (action) => (
            <button
              data-ui="bulk-action"
              data-tone={action.tone ?? 'default'}
              type="submit"
              name="action"
              value={action.id}
            >
              {action.label}
            </button>
          ),
        )}
      </div>
    </details>
  </form>
)

const chromeLead = (_: Translator, title: string, chrome: ListChrome, titled: boolean): TemplateResult => (
  <div data-ui="chrome-lead">
    {titled && <h1 data-ui="title">{title}</h1>}
    {!!chrome.create && (
      <a data-ui="chrome-create" href={chrome.create.path}>
        {chrome.create.label}
      </a>
    )}
    {!!chrome.selection && bulkActions(_, chrome.selection)}
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
