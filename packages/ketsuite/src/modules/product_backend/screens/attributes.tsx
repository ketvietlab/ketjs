import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { Badge, Inline, Notice, Stack } from '@ketvietlab/design-system'
import {
  collectionActions,
  collectionControls,
  collectionTable,
  ListPage,
  prepareCollectionTable,
  recordModalHref,
  shell,
} from '../../../ui/index.ts'
import type { Column, Frame } from '../../../ui/index.ts'
import { ATTRIBUTE_SEARCH_FILTERS } from '../attributes-search.ts'
import { localized, selectionLabel } from '../../backend/screen.ts'

export type AttributeListRow = {
  id: string
  name: string
  displayType: string
  createVariant: string
  values: Array<{ id: string; name: string; htmlColor?: string | null; sequence?: number }>
  editHref?: string
}
export const attributeListColumns = (_: Translator): Column<AttributeListRow>[] => [
  {
    key: 'name',
    label: _('product_backend.field.name'),
    priority: 'primary',
    width: 'wide',
    cell: (row) => row.name,
  },
  {
    key: 'values',
    label: _('product_backend.attributes.values'),
    priority: 'primary',
    cell: (row) => (
      <Inline
        items={[
          ...row.values.slice(0, 3).map((value) => <Badge label={value.name} />),
          ...(row.values.length > 3 ? [<Badge label={`+${row.values.length - 3}`} />] : []),
          ...(!row.values.length ? [<Badge label={_('product_backend.attributes.noValues')} />] : []),
        ]}
      />
    ),
  },
  {
    key: 'displayType',
    label: _('product_backend.attributes.displayType'),
    cell: (row) => selectionLabel(_, 'product_backend', 'displayType', row.displayType),
  },
  {
    key: 'createVariant',
    label: _('product_backend.attributes.createVariant'),
    cell: (row) => selectionLabel(_, 'product_backend', 'createVariant', row.createVariant),
  },
]

/** The same bare presenter is used by the application shell and framework-native mock. */
export const attributesListPage = (
  _: Translator,
  rows: AttributeListRow[],
  frame: Frame,
  errors?: string[],
  locale = '',
): TemplateResult => {
  const url = frame.collectionUrl ?? localized('/admin/product/attributes', locale)
  const location = new URL(url, 'http://ket.local')
  const active = ATTRIBUTE_SEARCH_FILTERS.map((filter) => ({
    ...filter,
    values: filter.values.filter((value) =>
      (location.searchParams.get(filter.key) ?? '').split(',').includes(value),
    ),
  }))
  const orderedRows = rows.map((row) => ({
    ...row,
    values: [...row.values].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.id.localeCompare(b.id)),
  }))
  const prepared = prepareCollectionTable(
    _,
    {
      ...frame,
      collectionUrl: url,
      chrome: {
        ...frame.chrome,
        search: undefined,
      },
    },
    {
      rows: orderedRows.filter((row) =>
        active.every((filter) => !filter.values.length || filter.values.includes(row[filter.key])),
      ),
      columns: attributeListColumns(_),
      id: (row) => row.id,
      rowHref: (row) => row.editHref ?? recordModalHref(url, { kind: 'product.attribute', id: row.id }),
    },
    { paginate: true, searchText: (row) => `${row.name} ${row.values.map((value) => value.name).join(' ')}` },
  )
  if (prepared.frame.chrome) prepared.frame.chrome.search = undefined
  return (
    <ListPage
      variant="operational"
      frame={prepared.frame}
      title={_('product_backend.attributes.title')}
      actions={collectionActions(_, prepared.frame)}
      controls={collectionControls(_, _('product_backend.attributes.title'), prepared.frame)}
      body={
        <Stack
          items={[
            ...(errors?.length
              ? [<Notice tone="danger" title={_('recordModal.errorTitle')} message={errors.join(' · ')} />]
              : []),
            collectionTable(_, prepared.table),
          ]}
        />
      }
    />
  )
}
export const attributesScreen = (
  _: Translator,
  rows: AttributeListRow[],
  frame: Frame,
  errors?: string[],
  locale = '',
): TemplateResult =>
  shell(_, _('product_backend.attributes.title'), attributesListPage(_, rows, frame, errors, locale), {
    ...frame,
    chrome: null,
    topbar: false,
  })
