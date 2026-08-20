import type { JSXChild, TemplateResult } from 'ketjs-view'
import type { MenuNode, Translator } from 'ketjs'
import {
  framed,
  emptyState,
  badge,
  code,
  dataTable,
  inline,
  icon,
  kanbanCard,
  kanbanGrid,
  linkButton,
  mediaPanel,
  recordForm,
  recordToggle,
  recordWorkspace,
  section,
  stack,
  surface,
  tabs,
} from '../../ui/index.ts'
import type { Column, DataTable, FormOption, Frame } from '../../ui/index.ts'

const mediaLabels = (_: Translator) => ({
  unavailable: _('product_backend.media.unavailable'),
  empty: _('product_backend.media.empty'),
  loading: _('product_backend.media.loading'),
  loadError: _('product_backend.media.error'),
  retryHint: _('product_backend.media.retry'),
  primary: _('product_backend.media.primaryLabel'),
  makePrimary: _('product_backend.media.primary'),
  moveUp: _('product_backend.media.up'),
  moveDown: _('product_backend.media.down'),
  remove: _('product_backend.media.remove'),
  choose: _('product_backend.media.choose'),
  add: _('product_backend.media.add'),
})

const selectionLabel = (_: Translator, group: string, value: unknown): string => {
  const raw = String(value)
  const key = `product_backend.${group}.${raw}`
  return _.resolves(key) ? _(key) : raw
}
const localized = (path: string, locale: string): string => {
  if (!locale) return path
  const target = new URL(path, 'http://ket.local')
  const lang = new URLSearchParams(locale.replace(/^\?/, '')).get('lang')
  if (lang) target.searchParams.set('lang', lang)
  return `${target.pathname}${target.search}`
}

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

export const PRODUCT_DETAIL_TABS = ['general', 'variants', 'media'] as const
export type ProductDetailTab = (typeof PRODUCT_DETAIL_TABS)[number]

