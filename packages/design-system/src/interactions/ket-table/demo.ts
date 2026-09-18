import type { KetTableConfig } from './index.tsx'

// Shared between the design-system's own catalogue specimen and (potentially) an
// atlas-style static demo, same role as `search-filter/demo.ts`. There is no
// `manager`, so sort/pager stay visibly present but inert — a viewer can still
// select rows and expand the pre-populated group, which needs no round trip.
export const ketTableDemoConfig: KetTableConfig = {
  idField: 'id',
  rowHrefTemplate: '#ket-table/{id}',
  columns: [
    {
      key: 'name',
      label: 'Name',
      format: { kind: 'person', field: 'name' },
      priority: 'primary',
      width: 'wide',
    },
    {
      key: 'kind',
      label: 'Kind',
      format: {
        kind: 'status',
        field: 'kind',
        tones: {
          company: { label: 'Company', tone: 'info' },
          person: { label: 'Person', tone: 'neutral' },
        },
      },
      sortable: true,
    },
    { key: 'ref', label: 'Ref', format: { kind: 'identifier', field: 'ref' } },
    {
      key: 'total',
      label: 'Total',
      format: { kind: 'currency', field: 'total', currency: 'VND' },
      align: 'end',
      sortable: true,
    },
    { key: 'createdAt', label: 'Created on', format: { kind: 'date', field: 'createdAt' }, sortable: true },
    {
      key: 'state',
      label: 'State',
      format: {
        kind: 'status',
        field: 'state',
        tones: {
          active: { label: 'Active', tone: 'positive' },
          archived: { label: 'Archived', tone: 'neutral' },
        },
      },
    },
  ],
  rows: [
    {
      id: 'p1',
      name: 'Ngọc Linh Trading',
      kind: 'company',
      ref: 'CUS-0001',
      total: 4_250_000,
      createdAt: '2026-06-02',
      state: 'active',
    },
    {
      id: 'p2',
      name: 'Trần Minh Anh',
      kind: 'person',
      ref: 'CUS-0002',
      total: 890_000,
      createdAt: '2026-06-11',
      state: 'active',
    },
    {
      id: 'p3',
      name: 'Việt Phát Logistics',
      kind: 'company',
      ref: 'CUS-0003',
      total: 12_400_000,
      createdAt: '2026-05-28',
      state: 'archived',
    },
  ],
  total: 3,
  selection: { formId: 'demo-ket-table-bulk' },
  manager: { listFunction: '', pageSize: 5 },
  labels: {
    selectAll: 'Select all rows',
    selectRow: 'Select row',
    sortedAscending: 'Sorted ascending',
    sortedDescending: 'Sorted descending',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    loading: 'Loading…',
    loadError: 'Could not load rows',
    retry: 'Retry',
    empty: 'No records',
    emptyHint: 'There is nothing to show yet.',
  },
}

// A second, grouped demo — the tree is pre-populated (no `manager`), so
// expanding either group needs no round trip, exactly like the flat demo above.
export const ketTableGroupedDemoConfig: KetTableConfig = {
  ...ketTableDemoConfig,
  rows: [],
  groupBy: ['kind'],
  groups: [
    {
      id: 'company',
      label: 'Company',
      count: 2,
      rows: [
        {
          id: 'p1',
          name: 'Ngọc Linh Trading',
          kind: 'company',
          ref: 'CUS-0001',
          total: 4_250_000,
          createdAt: '2026-06-02',
          state: 'active',
        },
        {
          id: 'p3',
          name: 'Việt Phát Logistics',
          kind: 'company',
          ref: 'CUS-0003',
          total: 12_400_000,
          createdAt: '2026-05-28',
          state: 'archived',
        },
      ],
    },
    {
      id: 'person',
      label: 'Person',
      count: 1,
      rows: [
        {
          id: 'p2',
          name: 'Trần Minh Anh',
          kind: 'person',
          ref: 'CUS-0002',
          total: 890_000,
          createdAt: '2026-06-11',
          state: 'active',
        },
      ],
    },
  ],
}
