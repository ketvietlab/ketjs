import type { TemplateResult } from 'ketjs-view'
import type { MenuNode, Translator } from 'ketjs'
import {
  framed,
  emptyState,
  badge,
  code,
  contentCard,
  dataTable,
  inline,
  kanbanCard,
  kanbanGrid,
  linkButton,
  mediaPanel,
  recordForm,
  section,
  stack,
  surface,
} from '../../ui/index.ts'
import type { Column, DataTable, FormOption, Frame } from '../../ui/index.ts'

const mediaLabels = (_: Translator) => ({
  unavailable: _('product_backend.media.unavailable'),
  empty: _('product_backend.media.empty'),
  loading: _('product_backend.media.loading'),
  loadError: _('product_backend.media.error'),
  retryHint: _('product_backend.media.retry'),
  makePrimary: _('product_backend.media.primary'),
  moveUp: _('product_backend.media.up'),
  moveDown: _('product_backend.media.down'),
  remove: _('product_backend.media.remove'),
  choose: _('product_backend.media.choose'),
  add: _('product_backend.media.add'),
})

export type TemplateRow = {
  id: string
  name: string
  type: string
  categoryId: string | null
  uomId: string | null
  variants: number
}

/** The two ways to look at the same rows. More can be added; each is a real page. */
export const VIEWS = ['list', 'kanban'] as const
export type View = (typeof VIEWS)[number]

/**
 * The catalogue's columns, as data — so a module that adds a field to
 * `product.Template` has something to name when it wants a column for it.
 *
 * Goods and services are not a good/bad axis, so neither gets a judgemental tone.
 * The id and the category are off by default: useful to a specialist, noise to
 * everyone else.
 */
export const templateColumns = (_: Translator): Array<Column<TemplateRow>> => [
  { key: 'name', label: _('product_backend.col.name'), cell: (r) => r.name, priority: 'primary' },
  {
    key: 'type',
    label: _('product_backend.col.type'),
    kind: 'status',
    priority: 'secondary',
    cell: (r) =>
      badge(_(`product_backend.type.${r.type}`), r.type === 'service' ? 'info' : 'neutral', r.type),
  },
  {
    key: 'uom',
    label: _('product_backend.col.uom'),
    cell: (r) => (r.uomId ? code(r.uomId, 'unit') : '—'),
    kind: 'identifier',
  },
  {
    key: 'variants',
    label: _('product_backend.col.variants'),
    cell: (r) => String(r.variants),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'category',
    label: _('product_backend.col.category'),
    cell: (r) => r.categoryId ?? '—',
    priority: 'tertiary',
    optional: true,
  },
  {
    key: 'id',
    label: _('backend.table.id'),
    cell: (r) => code(r.id, 'identifier'),
    kind: 'identifier',
    priority: 'tertiary',
    optional: true,
  },
]

const kanban = (_: Translator, rows: readonly TemplateRow[]): TemplateResult =>
  kanbanGrid({
    rows,
    id: (r) => r.id,
    card: (r) =>
      kanbanCard({
        key: r.id,
        title: r.name,
        meta: inline([
          badge(_(`product_backend.type.${r.type}`), r.type === 'service' ? 'info' : 'neutral', r.type),
          r.uomId ? code(r.uomId, 'unit') : '',
        ]),
        note: `${_('product_backend.col.variants')}: ${String(r.variants)}`,
      }),
  })

/**
 * The catalogue, in the frame the backend already owns.
 *
 * It reuses `framed` and `dataTable` rather than building its own: a second frame
 * is a frame that drifts, and the sidebar, chrome and row height are not this
 * module's to reinvent. The two views are two renderings of the same rows, not
 * two screens.
 */
export const productsScreen = (
  _: Translator,
  rows: TemplateRow[],
  view: View,
  frame: Frame = {},
  table: Partial<DataTable<TemplateRow>> = {},
): TemplateResult =>
  framed(
    _,
    _('product_backend.screen.title'),
    frame,
    stack([
      inline([
        linkButton({
          label: _('product_backend.action.create'),
          href: '/admin/products/new',
          variant: 'primary',
        }),
      ]),
      rows.length === 0
        ? emptyState(_('product_backend.screen.empty.message'), _('product_backend.screen.empty.hint'))
        : view === 'kanban'
          ? kanban(_, rows)
          : dataTable(_, { columns: templateColumns(_), rows, id: (r) => r.id, ...table }),
    ]),
  )

export type { MenuNode }

