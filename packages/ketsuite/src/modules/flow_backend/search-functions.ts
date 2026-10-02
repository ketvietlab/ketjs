import type { FnSpec } from '@ketvietlab/ketjs'
import { table } from '@ketvietlab/ketjs'
import { issueListSearch } from '../flow/search.ts'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import { epicListSearch, pageListSearch, projectListSearch, sprintListSearch } from './search.ts'

/**
 * The bar's functions for every Flow list; `listKey` says which list.
 *
 * The issue lists share one key across the cross-project and per-project
 * screens, the way they already share one spec, and the documents do the same.
 * A project's own custom fields are not in the spec this seam validates
 * against: the route that reads them has the project in hand and re-validates
 * there, so a rule over a field one project defines survives the round trip
 * without this seam having to guess which project the reader meant.
 */
export const searchFilterFunctions: Record<string, FnSpec> = listSearchFilterFunctions([
  {
    key: 'flow.issues',
    path: '/admin/flow/issues',
    // One key, three screens: the cross-project list, My work, and a project's
    // own backlog. `accepts` is what lets a payload name the screen it came
    // from without letting it name an unrelated path.
    accepts: /^\/admin\/flow\/(?:issues|mine|projects\/[^/]+\/issues)$/,
    spec: (ctx) => issueListSearch(table(ctx.manifest, 'flow.Issue')),
  },
  { key: projectListSearch.key, path: '/admin/flow/projects', spec: () => projectListSearch },
  { key: epicListSearch.key, path: '/admin/flow/epics', spec: () => epicListSearch },
  {
    key: pageListSearch.key,
    path: '/admin/flow/pages',
    accepts: /^\/admin\/flow\/(?:pages|projects\/[^/]+\/pages)$/,
    spec: () => pageListSearch,
  },
  {
    key: sprintListSearch.key,
    path: '/admin/flow/projects',
    accepts: /^\/admin\/flow\/projects\/[^/]+\/sprints$/,
    spec: () => sprintListSearch,
  },
])