export const VARIANT_DETAIL_TABS = ['general', 'media'] as const
export type VariantDetailTab = (typeof VARIANT_DETAIL_TABS)[number]

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
  locale = '',
): TemplateResult =>
  framed(
    _,
    _('product_backend.screen.title'),
    frame,
    stack([
      inline([
        linkButton({
          label: _('product_backend.action.create'),
          href: localized('/admin/products/new', locale),
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
    isStorable?: boolean
    tracking?: string
  },
  media: Parameters<typeof mediaPanel>[0],
  management: {
    uoms: FormOption[]
    categories: FormOption[]
    attributes: FormOption[]
    variants: Array<{ id: string; defaultCode?: string | null; barcode?: string | null; active?: boolean }>
    stockEnabled?: boolean
    errors?: string[]
    editor?: JSXChild
  },
  collaboration: JSXChild,
  frame: Frame = {},
  locale = '',
  activeTab: ProductDetailTab = 'general',
): TemplateResult => {
  const images = media.images ?? []
  const primaryImage = images.find((image) => image.primary) ?? images[0]
  const unit = management.uoms.find((option) => option.value === row.uomId)?.label
  const category = management.categories.find((option) => option.value === row.categoryId)?.label
  const reference =
    management.variants.length === 1 && management.variants[0]?.defaultCode
      ? `${_('product_backend.field.defaultCode')}: ${management.variants[0].defaultCode}`
      : null
  const subtitle = [reference, category, unit].filter(Boolean).join(' · ')
  const tabHref = (tab: ProductDetailTab) => localized(`/admin/products/${row.id}?tab=${tab}`, locale)
  const productFormId = 'product-detail-form'
  const productToggle = (name: string, label: string, checked: boolean) =>
    recordToggle({
      name,
      label,
      checked,
      form: activeTab === 'general' ? productFormId : null,
      disabled: activeTab !== 'general',
    })
  const general = recordForm({
    id: productFormId,
    action: localized(`/admin/products/${row.id}?tab=general`, locale),
    submit: _('product_backend.action.save'),
    submitVariant: 'primary',
    scope: 'product-detail',
    errors: management.errors,
    fields: [
      {
        name: 'type',
        label: _('product_backend.field.productKind'),
        type: 'radio',
        value: row.type,
        required: true,
        span: 'full',
        options: ['goods', 'service'].map((value) => ({
          value,
          label: selectionLabel(_, 'type', value),
        })),
      },
      { name: 'name', label: _('product_backend.field.name'), value: row.name, required: true },
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
      ...(management.stockEnabled
        ? [
            {
              name: 'tracking',
              label: _('product_backend.field.tracking'),
              type: 'select' as const,
              value: row.tracking ?? 'none',
              options: ['none', 'lot', 'serial'].map((value) => ({
                value,
                label: selectionLabel(_, 'tracking', value),
              })),
            },
          ]
        : []),
      {
        name: 'description',
        label: _('product_backend.field.description'),
        type: 'textarea',
        value: row.description,
        span: 'full',
      },
    ],
  })

  const variants = stack([
    section({
      title: _('product_backend.variants.title'),
      actions: recordForm({
        action: localized(`/admin/products/${row.id}/variants/generate?tab=variants`, locale),
        submit: _('product_backend.variants.generate'),
        submitVariant: 'secondary',
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
                      href: localized(`/admin/products/${row.id}/variants/${variant.id}`, locale),
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
                  cell: (variant) => {
                    const state = variant.active === false ? 'archived' : 'active'
                    return badge(selectionLabel(_, 'state', state), 'neutral', state)
                  },
                },
              ],
            }),
    }),
    section({
      title: _('product_backend.attributes.lines'),
      description: _('product_backend.attributes.linesHint'),
      body: surface({
        padding: 'compact',
        body: recordForm({
          action: localized(`/admin/products/${row.id}/attribute-lines?tab=variants`, locale),
          submit: _('product_backend.action.add'),
          submitVariant: 'secondary',
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
    }),
  ])

  const mediaTab = section({
    title: _('product_backend.media.title'),
    description: _('product_backend.media.description'),
    body: mediaPanel({ ...media, labels: mediaLabels(_) }),
  })

  return framed(
    _,
    _('product_backend.detail.kicker'),
    frame,
    recordWorkspace({
      kicker: _('product_backend.detail.kicker'),
      title: row.name,
      subtitle,
      image: primaryImage ? { src: primaryImage.src, alt: primaryImage.alt } : null,
      imageFallback: icon('package'),
      badges: [
        productToggle('saleOk', _('product_backend.field.saleOk'), row.saleOk === true),
        productToggle('purchaseOk', _('product_backend.field.purchaseOk'), row.purchaseOk === true),
        ...(management.stockEnabled
          ? [productToggle('isStorable', _('product_backend.field.isStorable'), row.isStorable === true)]
          : []),
      ],
      summary: [
        {
          id: 'variants',
          label: _('product_backend.summary.variants'),
          value: management.variants.length,
          href: tabHref('variants'),
        },
        {
          id: 'media',
          label: _('product_backend.summary.images'),
          value: images.length,
          href: tabHref('media'),
        },
        ...(management.stockEnabled
          ? [
              {
                id: 'tracking',
                label: _('product_backend.summary.tracking'),
                value: selectionLabel(_, 'tracking', row.tracking ?? 'none'),
              },
            ]
          : []),
      ],
      navigation: tabs({
        label: _('product_backend.tabs.label'),
        items: [
          {
            id: 'general',
            label: _('product_backend.tabs.general'),
            href: tabHref('general'),
            active: activeTab === 'general',
          },
          {
            id: 'variants',
            label: _('product_backend.tabs.variants'),
            href: tabHref('variants'),
            active: activeTab === 'variants',
            count: management.variants.length,
          },
          {
            id: 'media',
            label: _('product_backend.tabs.media'),
            href: tabHref('media'),
            active: activeTab === 'media',
            count: images.length,
          },
        ],
      }),
      controller: management.editor,
      body: activeTab === 'variants' ? variants : activeTab === 'media' ? mediaTab : general,
      aside: collaboration,
      asideLabel: _('product_backend.collaboration.label'),
    }),
  )
}

export const newProductScreen = (
  _: Translator,
  options: { uoms: FormOption[]; categories: FormOption[]; stockEnabled?: boolean; errors?: string[] },
  frame: Frame,
  locale = '',
): TemplateResult =>
  framed(
    _,
    _('product_backend.create.title'),
    frame,
    surface({
      body: recordForm({
        action: localized('/admin/products/new', locale),
        submit: _('product_backend.action.create'),
        submitVariant: 'primary',
        cancelHref: localized('/admin/products', locale),
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
          ...(options.stockEnabled
            ? [
                {
                  name: 'isStorable',
                  label: _('product_backend.field.isStorable'),
                  type: 'checkbox' as const,
                  value: true,
                },
                {
                  name: 'tracking',
                  label: _('product_backend.field.tracking'),
                  type: 'select' as const,
                  value: 'none',
                  options: ['none', 'lot', 'serial'].map((value) => ({
                    value,
                    label: selectionLabel(_, 'tracking', value),
                  })),
                },
              ]
            : []),
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
  template: { name: string },
  collaboration: JSXChild,
  frame: Frame,
  errors?: string[],
  locale = '',
  editor?: JSXChild,
  activeTab: VariantDetailTab = 'general',
): TemplateResult => {
  const images = media.images ?? []
  const primaryImage = images.find((image) => image.primary) ?? images[0]
  const productUom = Array.isArray(row.uoms)
    ? (row.uoms[0] as Record<string, unknown> | undefined)
    : undefined
  const tabHref = (tab: VariantDetailTab) =>
    localized(`/admin/products/${templateId}/variants/${String(row.id)}?tab=${tab}`, locale)
  const title = String(row.defaultCode || template.name || row.id)
  const subtitle = [
    `${_('product_backend.variant.template')}: ${template.name}`,
    row.combinationKey ? `${_('product_backend.variant.combination')}: ${String(row.combinationKey)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const general = recordForm({
    id: 'product-variant-form',
    action: tabHref('general'),
    submit: _('product_backend.action.save'),
    submitVariant: 'primary',
    scope: 'product-variant',
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
        value: productUom?.uomId ? String(productUom.uomId) : '',
        options: [{ value: '', label: '—' }, ...uoms],
      },
      {
        name: 'uomBarcode',
        label: _('product_backend.field.uomBarcode'),
        value: String(productUom?.barcode ?? ''),
      },
    ],
  })
  const mediaTab = section({
    title: _('product_backend.media.title'),
    description: _('product_backend.media.description'),
    body: mediaPanel({ ...media, labels: mediaLabels(_) }),
  })

  return framed(
    _,
    title,
    frame,
    recordWorkspace({
      kicker: _('product_backend.variant.kicker'),
      title,
      subtitle,
      image: primaryImage ? { src: primaryImage.src, alt: primaryImage.alt } : null,
      imageFallback: icon('package'),
      summary: [
        {
          id: 'media',
          label: _('product_backend.summary.images'),
          value: images.length,
          href: tabHref('media'),
        },
        {
          id: 'state',
          label: _('product_backend.col.state'),
          value: selectionLabel(_, 'state', row.active === false ? 'archived' : 'active'),
        },
      ],
      navigation: tabs({
        label: _('product_backend.variant.tabs.label'),
        items: [
          {
            id: 'general',
            label: _('product_backend.tabs.general'),
            href: tabHref('general'),
            active: activeTab === 'general',
          },
          {
            id: 'media',
            label: _('product_backend.tabs.media'),
            href: tabHref('media'),
            active: activeTab === 'media',
            count: images.length,
          },
        ],
      }),
      controller: editor,
      body: activeTab === 'media' ? mediaTab : general,
      aside: collaboration,
      asideLabel: _('product_backend.variant.collaboration.label'),
    }),
  )
}