export const productDetailScreen = (
  _: Translator,
  row: {
    id: string
    name: string
    type: string
    description?: string | null
    listPrice: number
    uomId: string | null
    categoryId?: string | null
    saleOk?: boolean
    purchaseOk?: boolean
  },
  media: Parameters<typeof mediaPanel>[0],
  management: {
    uoms: FormOption[]
    categories: FormOption[]
    attributes: FormOption[]
    variants: Array<{ id: string; defaultCode?: string | null; barcode?: string | null; active?: boolean }>
    errors?: string[]
  },
  frame: Frame = {},
): TemplateResult =>
  framed(
    _,
    row.name,
    frame,
    stack([
      section({
        title: _('product_backend.media.title'),
        description: _('product_backend.media.description'),
        body: mediaPanel({
          ...media,
          labels: mediaLabels(_),
        }),
      }),
      section({
        title: _('product_backend.detail.information'),
        body: surface({
          body: recordForm({
            action: `/admin/products/${row.id}`,
            submit: _('product_backend.action.save'),
            errors: management.errors,
            fields: [
              { name: 'name', label: _('product_backend.field.name'), value: row.name, required: true },
              {
                name: 'type',
                label: _('product_backend.field.type'),
                type: 'select',
                value: row.type,
                options: [
                  { value: 'goods', label: _('product_backend.type.goods') },
                  { value: 'service', label: _('product_backend.type.service') },
                ],
              },
              {
                name: 'uomId',
                label: _('product_backend.field.uom'),
                type: 'select',
                value: row.uomId,
                options: [{ value: '', label: '—' }, ...management.uoms],
              },
              {
                name: 'categoryId',
                label: _('product_backend.field.category'),
                type: 'select',
                value: row.categoryId,
                options: [{ value: '', label: '—' }, ...management.categories],
              },
              {
                name: 'listPrice',
                label: _('product_backend.field.listPrice'),
                type: 'decimal',
                value: row.listPrice,
              },
              {
                name: 'saleOk',
                label: _('product_backend.field.saleOk'),
                type: 'checkbox',
                value: row.saleOk,
              },
              {
                name: 'purchaseOk',
                label: _('product_backend.field.purchaseOk'),
                type: 'checkbox',
                value: row.purchaseOk,
              },
              {
                name: 'description',
                label: _('product_backend.field.description'),
                type: 'textarea',
                value: row.description,
                span: 'full',
              },
            ],
          }),
        }),
      }),
      section({
        title: _('product_backend.variants.title'),
        actions: recordForm({
          action: `/admin/products/${row.id}/variants/generate`,
          submit: _('product_backend.variants.generate'),
          fields: [],
        }),
        body:
          management.variants.length === 0
            ? emptyState(_('product_backend.variants.empty'), _('product_backend.variants.generate'))
            : dataTable(_, {
                rows: management.variants,
                id: (variant) => variant.id,
                columns: [
                  {
                    key: 'code',
                    label: _('product_backend.field.defaultCode'),
                    cell: (variant) =>
                      linkButton({
                        label: variant.defaultCode || variant.id,
                        href: `/admin/products/${row.id}/variants/${variant.id}`,
                        variant: 'tertiary',
                      }),
                  },
                  {
                    key: 'barcode',
                    label: _('product_backend.field.barcode'),
                    cell: (variant) => variant.barcode ?? '—',
                  },
                  {
                    key: 'active',
                    label: _('product_backend.col.state'),
                    cell: (variant) => badge(variant.active === false ? 'archived' : 'active'),
                  },
                ],
              }),
      }),
      section({
        title: _('product_backend.attributes.lines'),
        description: _('product_backend.attributes.linesHint'),
        body: recordForm({
          action: `/admin/products/${row.id}/attribute-lines`,
          submit: _('product_backend.action.add'),
          fields: [
            {
              name: 'attributeId',
              label: _('product_backend.attributes.attribute'),
              type: 'select',
              options: management.attributes,
              required: true,
            },
            {
              name: 'valueIds',
              label: _('product_backend.attributes.values'),
              help: _('product_backend.attributes.valuesHint'),
              required: true,
            },
          ],
        }),
      }),
    ]),
  )

