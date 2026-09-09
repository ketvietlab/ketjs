import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Button, LinkButton } from '../../primitives/actions.tsx'
import type { ActionVariant } from '../../primitives/actions.tsx'

export type ListFacet = {
  id: string
  label: string
  href: string
  active?: boolean
  count?: number
}

export type ListSearch = {
  id?: string
  action: string
  name?: string
  value?: string | null
  placeholder?: string | null
  label?: string
  submitLabel?: string
  hidden?: Readonly<Record<string, string>>
}

export type ListSortChoice = {
  value: string
  label: string
  selected?: boolean
}

export type ListSort = {
  id?: string
  action: string
  name?: string
  label?: string
  submitLabel?: string
  choices: readonly ListSortChoice[]
  hidden?: Readonly<Record<string, string>>
}

export type BulkAction = {
  id: string
  label: string
  name?: string
  value?: string
  variant?: ActionVariant
  disabled?: boolean
}

export type BulkActionsProps = {
  form?: string | null
  selectedCount?: number
  summary?: JSXChild
  clearHref?: string | null
  clearLabel?: string
  actions: readonly BulkAction[]
}

export type PagerPage = {
  label: string
  href: string
  active?: boolean
}

export type PagerBarProps = {
  summary?: JSXChild
  previousHref?: string | null
  nextHref?: string | null
  previousLabel?: string
  nextLabel?: string
  pages?: readonly PagerPage[]
  label?: string
}

export type ListChromeProps = {
  filtersLabel?: string
  viewsLabel?: string
  search?: ListSearch
  facets?: readonly ListFacet[]
  views?: readonly ListFacet[]
  sort?: ListSort
  status?: JSXChild
  actions?: JSXChild
  bulk?: BulkActionsProps
  pager?: PagerBarProps
}

export const HOOKS = [
  'list-chrome',
  'list-chrome-row',
  'list-search',
  'list-search-label',
  'list-search-input',
  'list-search-submit',
  'list-facets',
  'list-facet',
  'list-facet-count',
  'list-view-switch',
  'list-view',
  'list-sort',
  'list-sort-label',
  'list-sort-select',
  'list-status',
  'list-actions',
  'bulk-actions',
  'bulk-summary',
  'bulk-action-list',
  'pager-bar',
  'pager-summary',
  'pager-pages',
  'pager-page',
  'pager-actions',
  'pager-link',
] as const

const hiddenFields = (fields: Readonly<Record<string, string>> | undefined): JSXChild =>
  fields
    ? each(
        Object.entries(fields),
        ([name]) => name,
        ([name, value]) => <input type="hidden" name={name} value={value} />,
      )
    : ''

const SearchControl = (props: ListSearch): TemplateResult => (
  <form data-ui="list-search" action={props.action} method="get" role="search">
    {hiddenFields(props.hidden)}
    <label data-ui="list-search-label" for={props.id ?? `${props.name ?? 'q'}-search`}>
      {props.label ?? 'Search'}
    </label>
    <input
      data-ui="list-search-input"
      id={props.id ?? `${props.name ?? 'q'}-search`}
      type="search"
      name={props.name ?? 'q'}
      value={props.value ?? ''}
      placeholder={props.placeholder ?? ''}
      autocomplete="off"
    />
    <span data-ui="list-search-submit">
      <Button type="submit" label={props.submitLabel ?? 'Search'} variant="tertiary" size="compact" />
    </span>
  </form>
)

const FacetNav = (props: {
  label: string
  ui: 'list-facets' | 'list-view-switch'
  itemUi: string
  items: readonly ListFacet[]
}): TemplateResult => (
  <nav data-ui={props.ui} aria-label={props.label}>
    {each(
      props.items,
      (item) => item.id,
      (item) => (
        <a
          data-ui={props.itemUi}
          data-active={item.active === true ? 'true' : null}
          href={item.href}
          aria-current={item.active === true ? 'page' : null}
        >
          <span>{item.label}</span>
          {item.count !== undefined && <span data-ui="list-facet-count">{String(item.count)}</span>}
        </a>
      ),
    )}
  </nav>
)

