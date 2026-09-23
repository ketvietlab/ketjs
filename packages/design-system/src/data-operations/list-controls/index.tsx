import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Button } from '../../primitives/actions/index.tsx'
import { Menu } from '../../interactions/menu/index.tsx'

export const HOOKS = [
  'search-bar',
  'filter-bar',
  'applied-filters',
  'applied-filter',
  'saved-views',
  'saved-view',
  'view-settings',
  'view-settings-options',
] as const

export const withQueryState = (
  href: string,
  changes: Readonly<Record<string, string | number | boolean | null | undefined>>,
): string => {
  const url = new URL(href, 'http://ket.local')
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === '') url.searchParams.delete(key)
    else url.searchParams.set(key, String(value))
  }
  return `${url.pathname}${url.search}${url.hash}`
}

export type SearchBarProps = {
  action: string
  value?: string | null
  name?: string
  id?: string
  label?: string
  placeholder?: string
  submitLabel?: string
  hidden?: Readonly<Record<string, string>>
}

export const SearchBar = (props: SearchBarProps): TemplateResult => (
  <form data-ui="search-bar" action={props.action} method="get" role="search">
    {each(
      Object.entries(props.hidden ?? {}),
      ([name]) => name,
      ([name, value]) => (
        <input type="hidden" name={name} value={value} />
      ),
    )}
    <label for={props.id ?? 'resource-search'}>{props.label ?? 'Search'}</label>
    <input
      id={props.id ?? 'resource-search'}
      type="search"
      name={props.name ?? 'q'}
      value={props.value ?? ''}
      placeholder={props.placeholder}
      autocomplete="off"
    />
    <Button type="submit" label={props.submitLabel ?? 'Search'} size="compact" />
  </form>
)

export const FilterBar = (props: { label?: string; filters: readonly JSXChild[] }): TemplateResult => (
  <section data-ui="filter-bar" aria-label={props.label ?? 'Filters'}>
    {props.filters}
  </section>
)

export type AppliedFilter = { id: string; label: string; value: string; removeHref: string }
export const AppliedFilters = (props: {
  label?: string
  filters: readonly AppliedFilter[]
  clearHref?: string
  clearLabel?: string
}): TemplateResult => (
  <nav data-ui="applied-filters" aria-label={props.label ?? 'Applied filters'}>
    {each(
      props.filters,
      (filter) => filter.id,
      (filter) => (
        <a
          data-ui="applied-filter"
          href={filter.removeHref}
          aria-label={`Remove ${filter.label}: ${filter.value}`}
        >
          <strong>{filter.label}</strong> {filter.value} ×
        </a>
      ),
    )}
    {props.clearHref && <a href={props.clearHref}>{props.clearLabel ?? 'Clear all'}</a>}
  </nav>
)

export type SortChoice = { id: string; label: string; href: string; active?: boolean }
export const SortMenu = (props: {
  id: string
  label?: string
  choices: readonly SortChoice[]
}): TemplateResult => (
  <Menu
    id={props.id}
    label={props.label ?? 'Sort'}
    align="end"
    items={props.choices.map((choice) => ({
      id: choice.id,
      label: `${choice.active ? '✓ ' : ''}${choice.label}`,
      href: choice.href,
    }))}
  />
)

export type SavedView = { id: string; label: string; href: string; active?: boolean; description?: string }
export const SavedViews = (props: { label?: string; views: readonly SavedView[] }): TemplateResult => (
  <nav data-ui="saved-views" aria-label={props.label ?? 'Saved views'}>
    {each(
      props.views,
      (view) => view.id,
      (view) => (
        <a data-ui="saved-view" href={view.href} aria-current={view.active ? 'page' : null}>
          <strong>{view.label}</strong>
          {view.description && <small>{view.description}</small>}
        </a>
      ),
    )}
  </nav>
)

export type ViewSetting = { id: string; label: string; visible: boolean; disabled?: boolean }
export const ViewSettings = (props: {
  id: string
  label?: string
  action: string
  settings: readonly ViewSetting[]
  version?: string
  submitLabel?: string
}): TemplateResult => (
  <details data-ui="view-settings">
    <summary>{props.label ?? 'View settings'}</summary>
    <form action={props.action} method="post">
      {props.version && <input type="hidden" name="version" value={props.version} />}
      <div data-ui="view-settings-options">
        {each(
          props.settings,
          (setting) => setting.id,
          (setting) => (
            <label>
              <input
                type="checkbox"
                name="columns"
                value={setting.id}
                checked={setting.visible}
                disabled={setting.disabled === true}
              />
              {setting.label}
            </label>
          ),
        )}
      </div>
      <Button type="submit" label={props.submitLabel ?? 'Save view'} size="compact" />
    </form>
  </details>
)
