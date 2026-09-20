import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import type { SearchFilterConfig, SearchFilterLabels } from '@ketvietlab/design-system'

export type {
  CustomFilterField,
  SearchFacet,
  SearchFavorite,
  SearchFilterCustomRule,
  SearchFilterConfig,
  SearchFilterLabels,
  SearchFilterManager,
  SearchFilterSize,
  SearchFilterOption,
  SearchGroupByOption,
} from '@ketvietlab/design-system'

type Req = Parameters<Route>[1]

export const searchFilterBar = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  id: string,
  config: SearchFilterConfig,
): Promise<JSXChild> => ctx.joint(url, req, 'backend:search.filter', { id, config })

/**
 * The search-filter bar's own vocabulary, which is the same wherever the bar
 * appears. A module overrides only what names its own collection: the bar's
 * label and its search placeholder.
 */
export const searchFilterLabels = (
  _: Translator,
  overrides: Partial<SearchFilterLabels> = {},
): SearchFilterLabels => ({
  searchLabel: _('backend.search.label'),
  searchPlaceholder: _('backend.search.placeholder'),
  toggleLabel: _('backend.search.toggle'),
  filters: _('backend.search.filters'),
  groupBy: _('backend.search.groupBy'),
  groupByApplied: _('backend.search.groupByApplied'),
  groupByAdd: _('backend.search.groupByAdd'),
  groupByClear: _('backend.search.groupByClear'),
  groupByMoveEarlier: _('backend.search.groupByMoveEarlier'),
  groupByMoveLater: _('backend.search.groupByMoveLater'),
  favorites: _('backend.search.favorites'),
  searchGenericLabel: _('backend.search.genericLabel'),
  searchFieldPrefix: _('backend.search.fieldPrefix'),
  searchFieldPreposition: _('backend.search.fieldPreposition'),
  customFilterField: _('backend.search.customFilterField'),
  customFilterOperator: _('backend.search.customFilterOperator'),
  customFilterValue: _('backend.search.customFilterValue'),
  customFilterAdd: _('backend.search.customFilterAdd'),
  customGroupByPlaceholder: _('backend.search.customGroupByPlaceholder'),
  saveSearch: _('backend.search.saveSearch'),
  favoriteName: _('backend.search.favoriteName'),
  favoriteDefault: _('backend.search.favoriteDefault'),
  favoriteSaveAction: _('backend.search.favoriteSaveAction'),
  favoriteRemove: _('backend.search.favoriteRemove'),
  favoriteSetDefault: _('backend.search.favoriteSetDefault'),
  noFavorites: _('backend.search.noFavorites'),
  clear: _('backend.search.clear'),
  applyError: _('backend.search.applyError'),
  retry: _('backend.search.retry'),
  ...overrides,
})
