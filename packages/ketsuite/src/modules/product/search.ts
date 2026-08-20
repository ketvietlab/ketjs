import { defineListSearch, eq } from 'ketjs'
import type { ListState, Table } from 'ketjs'

export const emptyProductListState = (): ListState => ({
  presets: [],
  filters: [],
  groupBy: [],
  sort: [{ key: 'name', dir: 'asc' }],
  openGroups: [],
  groupPages: {},
  page: 1,
  includeArchived: false,
})

export const productListSearch = (T: Table) =>
  defineListSearch({
    key: 'product.templates',
    searchable: [
      { key: 'name', col: T.name! },
      { key: 'description', col: T.description! },
    ],
    filterable: [
      { key: 'name', label: 'Name', col: T.name!, type: 'text' },
      { key: 'description', label: 'Description', col: T.description!, type: 'text' },
      { key: 'type', label: 'Type', col: T.type!, type: 'selection', choices: ['goods', 'service'] },
      { key: 'categoryId', label: 'Category', col: T.categoryId!, type: 'reference' },
      { key: 'uomId', label: 'Unit of measure', col: T.uomId!, type: 'reference' },
      { key: 'listPrice', label: 'Sales price', col: T.listPrice!, type: 'number' },
      { key: 'saleOk', label: 'Can be sold', col: T.saleOk!, type: 'boolean' },
      { key: 'purchaseOk', label: 'Can be purchased', col: T.purchaseOk!, type: 'boolean' },
      { key: 'active', label: 'Active', col: T.active!, type: 'boolean' },
      { key: 'createdAt', label: 'Created at', col: T.createdAt!, type: 'datetime' },
      { key: 'updatedAt', label: 'Updated at', col: T.updatedAt!, type: 'datetime' },
    ],
    groupable: [
      { key: 'type', label: 'Type', col: T.type! },
      { key: 'categoryId', label: 'Category', col: T.categoryId! },
      { key: 'uomId', label: 'Unit of measure', col: T.uomId! },
      { key: 'active', label: 'Active', col: T.active! },
      { key: 'saleOk', label: 'Can be sold', col: T.saleOk! },
      { key: 'purchaseOk', label: 'Can be purchased', col: T.purchaseOk! },
      {
        key: 'createdAt',
        label: 'Created at',
        col: T.createdAt!,
        intervals: ['day', 'week', 'month', 'quarter', 'year'],
      },
      {
        key: 'updatedAt',
        label: 'Updated at',
        col: T.updatedAt!,
        intervals: ['day', 'week', 'month', 'quarter', 'year'],
      },
    ],
    sortable: [
      { key: 'name', label: 'Name', col: T.name! },
      { key: 'type', label: 'Type', col: T.type! },
      { key: 'listPrice', label: 'Sales price', col: T.listPrice! },
      { key: 'createdAt', label: 'Created at', col: T.createdAt! },
      { key: 'updatedAt', label: 'Updated at', col: T.updatedAt! },
    ],
    presets: [
      { key: 'goods', label: 'Goods', group: 'type', expr: eq(T.type!, 'goods') },
      { key: 'service', label: 'Services', group: 'type', expr: eq(T.type!, 'service') },
      { key: 'sale', label: 'Can be sold', group: 'sale', expr: eq(T.saleOk!, true) },
      { key: 'purchase', label: 'Can be purchased', group: 'purchase', expr: eq(T.purchaseOk!, true) },
    ],
    defaultSort: [{ key: 'name', dir: 'asc' }],
  })
