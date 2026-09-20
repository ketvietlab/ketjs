import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import {
  entryListSearch,
  revisionListSearch,
  siteDomainListSearch,
  siteHealthListSearch,
  siteMemberListSearch,
} from './search.ts'

/**
 * The search-filter bar's functions for every website list.
 *
 * Revisions, members and domains belong to one entry or one site, so their
 * `path` is the list the bar may return the reader to; the id in it is theirs
 * already, and the bar only ever rewrites the query string.
 */
export const functions: Record<string, FnSpec> = listSearchFilterFunctions([
  {
    key: entryListSearch.key,
    path: '/admin/website/pages',
    accepts: /^\/admin\/website\/(pages|posts)$/,
    spec: () => entryListSearch,
  },
  {
    key: revisionListSearch.key,
    path: '/admin/website/pages',
    accepts: /^\/admin\/website\/(pages|posts|content)\/[^/]+\/revisions$/,
    spec: () => revisionListSearch,
  },
  { key: siteHealthListSearch.key, path: '/admin/website/health', spec: () => siteHealthListSearch },
  {
    key: siteMemberListSearch.key,
    path: '/admin/website/sites',
    accepts: /^\/admin\/website\/sites\/[^/]+\/members$/,
    spec: () => siteMemberListSearch,
  },
  {
    key: siteDomainListSearch.key,
    path: '/admin/website/sites',
    accepts: /^\/admin\/website\/sites\/[^/]+\/domains$/,
    spec: () => siteDomainListSearch,
  },
])
