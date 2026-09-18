import type { RelationSelectConfig } from './index.tsx'

// Shared between the design-system's own catalogue specimen and the KetAtlas
// materializer, so both static demos show exactly the same interaction: a closed
// island with a real, multi-entry option list a reader can open, search and choose
// from. There is no `manager`, so search beyond these options, create and remove
// stay no-ops — neither demo has a backend behind it to call.
export const relationSelectDemoConfig: RelationSelectConfig = {
  name: 'partnerId',
  ariaLabel: 'Partner',
  value: 'an-viet',
  options: [
    { value: 'an-viet', label: 'An Việt', description: 'Hà Nội' },
    { value: 'song-xanh', label: 'Sông Xanh', description: 'Đà Nẵng' },
    { value: 'coop-mart', label: 'Coopmart', description: 'TP. Hồ Chí Minh' },
  ],
  labels: {
    choose: 'Choose a partner',
    search: 'Search partners',
    more: 'Browse all',
    noRecords: 'No partners found',
    loading: 'Loading…',
    loadError: 'Could not load partners',
    dialogTitle: 'Choose a partner',
    close: 'Close',
    select: 'Select',
    create: 'Create partner',
    edit: 'Edit',
    save: 'Save',
    cancel: 'Cancel',
    remove: 'Remove',
    confirmRemove: 'Confirm remove',
    retry: 'Retry',
    clear: 'Clear',
    chosen: 'Chosen',
  },
}
