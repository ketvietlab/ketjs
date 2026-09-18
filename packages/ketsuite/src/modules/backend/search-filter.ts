import type { Route, ServeContext } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import type { SearchFilterConfig } from '@ketvietlab/design-system'

export type {
  CustomFilterField,
  SearchFacet,
  SearchFavorite,
  SearchFilterConfig,
  SearchFilterLabels,
  SearchFilterManager,
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
