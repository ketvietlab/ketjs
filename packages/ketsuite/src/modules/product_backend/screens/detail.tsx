import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  badge,
  button,
  dataTable,
  emptyState,
  Framed,
  FormCluster,
  icon,
  inline,
  linkButton,
  MediaPanel,
  RecordForm,
  RecordToggle,
  RecordWorkspace,
  Section,
  stack,
  Surface,
  Tabs,
} from '../../../ui/index.ts'
import type { FormOption, Frame, MediaPanelProps } from '../../../ui/index.ts'
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
    saleOk?: boolean
    purchaseOk?: boolean
    active?: boolean
    isStorable?: boolean
    tracking?: string
  },
  media: MediaPanelProps,
  management: {
    uoms: FormOption[]
    categories: FormOption[]
    attributes: FormOption[]
    variants: Array<{
      id: string
      name?: string | null
      defaultCode?: string | null
      barcode?: string | null
      active?: boolean
    }>
    /** What the template already carries, so the reader can see and undo it. */
    attributeLines: Array<{
      id: string
      attributeId: string
      attribute?: string | null
      values: Array<{ id: string; name: string }>
    }>
    stockEnabled?: boolean
    errors?: string[]
    editor?: JSXChild
    /**
     * Relation pickers, built by the route because they need a request to reach
     * their joint. Absent ones fall back to the plain select beside them, so this
     * screen still renders from a bare options list.
     */
    controls?: {
      uom?: JSXChild
      category?: JSXChild
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
  const primaryImage = images.find((image) => image.primary) ?? images[0]
  const unit = management.uoms.find((option) => option.value === row.uomId)?.label
  const category = management.categories.find((option) => option.value === row.categoryId)?.label
  const reference =
    management.variants.length === 1 && management.variants[0]?.defaultCode
      ? `${_('product_backend.field.defaultCode')}: ${management.variants[0].defaultCode}`
      : null
  const subtitle = [reference, category, unit].filter(Boolean).join(' · ')
  const tabHref = (tab: ProductDetailTab) =>
    localized(`/admin/product/templates/${row.id}?tab=${tab}`, locale)
  const productFormId = 'product-detail-form'
  const productToggle = (name: string, label: string, checked: boolean) => (
    <RecordToggle
      name={name}
      label={label}
      checked={checked}
      form={activeTab === 'general' ? productFormId : null}
      disabled={activeTab !== 'general'}
    />
  )
  const general = (
    <RecordForm
      id={productFormId}
      action={localized(`/admin/product/templates/${row.id}?tab=general`, locale)}
      submit={_('product_backend.action.save')}
      submitVariant="primary"
      submitPlacement="external"
      scope="product-detail"
      errors={management.errors}
      fields={[
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
          ...(management.controls?.uom ? { control: management.controls.uom } : {}),
        },
        {
          name: 'categoryId',
          label: _('product_backend.field.category'),
          type: 'select',
          value: row.categoryId,
          options: [{ value: '', label: '—' }, ...management.categories],
          ...(management.controls?.category ? { control: management.controls.category } : {}),
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
      ]}
    />
  )

  // Archiving is the only way out of the catalogue that keeps the history, and
  // the list already offers to include archived products — so the screen that
  // owns the product has to be the one that can archive it.
  const archived = row.active === false
  const generalTab = stack(
    [
      <Section title={_('product_backend.tabs.general')} body={<Surface body={general} />} />,
      <Section
        title={_(archived ? 'product_backend.archive.restoreTitle' : 'product_backend.archive.title')}
        description={_(archived ? 'product_backend.archive.restoreHint' : 'product_backend.archive.hint')}
        body={
          <Surface
            padding="compact"
            body={
              <RecordForm
                action={localized(`/admin/product/templates/${row.id}/archive?tab=general`, locale)}
                submit={_(archived ? 'product_backend.archive.restore' : 'product_backend.archive.action')}
                submitVariant={archived ? 'secondary' : 'destructive'}
                submitSize="compact"
                hidden={{ active: archived ? '1' : '0' }}
                fields={[]}
              />
            }
          />
        }
      />,
    ],
    'loose',
  )

  const variants = stack([
    <Section
      title={_('product_backend.variants.title')}
      actions={
        <RecordForm
          action={localized(`/admin/product/templates/${row.id}/variants/generate?tab=variants`, locale)}
          submit={_('product_backend.variants.generate')}
          submitVariant="secondary"
          fields={[]}
        />
      }
      body={
        management.variants.length === 0
          ? emptyState(_('product_backend.variants.empty'), _('product_backend.variants.generate'))
          : dataTable(_, {
              rows: management.variants,
              id: (variant) => variant.id,
              columns: [
                {
                  key: 'variant',
                  label: _('product_backend.variants.title'),
                  priority: 'primary',
                  // A generated variant has no name of its own; what identifies it
                  // is the combination it stands for. Falling back to the id last
                  // means the row is only ever unreadable when there is genuinely
                  // nothing else to say.
                  cell: (variant) =>
                    linkButton({
                      label: variant.name || variant.defaultCode || variant.id,
                      href: localized(`/admin/product/templates/${row.id}/variants/${variant.id}`, locale),
                      variant: 'tertiary',
                    }),
                },
                {
                  key: 'code',
                  label: _('product_backend.field.defaultCode'),
                  kind: 'identifier',
                  cell: (variant) => variant.defaultCode || '—',
                },
                {
                  key: 'barcode',
                  label: _('product_backend.field.barcode'),
                  kind: 'identifier',
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
            })
      }
    />,
    <Section
      title={_('product_backend.attributes.lines')}
      description={_('product_backend.attributes.linesHint')}
      body={stack(
        [
          // What is already configured, before the form that adds more. Without
          // this the reader adds a line and the screen says nothing back — there
          // was no way to see, let alone undo, what a template already carried.
          management.attributeLines.length
            ? dataTable(_, {
                rows: management.attributeLines,
                id: (line) => line.id,
                columns: [
                  {
                    key: 'attribute',
                    label: _('product_backend.attributes.attribute'),
                    priority: 'primary',
                    cell: (line) => line.attribute || line.attributeId,
                  },
                  {
                    key: 'values',
                    label: _('product_backend.attributes.values'),
                    cell: (line) =>
                      line.values.length
                        ? inline(line.values.map((value) => badge(value.name)))
                        : badge(_('product_backend.attributes.noValues')),
                  },
                  {
                    key: 'remove',
                    label: _('product_backend.attributes.removeLine'),
                    align: 'end',
                    cell: (line) => (
                      <RecordForm
                        action={localized(
                          `/admin/product/templates/${row.id}/attribute-lines/${line.id}/remove?tab=variants`,
                          locale,
                        )}
                        submit={_('product_backend.attributes.removeLine')}
                        submitVariant="tertiary"
                        submitSize="compact"
                        fields={[]}
                      />
                    ),
                  },
                ],
              })
            : emptyState(
                _('product_backend.attributes.linesEmpty'),
                _('product_backend.attributes.linesEmptyHint'),
              ),
          <Surface
            padding="compact"
            body={
              <RecordForm
                action={localized(`/admin/product/templates/${row.id}/attribute-lines?tab=variants`, locale)}
                submit={_('product_backend.action.add')}
                submitVariant="secondary"
                fields={[
                  {
                    name: 'attributeId',
                    label: _('product_backend.attributes.attribute'),
                    type: 'select',
                    // The empty option matters on a required field: without it the
                    // browser preselects the first attribute, and a reader who
                    // never opened the control still submits one.
                    options: [{ value: '', label: '—' }, ...management.attributes],
                    required: true,
                    ...(management.controls?.attribute ? { control: management.controls.attribute } : {}),
                  },
                  {
                    name: 'valueIds',
                    label: _('product_backend.attributes.values'),
                    help: _('product_backend.attributes.valuesHint'),
                    required: true,
                    // Its own row: the chips grow downward, and a half-width
                    // neighbour would be left centred against a stack of them.
                    span: 'full' as const,
                    ...(management.controls?.attributeValues
                      ? { control: management.controls.attributeValues }
                      : {}),
                  },
                ]}
              />
            }
          />,
        ],
        'compact',
      )}
    />,
  ])

  const mediaTab = (
    <Section
      title={_('product_backend.media.title')}
      description={_('product_backend.media.description')}
      body={<MediaPanel {...media} labels={mediaLabels(_)} />}
    />
  )

  const workspace = (
    <RecordWorkspace
      breadcrumbs={{
        label: _('product_backend.tabs.label'),
        items: [
          {
            label: _('product_backend.menu.app'),
            href: localized('/admin/product/templates', locale),
          },
          {
            label: _('product_backend.menu.templates'),
            href: localized('/admin/product/templates', locale),
          },
          { label: row.name },
        ],
      }}
      kicker={_('product_backend.detail.kicker')}
      title={row.name}
      subtitle={subtitle}
      image={primaryImage ? { src: primaryImage.src, alt: primaryImage.alt } : null}
      imageFallback={icon('package')}
      badges={[
        productToggle('saleOk', _('product_backend.field.saleOk'), row.saleOk === true),
        productToggle('purchaseOk', _('product_backend.field.purchaseOk'), row.purchaseOk === true),
        ...(management.stockEnabled
          ? [productToggle('isStorable', _('product_backend.field.isStorable'), row.isStorable === true)]
          : []),
      ]}
      summary={[
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
        {
          id: 'state',
          label: _('product_backend.col.state'),
          value: selectionLabel(_, 'state', archived ? 'archived' : 'active'),
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
      ]}
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
              count: management.variants.length,
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
      controller={
        <>
          {activeTab === 'general' && (
            <FormCluster
              label={_('product_backend.action.save')}
              forms={[
                button({
                  label: _('product_backend.action.save'),
                  type: 'submit',
                  form: productFormId,
                  variant: 'primary',
                }),
              ]}
            />
          )}
          {management.editor}
        </>
      }
      body={activeTab === 'variants' ? variants : activeTab === 'media' ? mediaTab : generalTab}
      aside={collaboration}
      asideLabel={_('product_backend.collaboration.label')}
      slots={{
        header: 'product.record-header',
        body: 'product.record-body',
        ...(partial ? { fragmentTitle: row.name } : {}),
      }}
    />
  )
  return partial ? (
    workspace
  ) : (
    <Framed
      translator={_}
      title={frame.navigation ? row.name : _('product_backend.detail.kicker')}
      frame={frame}
      body={workspace}
    />
  )
}