export const newProductScreen = (
  _: Translator,
  options: { uoms: FormOption[]; categories: FormOption[]; errors?: string[] },
  frame: Frame,
): TemplateResult =>
  framed(
    _,
    _('product_backend.create.title'),
    frame,
    surface({
      body: recordForm({
        action: '/admin/products/new',
        submit: _('product_backend.action.create'),
        cancelHref: '/admin/products',
        cancelLabel: _('product_backend.action.cancel'),
        errors: options.errors,
        fields: [
          { name: 'name', label: _('product_backend.field.name'), required: true },
          {
            name: 'type',
            label: _('product_backend.field.type'),
            type: 'select',
            options: [
              { value: 'goods', label: _('product_backend.type.goods') },
              { value: 'service', label: _('product_backend.type.service') },
            ],
          },
          { name: 'uomId', label: _('product_backend.field.uom'), type: 'select', options: options.uoms },
          {
            name: 'categoryId',
            label: _('product_backend.field.category'),
            type: 'select',
            options: [{ value: '', label: '—' }, ...options.categories],
          },
          { name: 'listPrice', label: _('product_backend.field.listPrice'), type: 'decimal', value: 0 },
          { name: 'saleOk', label: _('product_backend.field.saleOk'), type: 'checkbox', value: true },
          { name: 'purchaseOk', label: _('product_backend.field.purchaseOk'), type: 'checkbox', value: true },
          {
            name: 'description',
            label: _('product_backend.field.description'),
            type: 'textarea',
            span: 'full',
          },
        ],
      }),
    }),
  )

export const variantScreen = (
  _: Translator,
  templateId: string,
  row: Record<string, unknown>,
  media: Parameters<typeof mediaPanel>[0],
  uoms: FormOption[],
  frame: Frame,
  errors?: string[],
): TemplateResult =>
  framed(
    _,
    String(row.defaultCode || row.id),
    frame,
    stack([
      section({
        title: _('product_backend.media.title'),
        description: _('product_backend.media.description'),
        body: mediaPanel({ ...media, labels: mediaLabels(_) }),
      }),
      surface({
        body: recordForm({
          action: `/admin/products/${templateId}/variants/${String(row.id)}`,
          submit: _('product_backend.action.save'),
          errors,
          fields: [
            {
              name: 'defaultCode',
              label: _('product_backend.field.defaultCode'),
              value: String(row.defaultCode ?? ''),
            },
            { name: 'barcode', label: _('product_backend.field.barcode'), value: String(row.barcode ?? '') },
            {
              name: 'weight',
              label: _('product_backend.field.weight'),
              type: 'decimal',
              value: Number(row.weight ?? 0),
            },
            {
              name: 'volume',
              label: _('product_backend.field.volume'),
              type: 'decimal',
              value: Number(row.volume ?? 0),
            },
            {
              name: 'standardPrice',
              label: _('product_backend.field.standardPrice'),
              type: 'decimal',
              value: Number((row.cost as Record<string, unknown> | null)?.standardPrice ?? 0),
            },
            {
              name: 'uomId',
              label: _('product_backend.field.uom'),
              type: 'select',
              options: [{ value: '', label: '—' }, ...uoms],
            },
            { name: 'uomBarcode', label: _('product_backend.field.uomBarcode') },
          ],
        }),
      }),
    ]),
  )

export const attributesScreen = (
  _: Translator,
  rows: Array<Record<string, unknown>>,
  frame: Frame,
  errors?: string[],
): TemplateResult =>
  framed(
    _,
    _('product_backend.attributes.title'),
    frame,
    stack([
      surface({
        body: recordForm({
          action: '/admin/product-attributes',
          submit: _('product_backend.action.create'),
          errors,
          fields: [
            { name: 'name', label: _('product_backend.field.name'), required: true },
            { name: 'sequence', label: _('product_backend.col.sequence'), type: 'number', value: 10 },
            {
              name: 'displayType',
              label: _('product_backend.attributes.displayType'),
              type: 'select',
              options: ['radio', 'pills', 'select', 'color', 'multi'].map((value) => ({
                value,
                label: value,
              })),
            },
            {
              name: 'createVariant',
              label: _('product_backend.attributes.createVariant'),
              type: 'select',
              options: [
                { value: 'always', label: _('product_backend.attributes.always') },
                { value: 'no_variant', label: _('product_backend.attributes.never') },
              ],
            },
          ],
        }),
      }),
      ...rows.map((row) => {
        const values = Array.isArray(row.values) ? (row.values as Array<Record<string, unknown>>) : []
        return contentCard({
          title: String(row.name),
          summary: `${String(row.displayType)} · ${String(row.createVariant)}`,
          meta: values.length
            ? values.map((value) => String(value.name)).join(', ')
            : _('product_backend.attributes.noValues'),
          body: recordForm({
            action: `/admin/product-attributes/${String(row.id)}/values`,
            submit: _('product_backend.action.add'),
            fields: [
              { name: 'name', label: _('product_backend.attributes.valueName'), required: true },
              { name: 'sequence', label: _('product_backend.col.sequence'), type: 'number', value: 10 },
            ],
          }),
        })
      }),
    ]),
  )
