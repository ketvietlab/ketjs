// What the search-filter bar offers on each website list.
//
// Two shapes meet here. Content is paged and searched by `website.listEntries`,
// so its spec declares only what that function can answer: a query and a
// publication state. The smaller lists — revisions, members, domains, and the
// health overview — are complete collections held in memory, so they get the
// full row filter.
//
// None of them declares `groupable`: their screens render a single table and a
// site's four domains or a page's revisions are not read by group.
import { defineRowList } from '../backend/row-list.ts'
import type { ListSearchShape } from '@ketvietlab/ketjs'

/**
 * Content, as `website.listEntries` can answer it.
 *
 * The states are alternatives rather than accumulating filters because the
 * function takes one `status`; the route applies the first the reader picked.
 */
export const entryListSearch: ListSearchShape = {
  key: 'website.entries',
  searchable: [{ key: 'title' }],
  sortable: [],
  presets: [
    { key: 'draft', label: 'website_backend.state.draft', group: 'status' },
    { key: 'scheduled', label: 'website_backend.state.scheduled', group: 'status' },
    { key: 'published', label: 'website_backend.state.published', group: 'status' },
    // The bin is left out unless asked for, the way every other reader here does.
    { key: 'trash', label: 'website_backend.state.trash', group: 'status' },
  ],
}

export const revisionListSearch = defineRowList({
  key: 'website.revisions',
  searchable: [{ key: 'version' }, { key: 'kind' }, { key: 'authorId' }],
  filterable: [
    { key: 'version', label: 'website_backend.field.version', type: 'number' },
    { key: 'kind', label: 'website_backend.field.kind', type: 'text' },
    { key: 'authorId', label: 'website_backend.field.author', type: 'text' },
    { key: 'createdAt', label: 'website_backend.field.createdAt', type: 'datetime' },
  ],
  sortable: [
    { key: 'version', label: 'website_backend.field.version' },
    { key: 'createdAt', label: 'website_backend.field.createdAt' },
  ],
  defaultSort: [{ key: 'version', dir: 'desc' }],
})

export const siteHealthListSearch = defineRowList({
  key: 'website.health',
  searchable: [{ key: 'title' }, { key: 'primaryHost' }],
  filterable: [
    { key: 'title', label: 'website_backend.field.site', type: 'text' },
    { key: 'primaryHost', label: 'website_backend.domains.host', type: 'text' },
    { key: 'active', label: 'website_backend.field.status', type: 'boolean' },
  ],
  sortable: [{ key: 'title', label: 'website_backend.field.site' }],
  presets: [
    // The list exists to answer "which sites need attention", so the concerns
    // it renders are the filters it offers.
    {
      key: 'noDomain',
      label: 'website_backend.health.noDomain',
      group: 'concern',
      match: (row) => Number(row.domainCount ?? 0) === 0,
    },
    {
      key: 'noPrimary',
      label: 'website_backend.health.noPrimary',
      group: 'concern',
      match: (row) => Number(row.domainCount ?? 0) > 0 && !row.primaryHost,
    },
    {
      key: 'suspended',
      label: 'website_backend.health.suspended',
      group: 'concern',
      match: (row) => row.active === false,
    },
    {
      key: 'prepared',
      label: 'website_backend.health.prepared',
      group: 'concern',
      match: (row) => Number(row.preparedCount ?? 0) > 0,
    },
    {
      key: 'staleIndex',
      label: 'website_backend.health.staleIndex',
      group: 'concern',
      match: (row) => row.indexCurrent !== true,
    },
  ],
  defaultSort: [{ key: 'title', dir: 'asc' }],
})

const SITE_ROLES = ['administrator', 'editor', 'author', 'contributor'] as const

export const siteMemberListSearch = defineRowList({
  key: 'website.members',
  searchable: [{ key: 'userId' }, { key: 'role' }],
  filterable: [
    { key: 'userId', label: 'website_backend.members.user', type: 'text' },
    { key: 'role', label: 'website_backend.members.role', type: 'selection', choices: SITE_ROLES },
  ],
  sortable: [
    { key: 'userId', label: 'website_backend.members.user' },
    { key: 'role', label: 'website_backend.members.role' },
  ],
  presets: SITE_ROLES.map((role) => ({
    key: role,
    label: `website_backend.role.${role}`,
    group: 'role',
    match: (row: Record<string, unknown>) => row.role === role,
  })),
  defaultSort: [{ key: 'userId', dir: 'asc' }],
})

export const siteDomainListSearch = defineRowList({
  key: 'website.domains',
  searchable: [{ key: 'host' }],
  filterable: [
    { key: 'host', label: 'website_backend.domains.host', type: 'text' },
    { key: 'primary', label: 'website_backend.domains.primary', type: 'boolean' },
    { key: 'redirectToPrimary', label: 'website_backend.domains.redirect', type: 'boolean' },
  ],
  sortable: [{ key: 'host', label: 'website_backend.domains.host' }],
  presets: [
    {
      key: 'primary',
      label: 'website_backend.domains.primary',
      group: 'primary',
      match: (row) => row.primary === true,
    },
    {
      key: 'redirecting',
      label: 'website_backend.domains.redirect',
      group: 'primary',
      match: (row) => row.redirectToPrimary === true,
    },
  ],
  defaultSort: [{ key: 'host', dir: 'asc' }],
})
