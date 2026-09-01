import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  badge,
  button,
  FormCluster,
  FormPage,
  formatMoney,
  MediaPanel,
  ProductMediaManagement,
  ProductVariantManagement,
  RecordForm,
  RecordMore,
  Section,
  shell,
  stack,
  Surface,
  Tabs,
} from '../../../ui/index.ts'
import type { FormOption, Frame, MediaItem, MediaPanelProps } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'
import { selectionLabel as resolveSelection } from '../../backend/screen.ts'

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

/** A stable product code in the reader's language; the code itself survives as data. */
const selectionLabel = (_: Translator, group: string, value: unknown): string =>
  resolveSelection(_, 'product_backend', group, value)

export const PRODUCT_DETAIL_TABS = ['general', 'variants', 'media'] as const
export type ProductDetailTab = (typeof PRODUCT_DETAIL_TABS)[number]

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
    brandId?: string | null
    origin?: string | null
    defaultCode?: string | null
    barcode?: string | null
    taxId?: string | null
    saleOk?: boolean
    purchaseOk?: boolean
    active?: boolean
    isStorable?: boolean
    tracking?: string
    createdAt?: string | Date | null
    updatedAt?: string | Date | null
  },
  media: MediaPanelProps,
  management: {
    uoms: FormOption[]
    categories: FormOption[]
    brands: FormOption[]
    taxes: FormOption[]
    taxEnabled?: boolean
    variantAttributes: FormOption[]
    variants: Array<{
      id: string
      name?: string | null
      defaultCode?: string | null
      barcode?: string | null
      stock?: string | number | null
      active?: boolean
      values?: Array<{
        value?: string | null
        attribute?: string | null
      }>
    }>
    /** What the template already carries, so the reader can see and undo it. */
    attributeLines: Array<{
      id: string
      attributeId: string
      attribute?: string | null
      values: Array<{ id: string; name: string }>
    }>
    variantMedia?: Array<{ variantId: string; images: MediaItem[] }>
    variantMediaPage?: {
      page: number
      pageSize: number
      total: number
    }
    variantPage?: {
      page: number
      pageSize: number
      total: number
    }
    stockEnabled?: boolean
    errors?: string[]
    editor?: JSXChild
    /** Actions contributed through the public Product Template extension joint. */
    actions?: JSXChild
    /**
     * Relation pickers, built by the route because they need a request to reach
     * their joint. Absent ones fall back to the plain select beside them, so this
     * screen still renders from a bare options list.
     */
    controls?: {
      uom?: JSXChild
      category?: JSXChild
      brand?: JSXChild
      attribute?: JSXChild
      attributeValues?: JSXChild
    }
  },
  collaboration: JSXChild,
  frame: Frame = {},
  locale = '',
  activeTab: ProductDetailTab = 'general',
  partial = false,
): TemplateResult => {
  const images = media.images ?? []
  const variantTotal = management.variantPage?.total ?? management.variants.length
  const hasRealVariants = variantTotal > 0
  const category = management.categories.find((option) => option.value === row.categoryId)?.label
  const unit = management.uoms.find((option) => option.value === row.uomId)?.label
  const subtitle = (
    activeTab === 'variants'
      ? [
          `${_('product_backend.field.type')}: ${selectionLabel(_, 'type', row.type)}`,
          `${_('product_backend.field.uom')}: ${unit || '—'}`,
          `${_('product_backend.field.listPrice')}: ${formatMoney(_, row.listPrice, 'VND')}`,
        ]
      : [
          `${_('product_backend.field.type')}: ${selectionLabel(_, 'type', row.type)}`,
          `${_('product_backend.col.category')}: ${category || '—'}`,
        ]
  ).join(' · ')
  const tabHref = (tab: ProductDetailTab) =>
    localized(`/admin/product/templates/${row.id}?tab=${tab}`, locale)
  const productFormId = 'product-detail-form'
  const general = (
    <RecordForm
      id={productFormId}
      action={localized(`/admin/product/templates/${row.id}?tab=general`, locale)}
      submit={_('product_backend.action.save')}
      submitVariant="primary"
      submitPlacement="external"
      scope="product-detail"
      errors={management.errors}
      hidden={
        hasRealVariants
          ? {
              defaultCode: String(row.defaultCode ?? ''),
              barcode: String(row.barcode ?? ''),
            }
          : undefined
      }
      fields={[
        {
          name: 'businessUse',
          label: _('product_backend.field.businessUse'),
          type: 'checkbox-group',
          span: 'full',
          options: [
            {
              name: 'saleOk',
              value: '1',
              label: _('product_backend.field.saleOk'),
              checked: row.saleOk === true,
            },
            {
              name: 'purchaseOk',
              value: '1',
              label: _('product_backend.field.purchaseOk'),
              checked: row.purchaseOk === true,
            },
            ...(management.stockEnabled
              ? [
                  {
                    name: 'isStorable',
                    value: '1',
                    label: _('product_backend.field.isStorable'),
                    checked: row.isStorable === true,
                  },
                ]
              : []),
          ],
        },
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
        {
          name: 'name',
          label: _('product_backend.field.name'),
          value: row.name,
          required: true,
          span: 'full',
        },
        {
          name: 'uomId',
          label: _('product_backend.field.uom'),
          type: 'select',
          value: row.uomId,
          options: [{ value: '', label: '—' }, ...management.uoms],
          ...(management.controls?.uom ? { control: management.controls.uom } : {}),
        },
        {
          name: 'listPrice',
          label: _('product_backend.field.listPrice'),
          type: 'decimal',
          value: row.listPrice,
        },
        {
          name: 'categoryId',
          label: _('product_backend.field.category'),
          type: 'select',
          value: row.categoryId,
          options: [{ value: '', label: '—' }, ...management.categories],
          ...(management.controls?.category ? { control: management.controls.category } : {}),
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
        {
          name: 'defaultCode',
          label: _('product_backend.field.defaultCode'),
          value: row.defaultCode,
          disabled: hasRealVariants,
          help: hasRealVariants ? _('product_backend.field.variantIdentityHint') : null,
        },
        {
          name: 'barcode',
          label: _('product_backend.field.barcode'),
          value: row.barcode,
          disabled: hasRealVariants,
          help: hasRealVariants ? _('product_backend.field.variantIdentityHint') : null,
        },
        {
          name: 'brandId',
          label: _('product_backend.field.brand'),
          type: 'select',
          value: row.brandId,
          options: [{ value: '', label: '—' }, ...management.brands],
          ...(management.controls?.brand ? { control: management.controls.brand } : {}),
        },
        ...(management.taxEnabled
          ? [
              {
                name: 'taxId',
                label: _('product_backend.field.taxRate'),
                type: 'select' as const,
                value: row.taxId,
                options: [{ value: '', label: '—' }, ...management.taxes],
              },
            ]
          : []),
        {
          name: 'origin',
          label: _('product_backend.field.origin'),
          value: row.origin,
          span: 'full',
        },
      ]}
    />
  )

  const archived = row.active === false
  const archiveAction = (
    <RecordForm
      action={localized(`/admin/product/templates/${row.id}/archive?tab=${activeTab}`, locale)}
      submit={_(archived ? 'product_backend.archive.restore' : 'product_backend.archive.action')}
      submitVariant={archived ? 'secondary' : 'destructive'}
      submitSize="compact"
      layout="inline"
      hidden={{ active: archived ? '1' : '0' }}
      fields={[]}
    />
  )
  const generalTab = stack(
    [<Section title={_('product_backend.tabs.general')} body={<Surface body={general} />} />],
    'loose',
  )

  const variantCount = variantTotal
  const variantPage = management.variantPage ?? {
    page: 1,
    pageSize: 10,
    total: variantTotal,
  }
  const variantFrom = variantPage.total ? (variantPage.page - 1) * variantPage.pageSize + 1 : 0
  const variantTo = Math.min(variantPage.page * variantPage.pageSize, variantPage.total)
  const variantPageHref = (page: number) =>
    localized(`/admin/product/templates/${row.id}?tab=variants&page=${page}`, locale)
  const variants = (
    <ProductVariantManagement
      attributes={{
        title: _('product_backend.attributes.panelTitle'),
        description: _('product_backend.attributes.panelHint'),
        sortLabel: _('product_backend.attributes.sort'),
        columns: {
          name: _('product_backend.attributes.nameColumn'),
          values: _('product_backend.attributes.values'),
          actions: _('product_backend.attributes.actions'),
        },
        lines: management.attributeLines.map((line) => ({
          id: line.id,
          name: line.attribute || line.attributeId,
          values: line.values.map((value) => value.name),
          editHref: localized('/admin/product/attributes', locale),
          removeAction: localized(
            `/admin/product/templates/${row.id}/attribute-lines/${line.id}/remove?tab=variants`,
            locale,
          ),
        })),
        empty: _('product_backend.attributes.linesEmptyHint'),
        editLabel: _('product_backend.attributes.editLine'),
        removeLabel: _('product_backend.attributes.removeLine'),
        addLabel: _('product_backend.attributes.addLine'),
        addForm: (
          <RecordForm
            action={localized(`/admin/product/templates/${row.id}/attribute-lines?tab=variants`, locale)}
            submit={_('product_backend.action.add')}
            submitVariant="secondary"
            fields={[
              {
                name: 'attributeId',
                label: _('product_backend.attributes.attribute'),
                type: 'select',
                options: [{ value: '', label: '—' }, ...management.variantAttributes],
                required: true,
                ...(management.controls?.attribute ? { control: management.controls.attribute } : {}),
              },
              {
                name: 'valueIds',
                label: _('product_backend.attributes.values'),
                help: _('product_backend.attributes.valuesHint'),
                required: true,
                span: 'full' as const,
                ...(management.controls?.attributeValues
                  ? { control: management.controls.attributeValues }
                  : {}),
              },
            ]}
          />
        ),
      }}
      variants={{
        title: _('product_backend.variants.title'),
        description: _('product_backend.variants.panelHint'),
        generateLabel: _('product_backend.variants.generate'),
        generateAction: localized(
          `/admin/product/templates/${row.id}/variants/generate?tab=variants`,
          locale,
        ),
        refreshLabel: _('product_backend.variants.refresh'),
        columns: {
          code: _('product_backend.variants.code'),
          values: _('product_backend.variants.values'),
          sku: _('product_backend.variants.sku'),
          price: _('product_backend.field.listPrice'),
          stock: _('product_backend.variants.stock'),
          state: _('product_backend.col.state'),
          actions: _('product_backend.variants.actions'),
        },
        rows: management.variants.map((variant) => {
          const href = localized(`/admin/product/templates/${row.id}/variants/${variant.id}`, locale)
          const code = variant.defaultCode || variant.name || variant.id
          return {
            id: variant.id,
            code,
            values: (variant.values ?? []).map((value) => String(value.value ?? '')).filter(Boolean),
            sku: variant.defaultCode || '—',
            price: formatMoney(_, row.listPrice, 'VND'),
            stock: variant.stock == null ? '—' : String(variant.stock),
            active: variant.active !== false,
            stateLabel: _(
              variant.active === false
                ? 'product_backend.state.archived'
                : 'product_backend.variants.selling',
            ),
            href,
          }
        }),
        empty: _('product_backend.variants.empty'),
        editLabel: _('product_backend.variants.edit'),
        moreLabel: _('product_backend.action.more'),
        selectAllLabel: _('backend.table.selectAll'),
        selectRowLabel: _('backend.table.selectRow'),
        displayLabel: _('product_backend.variants.display'),
        rangeLabel: _('product_backend.variants.range', {
          from: variantFrom,
          to: variantTo,
          total: variantCount,
        }),
        pageLabel: String(variantPage.page),
        previousLabel: _('product_backend.variants.previous'),
        nextLabel: _('product_backend.variants.next'),
        previousHref: variantPage.page > 1 ? variantPageHref(variantPage.page - 1) : null,
        nextHref: variantTo < variantPage.total ? variantPageHref(variantPage.page + 1) : null,
      }}
    />
  )

  const mediaOfVariant = (variantId: string) =>
    management.variantMedia?.find((entry) => entry.variantId === variantId)?.images ?? []
  const mediaPage = management.variantMediaPage ?? {
    page: 1,
    pageSize: 25,
    total: management.variants.length,
  }
  const mediaFrom = mediaPage.total ? (mediaPage.page - 1) * mediaPage.pageSize + 1 : 0
  const mediaTo = Math.min(mediaPage.page * mediaPage.pageSize, mediaPage.total)
  const mediaPageHref = (page: number) =>
    localized(`/admin/product/templates/${row.id}?tab=media&variantPage=${page}`, locale)
  const mediaTab = (
    <ProductMediaManagement
      gallery={{
        title: _('product_backend.media.panelTitle'),
        description: _('product_backend.media.panelHint'),
        sortLabel: _('product_backend.media.sortAutomatic'),
        hint: _('product_backend.media.primaryHint'),
        panel: <MediaPanel {...media} labels={mediaLabels(_)} />,
      }}
      variants={{
        title: _('product_backend.media.variantTitle'),
        description: _('product_backend.media.variantHint'),
        columns: {
          variant: _('product_backend.media.variantColumn'),
          primary: _('product_backend.media.representative'),
          gallery: _('product_backend.media.library'),
          actions: _('product_backend.variants.actions'),
        },
        rows: management.variants.map((variant) => {
          const images = mediaOfVariant(variant.id)
          return {
            id: variant.id,
            label: variant.defaultCode || variant.name || variant.id,
            detail: (variant.values ?? [])
              .map((value) => String(value.value ?? ''))
              .filter(Boolean)
              .join(' · '),
            href: localized(`/admin/product/templates/${row.id}/variants/${variant.id}?tab=media`, locale),
            images: images.map((image) => ({
              id: image.id,
              src: image.src,
              alt: image.alt,
              primary: image.primary,
              removeAction: image.actions?.remove,
            })),
          }
        }),
        empty: _('product_backend.media.variantEmpty'),
        addLabel: _('product_backend.media.variantAdd'),
        editLabel: _('product_backend.media.variantEdit'),
        removeLabel: _('product_backend.media.variantRemove'),
        displayLabel: _('product_backend.variants.display'),
        rangeLabel: _('product_backend.variants.range', {
          from: mediaFrom,
          to: mediaTo,
          total: mediaPage.total,
        }),
        pageLabel: String(mediaPage.page),
        previousLabel: _('product_backend.variants.previous'),
        nextLabel: _('product_backend.variants.next'),
        previousHref: mediaPage.page > 1 ? mediaPageHref(mediaPage.page - 1) : null,
        nextHref: mediaTo < mediaPage.total ? mediaPageHref(mediaPage.page + 1) : null,
      }}
    />
  )

  const status = badge(
    selectionLabel(_, 'state', archived ? 'archived' : 'active'),
    archived ? 'neutral' : 'positive',
    archived ? 'archived' : 'active',
  )
  const actions = (
    <FormCluster
      label={_('product_backend.action.actions')}
      forms={[
        ...(activeTab === 'general'
          ? [
              button({
                label: _('product_backend.action.save'),
                type: 'submit',
                form: productFormId,
                variant: 'primary',
              }),
            ]
          : []),
        ...(management.actions ? [management.actions] : []),
        <RecordMore
          label={_('product_backend.action.more')}
          body={<FormCluster label={_('product_backend.action.more')} forms={[archiveAction]} />}
        />,
      ]}
    />
  )
  const page = (
    <FormPage
      scope="product-form-page"
      title={row.name}
      description={subtitle}
      status={status}
      actions={actions}
      navigation={
        <Tabs
          label={_('product_backend.tabs.label')}
          items={[
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
              count: variantTotal,
            },
            {
              id: 'media',
              label: _('product_backend.tabs.media'),
              href: tabHref('media'),
              active: activeTab === 'media',
              count: images.length,
            },
          ]}
        />
      }
      body={activeTab === 'variants' ? variants : activeTab === 'media' ? mediaTab : generalTab}
      aside={collaboration}
      asideLabel={_('product_backend.collaboration.label')}
      controller={management.editor}
      slots={{
        header: 'product.record-header',
        body: 'product.record-body',
        ...(partial ? { fragmentTitle: row.name } : {}),
      }}
    />
  )
  return partial ? page : shell(_, row.name, page, { ...frame, topbar: false, titled: false })
}
