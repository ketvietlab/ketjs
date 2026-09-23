// What the search-filter bar offers on the sign-in provider lists.
//
// Both are complete collections the route already holds, so each spec covers
// the columns its table renders. A provider's `active` field is filterable,
// which is what gives the bar its archived toggle: the same `?archived=1` the
// route reads to ask the domain function for archived providers.
import { defineRowList } from '../backend/row-list.ts'

export const providerListSearch = defineRowList({
  key: 'oauth.providers',
  searchable: [{ key: 'name' }, { key: 'code' }, { key: 'issuer' }],
  filterable: [
    { key: 'name', label: 'oauth_backend.field.name', type: 'text' },
    { key: 'code', label: 'oauth_backend.field.code', type: 'text' },
    { key: 'issuer', label: 'oauth_backend.field.issuer', type: 'text' },
    { key: 'autoProvision', label: 'oauth_backend.field.autoProvision', type: 'boolean' },
    { key: 'active', label: 'oauth_backend.field.state', type: 'boolean' },
  ],
  groupable: [{ key: 'autoProvision', label: 'oauth_backend.field.autoProvision' }],
  sortable: [
    { key: 'name', label: 'oauth_backend.field.name' },
    { key: 'code', label: 'oauth_backend.field.code' },
  ],
  presets: [
    {
      key: 'autoProvision',
      label: 'oauth_backend.field.autoProvision',
      group: 'autoProvision',
      match: (row) => row.autoProvision === true,
    },
  ],
  defaultSort: [{ key: 'name', dir: 'asc' }],
})

export const identityListSearch = defineRowList({
  key: 'oauth.identities',
  searchable: [{ key: 'user' }, { key: 'provider' }, { key: 'subject' }, { key: 'email' }],
  filterable: [
    { key: 'user', label: 'oauth_backend.field.user', type: 'text' },
    { key: 'provider', label: 'oauth_backend.field.provider', type: 'text' },
    { key: 'subject', label: 'oauth_backend.field.subject', type: 'text' },
    { key: 'email', label: 'oauth_backend.field.email', type: 'text' },
    { key: 'lastLoginAt', label: 'oauth_backend.field.lastLogin', type: 'datetime' },
  ],
  groupable: [{ key: 'provider', label: 'oauth_backend.field.provider' }],
  sortable: [
    { key: 'user', label: 'oauth_backend.field.user' },
    { key: 'lastLoginAt', label: 'oauth_backend.field.lastLogin' },
  ],
  presets: [
    {
      // An identity that has never signed in is the one worth finding: it was
      // linked and then never used.
      key: 'neverUsed',
      label: 'oauth_backend.state.never',
      group: 'lastLoginAt',
      match: (row) => !row.lastLoginAt,
    },
  ],
  // The user and the provider are named through the joined records the list
  // renders, not through columns of the identity itself.
  value: (row, key) => {
    const joined = (name: 'user' | 'provider') => {
      const held = row[name] as { name?: string; login?: string; code?: string } | null | undefined
      return held?.name || held?.login || held?.code || row[`${name}Id`]
    }
    return key === 'user' || key === 'provider' ? joined(key) : row[key]
  },
  defaultSort: [{ key: 'user', dir: 'asc' }],
})