const SortControl = (props: ListSort): TemplateResult => (
  <form data-ui="list-sort" action={props.action} method="get">
    {hiddenFields(props.hidden)}
    <label data-ui="list-sort-label" for={props.id ?? `${props.name ?? 'sort'}-select`}>
      {props.label ?? 'Sort'}
    </label>
    <select
      data-ui="list-sort-select"
      id={props.id ?? `${props.name ?? 'sort'}-select`}
      name={props.name ?? 'sort'}
    >
      {each(
        props.choices,
        (choice) => choice.value,
        (choice) => (
          <option value={choice.value} selected={choice.selected === true}>
            {choice.label}
          </option>
        ),
      )}
    </select>
    <Button type="submit" label={props.submitLabel ?? 'Apply'} variant="tertiary" size="compact" />
  </form>
)

export const BulkActions = (props: BulkActionsProps): TemplateResult => (
  <div
    data-ui="bulk-actions"
    data-has-selection={props.selectedCount && props.selectedCount > 0 ? 'true' : null}
  >
    <div data-ui="bulk-summary">
      {props.summary ?? `${props.selectedCount ?? 0} selected`}
      {props.clearHref && (
        <LinkButton
          href={props.clearHref}
          label={props.clearLabel ?? 'Clear'}
          variant="tertiary"
          size="compact"
        />
      )}
    </div>
    <div data-ui="bulk-action-list">
      {each(
        props.actions,
        (action) => action.id,
        (action) => (
          <Button
            type="submit"
            form={props.form ?? null}
            name={action.name}
            value={action.value}
            label={action.label}
            variant={action.variant ?? 'secondary'}
            size="compact"
            disabled={action.disabled === true || !(props.selectedCount && props.selectedCount > 0)}
          />
        ),
      )}
    </div>
  </div>
)

export const PagerBar = (props: PagerBarProps): TemplateResult => (
  <nav data-ui="pager-bar" aria-label={props.label ?? 'Pagination'}>
    {props.summary !== undefined && <span data-ui="pager-summary">{props.summary}</span>}
    {props.pages && props.pages.length > 0 && (
      <span data-ui="pager-pages">
        {each(
          props.pages,
          (page) => page.href,
          (page) => (
            <a
              data-ui="pager-page"
              data-active={page.active === true ? 'true' : null}
              href={page.href}
              aria-current={page.active === true ? 'page' : null}
            >
              {page.label}
            </a>
          ),
        )}
      </span>
    )}
    <span data-ui="pager-actions">
      {props.previousHref ? (
        <a
          data-ui="pager-link"
          href={props.previousHref}
          rel="prev"
          aria-label={props.previousLabel ?? 'Previous page'}
        >
          ‹
        </a>
      ) : (
        <span data-ui="pager-link" data-disabled="true" aria-hidden="true">
          ‹
        </span>
      )}
      {props.nextHref ? (
        <a data-ui="pager-link" href={props.nextHref} rel="next" aria-label={props.nextLabel ?? 'Next page'}>
          ›
        </a>
      ) : (
        <span data-ui="pager-link" data-disabled="true" aria-hidden="true">
          ›
        </span>
      )}
    </span>
  </nav>
)

export const ListChrome = (props: ListChromeProps): TemplateResult => {
  const filters =
    (props.facets?.length ?? 0) > 0 || (props.views?.length ?? 0) > 0 || props.sort ? (
      <div data-ui="list-chrome-row" data-row="filters">
        {props.facets && props.facets.length > 0 && (
          <FacetNav
            label={props.filtersLabel ?? 'Filters'}
            ui="list-facets"
            itemUi="list-facet"
            items={props.facets}
          />
        )}
        {props.views && props.views.length > 0 && (
          <FacetNav
            label={props.viewsLabel ?? 'Views'}
            ui="list-view-switch"
            itemUi="list-view"
            items={props.views}
          />
        )}
        {props.sort && <SortControl {...props.sort} />}
      </div>
    ) : null
  const meta =
    props.status !== undefined || props.actions !== undefined || props.pager ? (
      <div data-ui="list-chrome-row" data-row="meta">
        {props.status !== undefined && <div data-ui="list-status">{props.status}</div>}
        {props.actions !== undefined && <div data-ui="list-actions">{props.actions}</div>}
        {props.pager && <PagerBar {...props.pager} />}
      </div>
    ) : null
  const tail =
    filters || meta ? (
      <div data-ui="list-chrome-row" data-row="tail">
        {filters}
        {meta}
      </div>
    ) : null
  return (
    <div data-ui="list-chrome">
      <div data-ui="list-chrome-row" data-row="query">
        {props.search && <SearchControl {...props.search} />}
        {tail}
      </div>
      {props.bulk && <BulkActions {...props.bulk} />}
    </div>
  )
}
