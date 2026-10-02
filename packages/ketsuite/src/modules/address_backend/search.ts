// What the search-filter bar offers on the address catalogue list.
//
// The list is the packaged catalogues the deployment ships, read whole, so the
// spec covers exactly the columns the table renders. Whether a catalogue is
// installed is the one question readers ask of it, so that is its preset group.
import { defineRowList } from '../backend/row-list.ts'

export const catalogListSearch = defineRowList({
  key: 'address.catalogs',
  searchable: [{ key: 'countryCode' }, { key: 'version' }, { key: 'status' }],
  filterable: [
    { key: 'countryCode', label: 'address_backend.field.country', type: 'text' },
    { key: 'version', label: 'address_backend.field.version', type: 'text' },
    { key: 'installed', label: 'address_backend.field.status', type: 'boolean' },
    { key: 'recordCount', label: 'address_backend.field.records', type: 'number' },
  ],
  groupable: [
    { key: 'installed', label: 'address_backend.field.status' },
    { key: 'countryCode', label: 'address_backend.field.country' },
  ],
  sortable: [
    { key: 'countryCode', label: 'address_backend.field.country' },
    { key: 'version', label: 'address_backend.field.version' },
  ],
  presets: [
    {
      key: 'installed',
      label: 'address_backend.state.installed',
      group: 'status',
      match: (row) => row.installed === true,
    },
    {
      key: 'available',
      label: 'address_backend.state.available',
      group: 'status',
      match: (row) => row.installed !== true,
    },
  ],
  defaultSort: [{ key: 'countryCode', dir: 'asc' }],
})
