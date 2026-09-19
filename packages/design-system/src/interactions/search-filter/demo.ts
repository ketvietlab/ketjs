import type { SearchFilterConfig } from './index.tsx'

// Shared between the design-system's own catalogue specimen and the KetAtlas
// materializer, so both static demos show exactly the same interaction: a search
// bar with a mix of predefined and ad-hoc facets already applied, and one caret
// toggle a reader can open to see the Filters/Group By/Favorites columns. There is
// no `manager`, so toggling anything stays local — neither demo has a backend
// behind it to call.
export const searchFilterDemoConfig: SearchFilterConfig = {
  name: 'orders',
  facets: [
    { id: 'open', type: 'filter', label: 'Open' },
    { id: 'customer', type: 'groupBy', label: 'Customer' },
    { id: 'fav-open-orders', type: 'favorite', label: 'My open orders' },
  ],
  filters: [
    { id: 'open', label: 'Open', active: true, group: 'status' },
    { id: 'closed', label: 'Closed', active: false, group: 'status' },
    { id: 'archived', label: 'Archived', active: false, group: 'status' },
    {
      id: 'created',
      label: 'Created on',
      active: false,
      group: 'date',
      options: [
        { id: 'created-today', label: 'Today', active: false },
        { id: 'created-week', label: 'This week', active: false },
        { id: 'created-month', label: 'This month', active: false },
      ],
    },
  ],
  groupBy: [
    { id: 'customer', label: 'Customer', active: true },
    { id: 'status', label: 'Status', active: false },
    { id: 'createdMonth', label: 'Order date', active: false },
  ],
  favorites: [
    { id: 'fav-open-orders', label: 'My open orders', isDefault: true, active: true },
    { id: 'fav-overdue', label: 'Overdue', isDefault: false, active: false },
  ],
  customFilterFields: [
    { value: 'reference', label: 'Reference', type: 'text' },
    { value: 'total', label: 'Total', type: 'number' },
    { value: 'confirmed', label: 'Confirmed', type: 'boolean' },
    { value: 'createdAt', label: 'Created on', type: 'date' },
  ],
  labels: {
    searchLabel: 'Search orders',
    searchPlaceholder: 'Search orders…',
    toggleLabel: 'Toggle search panel',
    searchGenericLabel: 'Search for',
    searchFieldPrefix: 'Search',
    searchFieldPreposition: 'for',
    filters: 'Filters',
    groupBy: 'Group by',
    groupByApplied: 'Currently grouped by',
    groupByAdd: 'Add grouping field',
    groupByClear: 'Clear all',
    groupByMoveEarlier: 'Move earlier',
    groupByMoveLater: 'Move later',
    favorites: 'Favorites',
    customFilterField: 'Field',
    customFilterOperator: 'Condition',
    customFilterValue: 'Value',
    customFilterAdd: 'Add custom filter',
    customGroupByPlaceholder: 'Add custom group',
    saveSearch: 'Save current search',
    favoriteName: 'Name',
    favoriteDefault: 'Default',
    favoriteSaveAction: 'Save',
    favoriteRemove: 'Remove favorite',
    favoriteSetDefault: 'Set as default',
    noFavorites: 'No saved searches yet',
    clear: 'Remove',
    applyError: 'Could not apply the search',
    retry: 'Retry',
  },
}
